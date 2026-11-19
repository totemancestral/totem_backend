import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, TotemOrderStatus } from "@prisma/client";
import Stripe from "stripe";
import { PrismaService } from "../prisma/prisma.service";
import { SupabaseMirrorService } from "./supabase-mirror.service";
import { SupabaseStorageService } from "./supabase-storage.service";
import { TotemAiService } from "./totem-ai.service";
import { TotemQueueService, TOTEM_QUEUE_STALE_MS } from "./totem-queue.service";
import {
  CheckoutSessionPayload,
  PaymentIntentPayload,
  checkoutSessionSchema,
  paymentIntentSchema,
  parseCheckoutMetadata,
} from "./totem.schemas";
import { CheckoutMetadata } from "./totem.types";
import { computeScores, computeReveal, JUNIOR_TOTEM_ANIMALS } from "./junior.service";
import { isCompleteAdultAnswers } from "./adult-answers";
import { isCompleteJuniorAnswers, normalizeJuniorAnswers } from "./junior-answers";
import { ResendMailerService } from "./resend-mailer.service";
import { generateJuniorDocuments } from "./junior-documents";
import { juniorSerialNumber } from "./junior-content";
import type { GeneratedArtefact, StoredArtefact } from "./totem.types";
import type { TotemOrder } from "@prisma/client";

