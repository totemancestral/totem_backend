import { BadRequestException, Injectable, UnprocessableEntityException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, TotemOrderStatus } from "@prisma/client";
import Stripe from "stripe";
import { PrismaService } from "../prisma/prisma.service";
import { TotemQueueService } from "./totem-queue.service";
import {
  CheckoutSessionPayload,
  PaymentIntentPayload,
  checkoutSessionSchema,
  paymentIntentSchema,
  parseCheckoutMetadata,
} from "./totem.schemas";
import { CheckoutMetadata } from "./totem.types";

@Injectable()
export class StripeWebhookService {
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly queue: TotemQueueService,
  ) {
    this.stripe = new Stripe(config.getOrThrow<string>("STRIPE_SECRET_KEY"));
    this.webhookSecret = config.getOrThrow<string>("STRIPE_WEBHOOK_SECRET");
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

  private async handleCheckoutSession(payload: unknown): Promise<void> {
    const session = this.readCheckoutSession(payload);

    if (session.payment_status !== "paid") {
      return;
    }

    const fallbackEmail = session.customer_details?.email ?? session.customer_email ?? undefined;
    const metadata = this.readMetadata(session.metadata, fallbackEmail);
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;

    const order = await this.createOrderIfNeeded({
      metadata,
      checkoutSessionId: session.id,
      paymentIntentId,
      amountCents: session.amount_total ?? undefined,
      currency: session.currency ?? undefined,
      country: session.customer_details?.address?.country ?? undefined,
      customerName: metadata.prenom ?? session.customer_details?.name ?? undefined,
    });

    await this.enqueueIfPending(order.id);
  }

  private async handlePaymentIntent(payload: unknown): Promise<void> {
    const intent = this.readPaymentIntent(payload);

    if (intent.status !== "succeeded") {
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

    await this.enqueueIfPending(order.id);
  }

  private readVerifiedEvent(rawBody: Buffer, signature: string): Stripe.Event {
    try {
      return this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch (error) {
      throw new BadRequestException({
        code: "stripe_signature_invalid",
        detail: error instanceof Error ? error.message : "invalid_signature",
      });
    }
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
            { checkoutSessionId: input.checkoutSessionId },
            ...(input.paymentIntentId ? [{ paymentIntentId: input.paymentIntentId }] : []),
          ],
        },
      });

      if (existing) return existing;

      return tx.totemOrder.create({
        data: {
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

  private async enqueueIfPending(orderId: string): Promise<void> {
    const order = await this.prisma.totemOrder.findUniqueOrThrow({ where: { id: orderId } });

    if (order.status !== TotemOrderStatus.pending || order.queuedAt) return;

    await this.queue.enqueue(order.id);

    await this.prisma.totemOrder.update({
      where: { id: order.id },
      data: { queuedAt: new Date() },
    });
  }
}
