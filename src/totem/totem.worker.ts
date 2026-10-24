import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, TotemOrder, TotemOrderStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ResendMailerService } from "./resend-mailer.service";
import { SupabaseMirrorService } from "./supabase-mirror.service";
import { SupabaseStorageService } from "./supabase-storage.service";
import { TotemAiService } from "./totem-ai.service";
import { TotemJob, TotemQueueService, TOTEM_QUEUE_STALE_MS } from "./totem-queue.service";
import { TotemTextPayload } from "./totem.types";
import { extractAdultAnswers } from "./adult-answers";
import { TOTEM_ANIMALS } from "./totem-animals";

@Injectable()
export class TotemWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TotemWorker.name);
  private readonly pollIntervalMs: number;
  private readonly concurrency: number;
  private activeJobs = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private polling = false;
  private lastRecoveryAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: TotemQueueService,
    private readonly generation: TotemAiService,
    private readonly storage: SupabaseStorageService,
    private readonly mirror: SupabaseMirrorService,
    private readonly mailer: ResendMailerService,
    config: ConfigService,
  ) {
    this.pollIntervalMs = config.get<number>("TOTEM_POLL_INTERVAL_MS") ?? 3_000;
    this.concurrency = Math.min(
      Math.max(1, config.get<number>("TOTEM_WORKER_CONCURRENCY") ?? 2),
      50,
    );
  }

  onModuleInit(): void {
    this.running = true;
    this.timer = setInterval(() => {
      void this.poll().catch((error) => {
        this.logger.error(`queue poll failed: ${error instanceof Error ? error.message : error}`);
      });
    }, this.pollIntervalMs);
  }

  onModuleDestroy(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isAvailable(): boolean {
    return this.running && this.timer !== null;
  }

  private async poll(): Promise<void> {
    if (!this.running || this.polling || this.activeJobs >= this.concurrency) return;
    this.polling = true;
    try {
      if (Date.now() - this.lastRecoveryAt >= 30_000) {
        await this.queue.reclaimStale();
        await this.recoverPending();
        this.lastRecoveryAt = Date.now();
      }
      const job = await this.queue.dequeue();
      if (!job) return;
      this.activeJobs += 1;
      void this.process(job)
        .catch((error) => this.logger.error(`[order ${job.orderId}] ${error.message}`))
        .finally(() => { this.activeJobs -= 1; });
    } finally {
      this.polling = false;
    }
  }

  private async recoverPending(): Promise<void> {
    const orders = await this.prisma.totemOrder.findMany({
      where: { status: TotemOrderStatus.pending, queuedAt: { not: null }, offer: { not: "junior" } },
      orderBy: { updatedAt: "asc" }, take: 100, select: { id: true },
    });
    for (const order of orders) await this.queue.enqueue(order.id);
  }

  private async process(job: TotemJob): Promise<void> {
    let heartbeatBusy = false;
    let leaseLost = false;
    const renew = async () => {
      if (heartbeatBusy) return;
      heartbeatBusy = true;
      try { if (!await this.queue.heartbeat(job)) leaseLost = true; }
      catch { leaseLost = true; }
      finally { heartbeatBusy = false; }
    };
    const heartbeat = setInterval(() => { void renew(); }, 30_000);
    const assertLease = async () => {
      if (leaseLost || !await this.queue.heartbeat(job)) throw new Error("worker_lease_lost");
    };
    let processingAt: Date | null = null;
    try {
      const order = await this.prisma.totemOrder.findUniqueOrThrow({
        where: { id: job.orderId },
      });
      await assertLease();
      if (order.status === TotemOrderStatus.done) {
        if (order.offer !== "junior") {
          await this.restoreDelivery(order);
          await assertLease();
          await this.sendDeliveryIfNeeded(order);
        }
        await this.queue.ack(job);
        return;
      }
      if (order.offer === "junior" || order.status === TotemOrderStatus.error || !order.queuedAt) {
        await this.queue.ack(job);
        return;
      }
      // Une reprise après crash compte aussi parmi les trois tentatives.
      if (order.status === TotemOrderStatus.processing && order.processingAt
        && order.processingAt.getTime() > Date.now() - TOTEM_QUEUE_STALE_MS) {
        await this.queue.retry(job);
        return;
      }
      if (order.attempts >= 3 && order.processingAt) {
        const action = await this.registerFailure(order.id, order.processingAt, new Error("generation_attempts_exhausted"));
        if (action === "ack") await this.queue.ack(job);
        return;
      }
      processingAt = new Date();
      const claimed = await this.prisma.totemOrder.updateMany({
        where: { id: order.id, OR: [
          { status: TotemOrderStatus.pending },
          { status: TotemOrderStatus.processing, processingAt: { lte: new Date(Date.now() - TOTEM_QUEUE_STALE_MS) } },
        ] },
        data: {
          status: TotemOrderStatus.processing,
          processingAt,
          attempts: { increment: 1 },
          errorMessage: null,
        },
      });
      if (!claimed.count) {
        processingAt = null;
        await this.queue.retry(job);
        return;
      }
      await this.generate(order, processingAt, assertLease);
      await this.queue.ack(job);
    } catch (error) {
      // Sans propriétaire ou sans persistance de l'échec, la tâche reste récupérable.
      if (processingAt && !leaseLost && normalizeError(error) !== "worker_lease_lost") {
        await assertLease();
        const action = await this.registerFailure(job.orderId, processingAt, error);
        if (action === "retry") await this.queue.retry(job);
        else if (action === "ack") await this.queue.ack(job);
      } else {
        throw error;
      }
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async generate(order: TotemOrder, processingAt: Date, assertLease: () => Promise<void>): Promise<void> {
    await this.mirror.markProcessing(order);

    const answers = extractAdultAnswers(order.answers);
    if (!answers) throw new Error("adult_answers_incomplete");
    const text = await this.generation.generateText({
      orderId: order.id,
      userId: order.userId,
      customerName: order.customerName,
      locale: order.locale,
      answers,
    });

    await assertLease();
    await this.persistClaim(order.id, processingAt, {
        textPayload: text as Prisma.InputJsonValue,
        archetypeId: text.archetypeId,
        ancestralName: text.ancestralName,
    });

    const imageArtefact = await this.generation.generateImage({
      orderId: order.id,
      archetypeId: text.archetypeId,
      prompt: text.imagePrompt,
      animalName:
        TOTEM_ANIMALS.find((animal) => animal.slug === text.archetypeId)?.name ??
        text.archetypeId,
    });
    await assertLease();
    const image = await this.storage.store(order.id, "image", imageArtefact);

    const pdfPayload = {
      orderId: order.id,
      userId: order.userId,
      customerName: order.customerName,
      locale: order.locale,
      offer: order.offer,
      text,
      answers,
      image: imageArtefact,
    };

    // La voix ritualisee est reservee aux offres Ancestral/Revelation et
    // Famille ; l'offre Origine ne la promet pas (cf. Offres.tsx).
    const includeAudio = order.offer !== "origine";

    const [audio, pdf, certificate] = await Promise.all([
      includeAudio
        ? this.generation
            .generateAudio({
              orderId: order.id,
              archetypeId: text.archetypeId,
              locale: order.locale,
              text: this.generation.buildAudioNarration(text),
            })
            .then((artefact) => this.storage.store(order.id, "audio", artefact))
        : Promise.resolve(null),
      this.generation
        .generatePdf(pdfPayload)
        .then((artefact) => this.storage.store(order.id, "pdf", artefact)),
      this.generation
        .generateCertificate(pdfPayload)
        .then((artefact) => this.storage.store(order.id, "certificate", artefact)),
    ]);

    await assertLease();
    await this.persistClaim(order.id, processingAt, {
        status: TotemOrderStatus.done,
        imageKey: image.key,
        audioKey: audio?.key ?? null,
        pdfKey: pdf.key,
        parchmentKey: pdf.key,
        certificateKey: certificate.key,
        imageUrl: image.url,
        audioUrl: audio?.url ?? null,
        pdfUrl: pdf.url,
        parchmentUrl: pdf.url,
        certificateUrl: certificate.url,
        completedAt: new Date(),
        errorMessage: null,
    });
    const completedOrder = await this.prisma.totemOrder.findUniqueOrThrow({ where: { id: order.id } });
    await assertLease();
    await this.mirror.markDelivered({ order: completedOrder, text, image, audio, pdf, certificate });
    await assertLease();
    await this.sendDeliveryBestEffort(completedOrder, image.url, audio?.url ?? null, pdf.url, certificate.url);
  }

  private async persistClaim(orderId: string, processingAt: Date, data: Prisma.TotemOrderUpdateManyMutationInput): Promise<void> {
    const result = await this.prisma.totemOrder.updateMany({
      where: { id: orderId, status: TotemOrderStatus.processing, processingAt }, data,
    });
    if (!result.count) throw new Error("worker_lease_lost");
  }

  private async restoreDelivery(order: TotemOrder): Promise<void> {
    if (!order.textPayload || !order.imageKey || !order.imageUrl || !order.pdfKey || !order.pdfUrl
      || !order.certificateKey || !order.certificateUrl) throw new Error("delivery_payload_missing");
    await this.mirror.markDelivered({
      order, text: order.textPayload as unknown as TotemTextPayload,
      image: { key: order.imageKey, url: order.imageUrl },
      audio: order.audioKey && order.audioUrl ? { key: order.audioKey, url: order.audioUrl } : null,
      pdf: { key: order.pdfKey, url: order.pdfUrl },
      certificate: { key: order.certificateKey, url: order.certificateUrl },
    });
  }

  private async sendDeliveryIfNeeded(order: TotemOrder): Promise<void> {
    if (order.deliveryEmailSentAt) return;
    const audioRequired = order.offer !== "origine";
    if (!order.imageUrl || !order.pdfUrl || !order.certificateUrl || (audioRequired && !order.audioUrl)) {
      throw new Error("delivery_urls_missing");
    }
    await this.sendDeliveryBestEffort(order, order.imageUrl, order.audioUrl, order.pdfUrl, order.certificateUrl);
  }

  private async sendDeliveryBestEffort(
    order: TotemOrder,
    imageUrl: string,
    audioUrl: string | null,
    pdfUrl: string,
    certificateUrl: string,
  ): Promise<void> {
    try {
      const sent = await this.mailer.sendDelivery({ order, imageUrl, audioUrl, pdfUrl, certificateUrl });
      if (!sent) return;
      await this.prisma.totemOrder.update({
        where: { id: order.id },
        data: { deliveryEmailSentAt: new Date() },
      });
    } catch (error) {
      await this.prisma.totemPipelineError.create({
        data: {
          orderId: order.id,
          step: "email",
          message: normalizeError(error),
          attempts: 1,
        },
      });
    }
  }

  private async registerFailure(orderId: string, processingAt: Date, error: unknown): Promise<"retry" | "ack" | "lost"> {
    const message = normalizeError(error);

    const order = await this.prisma.totemOrder.findUnique({ where: { id: orderId } });
    if (!order || order.processingAt?.getTime() !== processingAt.getTime()) return "lost";
    if (order.status === TotemOrderStatus.done) return "retry";
    const attempts = order.attempts;
    const maxAttempts = 3;
    const finalAttempt = attempts >= maxAttempts;

    const updated = await this.prisma.totemOrder.updateMany({
      where: { id: orderId, status: TotemOrderStatus.processing, processingAt },
      data: {
        status: finalAttempt ? TotemOrderStatus.error : TotemOrderStatus.pending,
        attempts,
        errorMessage: message,
      },
    });
    if (!updated.count) return "lost";

    await this.prisma.totemPipelineError.create({
      data: {
        orderId,
        step: "pipeline",
        message,
        attempts,
      },
    });

    await this.mirror.markFailed(order, message).catch(() => undefined);

    if (!finalAttempt) {
      return "retry";
    } else {
      await this.mailer.sendFailureAlert(orderId, message).catch(() => undefined);
      return "ack";
    }
  }
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 1000);
  }
  return String(error).slice(0, 1000);
}