@Injectable()
export class StripeWebhookService {
  private stripe?: Stripe;
  private readonly stripeSecretKey?: string;
  private readonly webhookSecret?: string;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly queue: TotemQueueService,
    private readonly mirror: SupabaseMirrorService,
    private readonly generation: TotemAiService,
    private readonly storage: SupabaseStorageService,
    private readonly mailer: ResendMailerService,
  ) {
    this.stripeSecretKey = config.get<string>("STRIPE_SECRET_KEY");
    this.webhookSecret = config.get<string>("STRIPE_WEBHOOK_SECRET");
  }

  async handle(rawBody: Buffer, signature: string): Promise<void> {
    const event = this.readVerifiedEvent(rawBody, signature);

    if (event.type === "checkout.session.completed") {
      await this.handleCheckoutSession(event.data.object);
      return;
    }

    if (event.type === "payment_intent.succeeded") {
      await this.handlePaymentIntent(event.data.object);
    }
  }

  async handleCheckoutSession(payload: unknown): Promise<void> {
    const session = this.readCheckoutSession(payload);

    if (session.payment_status !== "paid") {
      return;
    }

    const fallbackEmail = session.customer_details?.email ?? session.customer_email ?? undefined;
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;

    if (session.metadata?.orderId) {
      const order = await this.activatePrecreatedOrder({
        orderId: session.metadata.orderId,
        userId: session.metadata.userId,
        checkoutSessionId: session.id,
        paymentIntentId,
        amountCents: session.amount_total ?? undefined,
        currency: session.currency ?? undefined,
        country: session.customer_details?.address?.country ?? undefined,
        customerEmail: fallbackEmail,
        customerName: session.metadata.prenom ?? session.customer_details?.name ?? undefined,
      });

      await this.mirror.markPaid({
        order,
        externalCommandId: session.metadata.externalCommandId ?? session.metadata.commande_id,
        paymentIntentId,
        amountCents: session.amount_total ?? undefined,
        currency: session.currency ?? undefined,
        country: session.customer_details?.address?.country ?? undefined,
      });

      await this.enqueueIfPending(order.id);
      return;
    }

    const metadata = this.readMetadata(session.metadata, fallbackEmail);

    const order = await this.createOrderIfNeeded({
      metadata,
      checkoutSessionId: session.id,
      paymentIntentId,
      amountCents: session.amount_total ?? undefined,
      currency: session.currency ?? undefined,
      country: session.customer_details?.address?.country ?? undefined,
      customerName: metadata.prenom ?? session.customer_details?.name ?? undefined,
    });

    await this.mirror.markPaid({
      order,
      externalCommandId: metadata.externalCommandId,
      paymentIntentId,
      amountCents: session.amount_total ?? undefined,
      currency: session.currency ?? undefined,
      country: session.customer_details?.address?.country ?? undefined,
    });

    await this.enqueueIfPending(order.id);
  }

  private async handlePaymentIntent(payload: unknown): Promise<void> {
    const intent = this.readPaymentIntent(payload);

    if (intent.status !== "succeeded") {
      return;
    }

    if (intent.metadata?.orderId) {
      const order = await this.activatePrecreatedOrder({
        orderId: intent.metadata.orderId,
        userId: intent.metadata.userId,
        paymentIntentId: intent.id,
        amountCents: intent.amount_received ?? intent.amount,
        currency: intent.currency ?? undefined,
        customerEmail: intent.metadata.email,
        customerName: intent.metadata.prenom,
      });

      await this.mirror.markPaid({
        order,
        externalCommandId: intent.metadata.externalCommandId ?? intent.metadata.commande_id,
        paymentIntentId: intent.id,
        amountCents: intent.amount_received ?? intent.amount,
        currency: intent.currency ?? undefined,
      });

      await this.enqueueIfPending(order.id);
      return;
    }

    if (intent.metadata?.offer === "junior") {
      return;
    }

    if (!this.hasCompleteCheckoutMetadata(intent.metadata)) {
      return;
    }

    const metadata = this.readMetadata(intent.metadata);
    const checkoutSessionId = metadata.checkoutSessionId ?? `payment_intent:${intent.id}`;

    const order = await this.createOrderIfNeeded({
      metadata,
      checkoutSessionId,
      paymentIntentId: intent.id,
      amountCents: intent.amount_received ?? intent.amount,
      currency: intent.currency ?? undefined,
      customerName: metadata.prenom,
    });


    await this.mirror.markPaid({
      order,
      externalCommandId: metadata.externalCommandId,
      paymentIntentId: intent.id,
      amountCents: intent.amount_received ?? intent.amount,
      currency: intent.currency ?? undefined,
    });

    await this.enqueueIfPending(order.id);
  }

  private readVerifiedEvent(rawBody: Buffer, signature: string): Stripe.Event {
    if (!this.webhookSecret) {
      throw new ServiceUnavailableException("stripe_webhook_not_configured");
    }

    try {
      return this.readStripe().webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch (error) {
      throw new BadRequestException({
        code: "stripe_signature_invalid",
        detail: error instanceof Error ? error.message : "invalid_signature",
      });
    }
  }

  private readStripe(): Stripe {
    if (!this.stripeSecretKey) {
      throw new ServiceUnavailableException("stripe_not_configured");
    }

    this.stripe ??= new Stripe(this.stripeSecretKey);
    return this.stripe;
  }

  private readCheckoutSession(payload: unknown): CheckoutSessionPayload {
    try {
      return checkoutSessionSchema.parse(payload);
    } catch (error) {
      throw new UnprocessableEntityException({
        code: "checkout_session_invalid",
        detail: error instanceof Error ? error.message : "invalid_payload",
      });
    }
  }

  private readPaymentIntent(payload: unknown): PaymentIntentPayload {
    try {
      return paymentIntentSchema.parse(payload);
    } catch (error) {
      throw new UnprocessableEntityException({
        code: "payment_intent_invalid",
        detail: error instanceof Error ? error.message : "invalid_payload",
      });
    }
  }

  private readMetadata(
    metadata: Record<string, string> | null | undefined,
    fallbackEmail?: string,
  ): CheckoutMetadata {
    try {
      return parseCheckoutMetadata(metadata, fallbackEmail);
    } catch (error) {
      throw new UnprocessableEntityException({
        code: "checkout_metadata_invalid",
        detail: error instanceof Error ? error.message : "invalid_metadata",
      });
    }
  }

  private async createOrderIfNeeded(input: {
    metadata: CheckoutMetadata;
    checkoutSessionId: string;
    paymentIntentId?: string;
    amountCents?: number;
    currency?: string;
    country?: string;
    customerName?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.totemOrder.findFirst({
        where: {
          OR: [
            ...(input.metadata.orderId ? [{ id: input.metadata.orderId }] : []),
            ...(input.metadata.externalCommandId ? [{ id: input.metadata.externalCommandId }] : []),
            { checkoutSessionId: input.checkoutSessionId },
            ...(input.paymentIntentId ? [{ paymentIntentId: input.paymentIntentId }] : []),
          ],
        },
      });

      if (existing) {
        return tx.totemOrder.update({
          where: { id: existing.id },
          data: {
            customerEmail: input.metadata.email ?? existing.customerEmail,
            customerName: input.customerName ?? existing.customerName,
            paymentIntentId: input.paymentIntentId ?? existing.paymentIntentId,
            amountCents: input.amountCents ?? existing.amountCents,
            currency: input.currency?.toUpperCase() ?? existing.currency,
            country: input.country ?? existing.country,
            locale: input.metadata.locale ?? existing.locale,
            offer: input.metadata.offer ?? existing.offer,
          },
        });
      }

      return tx.totemOrder.create({
        data: {
          id: input.metadata.orderId ?? input.metadata.externalCommandId,
          userId: input.metadata.userId,
          customerEmail: input.metadata.email,
          customerName: input.customerName,
          checkoutSessionId: input.checkoutSessionId,
          paymentIntentId: input.paymentIntentId,
          locale: input.metadata.locale,
          offer: input.metadata.offer ?? "ancestral",
          amountCents: input.amountCents,
          currency: input.currency?.toUpperCase(),
          country: input.country,
          answers: input.metadata.answers as Prisma.InputJsonValue,
          status: TotemOrderStatus.pending,
        },
      });
    });
  }

  private async activatePrecreatedOrder(input: {
    orderId: string;
    userId?: string;
    checkoutSessionId?: string;
    paymentIntentId?: string;
    amountCents?: number;
    currency?: string;
    country?: string;
    customerEmail?: string;
    customerName?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.totemOrder.findUnique({
        where: { id: input.orderId },
      });

      if (!existing) {
        throw new BadRequestException("order_not_found");
      }

      if (input.userId && existing.userId !== input.userId) {
        throw new BadRequestException("order_user_mismatch");
      }

      if (input.checkoutSessionId && existing.checkoutSessionId !== input.checkoutSessionId) {
        throw new BadRequestException("checkout_session_mismatch");
      }

      if (
        input.paymentIntentId &&
        existing.paymentIntentId &&
        existing.paymentIntentId !== input.paymentIntentId
      ) {
        throw new BadRequestException("payment_intent_mismatch");
      }

      if (existing.parentConsentId) {
        await tx.juniorParentalConsent.updateMany({
          where: { id: existing.parentConsentId, paidAt: null }, data: { paidAt: new Date() },
        });
      }

      return tx.totemOrder.update({
        where: { id: existing.id },
        data: {
          paymentIntentId: input.paymentIntentId ?? existing.paymentIntentId,
          amountCents: input.amountCents ?? existing.amountCents,
          currency: input.currency?.toUpperCase() ?? existing.currency,
          country: input.country ?? existing.country,
          customerEmail: existing.customerEmail ?? input.customerEmail,
          customerName: existing.customerName ?? input.customerName,
        },
      });
    });
  }

  private hasCompleteCheckoutMetadata(
    metadata: Record<string, string> | null | undefined,
  ): boolean {
    if (!metadata) return false;
    if (typeof metadata.answers === "string") return true;

    return Array.from({ length: 10 }, (_, index) => `q${index + 1}`).every(
      (key) => typeof metadata[key] === "string" && metadata[key].length > 0,
    );
  }

  private async enqueueIfPending(orderId: string): Promise<void> {
    const order = await this.prisma.totemOrder.findUniqueOrThrow({ where: { id: orderId } });

    if (order.offer === "junior") {
      await this.enqueueJuniorIfNeeded(order.id);
      return;
    }
    if (order.status !== TotemOrderStatus.pending || order.queuedAt) return;
    if (!hasEnoughAnswersForGeneration(order.answers, order.offer)) return;

    const reserved = await this.prisma.totemOrder.updateMany({
      where: { id: order.id, status: TotemOrderStatus.pending, queuedAt: null },
      data: { queuedAt: new Date() },
    });
    if (reserved.count === 1) await this.queue.enqueue(order.id);
  }

  async enqueueJuniorIfNeeded(orderId: string): Promise<void> {
    const order = await this.prisma.totemOrder.findUniqueOrThrow({ where: { id: orderId } });
    if (order.offer !== "junior" || !order.paymentIntentId || order.status === TotemOrderStatus.error) return;
    if (order.status === TotemOrderStatus.done && order.pdfKey && order.certificateKey
      && (!order.parentConsentId || order.deliveryEmailSentAt)) return;
    if (order.queuedAt) return; // Recovery repairs a reservation even if Redis was unavailable.
    const reserved = await this.prisma.totemOrder.updateMany({
      where: { id: order.id, queuedAt: null }, data: { queuedAt: new Date() },
    });
    if (reserved.count) await this.queue.enqueue(order.id);
  }

  async computeJuniorRevealIfNeeded(orderId: string, job?: { processingAt?: Date; assertLease: () => Promise<void> }): Promise<void> {
    const order = await this.prisma.totemOrder.findUnique({ where: { id: orderId } });
    if (!order || order.offer !== "junior") return;
    if (order.status === TotemOrderStatus.done && order.pdfKey && order.certificateKey) {
      await job?.assertLease();
      await this.deliverJunior(order, undefined, job?.assertLease);
      return;
    }

    const processingAt = job?.processingAt ?? new Date();
    const claimed = job?.processingAt ? { count: 1 } : await this.prisma.totemOrder.updateMany({
      where: {
        id: orderId,
        offer: "junior",
        OR: [
          { status: TotemOrderStatus.pending },
          { status: TotemOrderStatus.error },
          { status: TotemOrderStatus.done, pdfKey: null },
          { status: TotemOrderStatus.done, certificateKey: null },
          { status: TotemOrderStatus.processing, processingAt: { lte: new Date(Date.now() - TOTEM_QUEUE_STALE_MS) } },
        ],
      },
      data: { status: TotemOrderStatus.processing, processingAt },
    });
    if (!claimed.count) return;

    const answers = normalizeJuniorAnswers(order.answers) ?? normalizeJuniorAnswers(order.juniorPayload);
    let failureStep: "image" | "pdf" | "email" = "image";

    try {
      if (!answers || !isCompleteJuniorAnswers(answers)) throw new Error("junior_order_answers_invalid");
      const scores = computeScores(answers);
      const reveal = computeReveal(answers, undefined, order.locale);

      // Existing paid Junior works get their missing PDFs from the saved image.
      const imageArtefact = order.imageKey ? await this.storage.readOwnedArtefact(orderId, order.imageKey)
        : await this.generation.generateImage({
          orderId,
          archetypeId: reveal.totemId,
          animalName: JUNIOR_TOTEM_ANIMALS[reveal.totemId],
          prompt: `Create a Junior TOTEM ancestral artwork for ${reveal.name}. The totem animal is ${JUNIOR_TOTEM_ANIMALS[reveal.totemId]}.`,
        });
      await job?.assertLease();
      const image = order.imageKey
        ? { key: order.imageKey, url: this.storage.signDeliveryUrl(order.imageKey) }
        : await this.storage.store(orderId, "image", imageArtefact);
      const { key: imageKey, url: imageUrl } = image;
      await job?.assertLease();
      const savedImage = await this.prisma.totemOrder.updateMany({
        where: { id: orderId, status: TotemOrderStatus.processing, processingAt },
        data: { imageKey, imageUrl },
      });
      if (!savedImage.count) {
        if (job) throw new Error("worker_lease_lost");
        return;
      }
      failureStep = "pdf";
      const documents = await generateJuniorDocuments({
        orderId, firstName: order.customerName ?? "Toi", locale: order.locale,
        createdAt: order.createdAt, reveal, image: imageArtefact,
      });
      const [pdf, certificate] = await Promise.all([
        this.storage.store(orderId, "pdf", documents.pdf),
        this.storage.store(orderId, "certificate", documents.certificate),
      ]);

      await job?.assertLease();
      await this.prisma.userProfile.upsert({
        where: { id: order.userId },
        create: {
          id: order.userId,
          role: "junior",
          firstName: order.customerName ?? undefined,
          locale: order.locale ?? undefined,
        },
        update: {
          role: "junior",
        },
      }).catch(() => undefined);

      const completed = await this.prisma.totemOrder.updateMany({
        where: { id: orderId, status: TotemOrderStatus.processing, processingAt },
        data: {
          status: TotemOrderStatus.done,
          juniorPayload: {
            firstName: order.customerName ?? "Toi",
            scores,
            dominant: reveal.dominant,
            secondary: reveal.secondary,
            totemId: reveal.totemId,
            totemName: reveal.name,
            quality: reveal.quality,
            orderNumber: reveal.orderNumber,
            phrase: reveal.phrase,
            share: reveal.share,
            animal: reveal.animal,
            clanWelcome: reveal.clanWelcome,
            secondaryAttributes: reveal.secondaryAttributes,
            serialNumber: juniorSerialNumber(order.id),
            imageKey,
            imageUrl,
          },
          imageKey,
          imageUrl,
          pdfKey: pdf.key, pdfUrl: pdf.url, parchmentKey: pdf.key, parchmentUrl: pdf.url,
          certificateKey: certificate.key, certificateUrl: certificate.url,
          completedAt: new Date(),
          errorMessage: null,
        },
      });
      if (!completed.count) {
        if (job) throw new Error("worker_lease_lost");
        return;
      }

      await this.prisma.juniorTotem.create({
        data: {
          userId: order.userId, answers: answers as object, scores,
          dominant: reveal.dominant, secondary: reveal.secondary, totemName: reveal.name,
          quality: reveal.quality, phrase: reveal.phrase, orderNumber: reveal.orderNumber,
        },
      }).catch(() => undefined);

      failureStep = "email";
      await this.deliverJunior({ ...order, imageKey, imageUrl, pdfKey: pdf.key, pdfUrl: pdf.url,
        certificateKey: certificate.key, certificateUrl: certificate.url }, { image, pdf, certificate, documents }, job?.assertLease);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "junior_generation_failed";
      if (!job) await this.prisma.totemOrder.updateMany({
        where: { id: orderId, status: TotemOrderStatus.processing, processingAt },
        data: {
          status: TotemOrderStatus.error,
          errorMessage,
        },
      }).catch(() => undefined);

      await this.prisma.totemPipelineError.create({
        data: {
          orderId,
          step: failureStep,
          message: errorMessage.slice(0, 1000),
          attempts: 1,
        },
      }).catch(() => undefined);

      throw error;
    }
  }

  private async deliverJunior(order: TotemOrder, prepared?: {
    image: StoredArtefact; pdf: StoredArtefact; certificate: StoredArtefact;
    documents: { pdf: GeneratedArtefact; certificate: GeneratedArtefact };
  }, assertLease?: () => Promise<void>) {
    const answers = normalizeJuniorAnswers(order.answers);
    if (!answers || !order.pdfKey || !order.certificateKey || !order.imageKey) throw new Error("junior_delivery_missing");
    const reveal = computeReveal(answers, undefined, order.locale);
    const image = prepared?.image ?? { key: order.imageKey, url: this.storage.signDeliveryUrl(order.imageKey) };
    // Keep email content stable across retries for Resend's idempotency key.
    const pdf = prepared?.pdf ?? { key: order.pdfKey, url: order.pdfUrl ?? this.storage.signDeliveryUrl(order.pdfKey) };
    const certificate = prepared?.certificate ?? { key: order.certificateKey, url: order.certificateUrl ?? this.storage.signDeliveryUrl(order.certificateKey) };
    await assertLease?.();
    await this.mirror.markJuniorDelivered({ order, reveal, image, pdf, certificate, scores: computeScores(answers) });
    // Historical orders may carry the child's email, rather than a confirmed parent's.
    if (order.deliveryEmailSentAt || !order.customerEmail || !order.parentConsentId) return;
    const documents = prepared?.documents ?? {
      pdf: await this.storage.readOwnedArtefact(order.id, order.pdfKey),
      certificate: await this.storage.readOwnedArtefact(order.id, order.certificateKey),
    };
    await assertLease?.();
    await this.mailer.sendJuniorDelivery({ email: order.customerEmail, firstName: order.customerName ?? "Toi",
      totemName: reveal.name, quality: reveal.quality, phrase: reveal.phrase, locale: order.locale ?? undefined,
      orderId: order.id, pdfUrl: pdf.url, certificateUrl: certificate.url,
      attachments: [
        { filename: "Carte-ancestrale-Junior.pdf", content: Buffer.from(documents.pdf.bytes).toString("base64") },
        { filename: "Certificat-authenticite-Junior.pdf", content: Buffer.from(documents.certificate.bytes).toString("base64") },
      ],
    });
    await this.prisma.totemOrder.update({ where: { id: order.id }, data: { deliveryEmailSentAt: new Date() } });
  }
}

export function hasEnoughAnswersForGeneration(value: Prisma.JsonValue, offer?: string): boolean {
  if (offer === "junior") {
    if (Array.isArray(value)) {
      return value.filter(
        (answer) => isRecord(answer) && typeof answer.answer === "string" && answer.answer.trim(),
      ).length >= 5;
    }
    return isRecord(value) && Object.keys(value).length >= 5;
  }

  return isCompleteAdultAnswers(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
