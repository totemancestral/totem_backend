import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { Prisma, TotemOrder, TotemOrderStatus } from "@prisma/client";
import { Job } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { TOTEM_QUEUE } from "./totem.constants";
import { ResendMailerService } from "./resend-mailer.service";
import { SupabaseStorageService } from "./supabase-storage.service";
import { SupabaseMirrorService } from "./supabase-mirror.service";
import { TotemAiService } from "./totem-ai.service";
import { QuestionnaireAnswer, TotemJobPayload } from "./totem.types";

const workerConcurrency = readWorkerConcurrency();

@Injectable()
@Processor(TOTEM_QUEUE, {
  concurrency: workerConcurrency,
  lockDuration: 90 * 60 * 1000,
})
export class TotemWorker extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly generation: TotemAiService,
    private readonly storage: SupabaseStorageService,
    private readonly mirror: SupabaseMirrorService,
    private readonly mailer: ResendMailerService,
  ) {
    super();
  }

  async process(job: Job<TotemJobPayload>): Promise<void> {
    try {
      const order = await this.prisma.totemOrder.findUniqueOrThrow({
        where: { id: job.data.orderId },
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
          attempts: job.attemptsMade + 1,
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

      const storyImages = await this.generation.generateStoryImages({
        orderId: order.id,
        archetypeId: text.archetypeId,
        text,
      });

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
            storyImages,
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

      await this.mirror.markDelivered({
        order: completedOrder,
        text,
        image,
        audio,
        pdf,
      });

      await this.sendDeliveryBestEffort(completedOrder, image.url, audio.url, pdf.url);
    } catch (error) {
      await this.registerFailure(job, error);
      throw error;
    }
  }

  private async sendDeliveryIfNeeded(order: TotemOrder): Promise<void> {
    if (order.deliveryEmailSentAt) {
      return;
    }

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
      const sent = await this.mailer.sendDelivery({
        order,
        imageUrl,
        audioUrl,
        pdfUrl,
      });

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

  private async registerFailure(job: Job<TotemJobPayload>, error: unknown): Promise<void> {
    const message = normalizeError(error);
    const attempts = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? 1;
    const finalAttempt = attempts >= maxAttempts;

    await this.prisma.totemOrder.update({
      where: { id: job.data.orderId },
      data: {
        status: finalAttempt ? TotemOrderStatus.error : TotemOrderStatus.pending,
        attempts,
        errorMessage: message,
      },
    });

    await this.prisma.totemPipelineError.create({
      data: {
        orderId: job.data.orderId,
        step: "pipeline",
        message,
        attempts,
      },
    });

    const order = await this.prisma.totemOrder
      .findUnique({ where: { id: job.data.orderId } })
      .catch(() => null);
    await this.mirror.markFailed(order, message).catch(() => undefined);

    if (finalAttempt) {
      await this.mailer.sendFailureAlert(job.data.orderId, message).catch(() => undefined);
    }
  }
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 1000);
  }

  return String(error).slice(0, 1000);
}

function readWorkerConcurrency(): number {
  const value = Number(process.env.TOTEM_WORKER_CONCURRENCY ?? 2);

  if (!Number.isFinite(value) || value < 1) {
    return 2;
  }

  return Math.min(Math.trunc(value), 50);
}
