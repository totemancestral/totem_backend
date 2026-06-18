import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, TotemOrderStatus } from "@prisma/client";
import Stripe from "stripe";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { SupabaseMirrorService } from "./supabase-mirror.service";
import { TotemOffer } from "./totem.types";

const checkoutInputSchema = z.object({
  offer: z.enum(["origine", "ancestral", "famille"]),
  externalCommandId: z.string().min(1).max(120).optional(),
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1).max(80),
        answer: z.string().min(1).max(4000),
      }),
    )
    .min(4)
    .max(11),
  locale: z.string().min(2).max(12).optional(),
  customerName: z.string().min(1).max(120).optional(),
  successUrl: z.string().url().max(500).optional(),
  cancelUrl: z.string().url().max(500).optional(),
});

export type CheckoutInput = z.infer<typeof checkoutInputSchema>;

const OFFER_LABELS: Record<TotemOffer, string> = {
  origine: "TOTEM ANCESTRAL - Origine",
  ancestral: "TOTEM ANCESTRAL - Ancestral",
  famille: "TOTEM ANCESTRAL - Famille",
};

@Injectable()
export class CheckoutService {
  private stripe?: Stripe;
  private readonly stripeSecretKey?: string;
  private readonly successUrl: string;
  private readonly cancelUrl: string;
  private readonly offerPrices: Record<TotemOffer, number>;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly mirror: SupabaseMirrorService,
  ) {
    this.stripeSecretKey = config.get<string>("STRIPE_SECRET_KEY");
    this.successUrl = config.getOrThrow<string>("CHECKOUT_SUCCESS_URL");
    this.cancelUrl = config.getOrThrow<string>("CHECKOUT_CANCEL_URL");
    this.offerPrices = {
      origine: config.getOrThrow<number>("TOTEM_PRICE_ORIGINE_CENTS"),
      ancestral: config.getOrThrow<number>("TOTEM_PRICE_ANCESTRAL_CENTS"),
      famille: config.getOrThrow<number>("TOTEM_PRICE_FAMILLE_CENTS"),
    };
  }

  async createSession(input: {
    body: unknown;
    userId: string;
    email?: string;
  }): Promise<{ id: string; url: string | null }> {
    const payload = this.readInput(input.body);
    const amount = this.offerPrices[payload.offer];

    if (amount <= 0) {
      throw new BadRequestException("offer_price_invalid");
    }

    const baseMetadata = this.createBaseMetadata({
      userId: input.userId,
      email: input.email,
      payload,
    });

    const session = await this.readStripe().checkout.sessions.create({
      mode: "payment",
      customer_email: input.email,
      client_reference_id: input.userId,
      billing_address_collection: "auto",
      automatic_tax: { enabled: true },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: amount,
            product_data: {
              name: OFFER_LABELS[payload.offer],
            },
          },
        },
      ],
      metadata: baseMetadata,
      payment_intent_data: {
        metadata: baseMetadata,
      },
      success_url: payload.successUrl ?? this.successUrl,
      cancel_url: payload.cancelUrl ?? this.cancelUrl,
    });

    const order = await this.prisma.totemOrder.create({
      data: {
        userId: input.userId,
        customerEmail: input.email,
        customerName: payload.customerName,
        checkoutSessionId: session.id,
        status: TotemOrderStatus.pending,
        locale: payload.locale,
        offer: payload.offer,
        amountCents: amount,
        currency: "EUR",
        answers: payload.answers as unknown as Prisma.InputJsonValue,
      },
    });

    await this.readStripe().checkout.sessions.update(session.id, {
      metadata: {
        ...baseMetadata,
        orderId: order.id,
      },
    });

    await this.mirror.attachCheckoutSession({
      externalCommandId: payload.externalCommandId,
      userId: input.userId,
      checkoutSessionId: session.id,
    });

    return { id: session.id, url: session.url };
  }

  private readInput(body: unknown): CheckoutInput {
    try {
      return checkoutInputSchema.parse(body);
    } catch (error) {
      throw new BadRequestException({
        code: "checkout_payload_invalid",
        detail: error instanceof Error ? error.message : "invalid_payload",
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

  private createBaseMetadata(input: {
    userId: string;
    email?: string;
    payload: CheckoutInput;
  }): Record<string, string> {
    return {
      userId: input.userId,
      ...(input.email ? { email: input.email } : {}),
      ...(input.payload.customerName ? { prenom: input.payload.customerName } : {}),
      ...(input.payload.locale ? { locale: input.payload.locale } : {}),
      ...(input.payload.externalCommandId
        ? {
            externalCommandId: input.payload.externalCommandId,
            commande_id: input.payload.externalCommandId,
          }
        : {}),
      offer: input.payload.offer,
    };
  }
}
