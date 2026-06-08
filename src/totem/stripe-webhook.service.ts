import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TotemOrderStatus } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { TotemQueueService } from './totem-queue.service';
import {
  CheckoutSessionPayload,
  checkoutSessionSchema,
  parseCheckoutMetadata,
} from './totem.schemas';
import { CheckoutMetadata } from './totem.types';

@Injectable()
export class StripeWebhookService {
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly queue: TotemQueueService,
  ) {
    this.stripe = new Stripe(config.getOrThrow<string>('STRIPE_SECRET_KEY'));
    this.webhookSecret = config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET');
  }

  async handle(rawBody: Buffer, signature: string): Promise<void> {
    const event = this.readVerifiedEvent(rawBody, signature);

    if (event.type !== 'checkout.session.completed') {
      return;
    }

    const session = this.readCheckoutSession(event.data.object);

    if (session.payment_status !== 'paid') {
      return;
    }

    const fallbackEmail =
      session.customer_details?.email ?? session.customer_email ?? undefined;
    const metadata = this.readMetadata(session.metadata, fallbackEmail);
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;

    const order = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.totemOrder.findUnique({
        where: { checkoutSessionId: session.id },
      });

      if (existing) {
        return existing;
      }

      return tx.totemOrder.create({
        data: {
          userId: metadata.userId,
          customerEmail: metadata.email,
          checkoutSessionId: session.id,
          paymentIntentId,
          locale: metadata.locale,
          answers: metadata.answers as Prisma.InputJsonValue,
          status: TotemOrderStatus.pending,
        },
      });
    });

    if (order.status !== TotemOrderStatus.pending || order.queuedAt) {
      return;
    }

    await this.queue.enqueue(order.id);

    await this.prisma.totemOrder.update({
      where: { id: order.id },
      data: { queuedAt: new Date() },
    });
  }

  private readVerifiedEvent(rawBody: Buffer, signature: string): Stripe.Event {
    try {
      return this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      );
    } catch (error) {
      throw new BadRequestException({
        code: 'stripe_signature_invalid',
        detail: error instanceof Error ? error.message : 'invalid_signature',
      });
    }
  }

  private readCheckoutSession(payload: unknown): CheckoutSessionPayload {
    try {
      return checkoutSessionSchema.parse(payload);
    } catch (error) {
      throw new UnprocessableEntityException({
        code: 'checkout_session_invalid',
        detail: error instanceof Error ? error.message : 'invalid_payload',
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
        code: 'checkout_metadata_invalid',
        detail: error instanceof Error ? error.message : 'invalid_metadata',
      });
    }
  }
}
