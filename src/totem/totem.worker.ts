import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, TotemOrder, TotemOrderStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ResendMailerService } from "./resend-mailer.service";
import { SupabaseMirrorService } from "./supabase-mirror.service";
import { SupabaseStorageService } from "./supabase-storage.service";
import { TotemAiService } from "./totem-ai.service";
import { TotemQueueService } from "./totem-queue.service";
import { QuestionnaireAnswer } from "./totem.types";

@Injectable()
export class TotemWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TotemWorker.name);
  private readonly pollIntervalMs: number;
  private readonly concurrency: number;
  private activeJobs = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

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
    this.timer = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  onModuleDestroy(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    if (!this.running || this.activeJobs >= this.concurrency) return;

    const orderId = await this.queue.dequeue();
    if (!orderId) return;

    this.activeJobs += 1;
    this.process(orderId)
      .catch((error) => this.logger.error(`[order ${orderId}] ${error.message}`))
      .finally(() => {
        this.activeJobs -= 1;
      });
  }

  private async process(orderId: string): Promise<void> {
    await this.queue.markActive(orderId);

    try {
      const order = await this.prisma.totemOrder.findUniqueOrThrow({
        where: { id: orderId },
      });

      if (order.status === TotemOrderStatus.done) {
        await this.sendDeliveryIfNeeded(order);
        return;
      }

      await this.prisma.totemOrder.update({
        where: { id: order.id },
        data: {
          status: TotemOrderStatus.processing,
          processingAt: new Date(),
          attempts: { increment: 1 },
          errorMessage: null,
        },
      });
      await this.mirror.markProcessing(order);

      const answers = order.answers as unknown as QuestionnaireAnswer[];
      const text = await this.generation.generateText({
        orderId: order.id,
        userId: order.userId,
        customerName: order.customerName,
        locale: order.locale,
        answers,
      });

      await this.prisma.totemOrder.update({
        where: { id: order.id },
        data: {
          textPayload: text as Prisma.InputJsonValue,
          archetypeId: text.archetypeId,
          ancestralName: text.ancestralName,
        },
      });

      const imageArtefact = await this.generation.generateImage({
        orderId: order.id,
        archetypeId: text.archetypeId,
        prompt: text.imagePrompt,
      });
      const image = await this.storage.store(order.id, "image", imageArtefact);

      const [audio, pdf] = await Promise.all([
        this.generation
          .generateAudio({
            orderId: order.id,
            archetypeId: text.archetypeId,
            text: this.generation.buildAudioNarration(text),
          })
          .then((artefact) => this.storage.store(order.id, "audio", artefact)),
        this.generation
          .generatePdf({
            orderId: order.id,
            userId: order.userId,
            customerName: order.customerName,
            locale: order.locale,
            offer: order.offer,
            text,
            answers,
            image: imageArtefact,
          })
          .then((artefact) => this.storage.store(order.id, "pdf", artefact)),
      ]);

      const completedOrder = await this.prisma.totemOrder.update({
        where: { id: order.id },
        data: {
          status: TotemOrderStatus.done,
          imageKey: image.key,
          audioKey: audio.key,
          pdfKey: pdf.key,
          parchmentKey: pdf.key,
          certificateKey: pdf.key,
          imageUrl: image.url,
          audioUrl: audio.url,
          pdfUrl: pdf.url,
          parchmentUrl: pdf.url,
          certificateUrl: pdf.url,
          completedAt: new Date(),
          errorMessage: null,
        },
      });

      await this.mirror.markDelivered({ order: completedOrder, text, image, audio, pdf });
      await this.sendDeliveryBestEffort(completedOrder, image.url, audio.url, pdf.url);
    } catch (error) {
      await this.registerFailure(orderId, error);
    } finally {
      await this.queue.markDone(orderId);
    }
  }

  private async sendDeliveryIfNeeded(order: TotemOrder): Promise<void> {
    if (order.deliveryEmailSentAt) return;
    if (!order.imageUrl || !order.audioUrl || !order.pdfUrl) {
      throw new Error("delivery_urls_missing");
    }
    await this.sendDeliveryBestEffort(order, order.imageUrl, order.audioUrl, order.pdfUrl);
  }

  private async sendDeliveryBestEffort(
    order: TotemOrder,
    imageUrl: string,
    audioUrl: string,
    pdfUrl: string,
  ): Promise<void> {
    try {
      const sent = await this.mailer.sendDelivery({ order, imageUrl, audioUrl, pdfUrl });
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

  private async registerFailure(orderId: string, error: unknown): Promise<void> {
    const message = normalizeError(error);

    const order = await this.prisma.totemOrder.findUnique({ where: { id: orderId } });
    const attempts = (order?.attempts ?? 0) + 1;
    const maxAttempts = 3;
    const finalAttempt = attempts >= maxAttempts;

    await this.prisma.totemOrder.update({
      where: { id: orderId },
      data: {
        status: finalAttempt ? TotemOrderStatus.error : TotemOrderStatus.pending,
        attempts,
        errorMessage: message,
      },
    });

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
      await this.queue.enqueue(orderId);
    } else {
      await this.mailer.sendFailureAlert(orderId, message).catch(() => undefined);
    }
  }
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 1000);
  }
  return String(error).slice(0, 1000);
}