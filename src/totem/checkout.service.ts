import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, TotemOrderStatus } from "@prisma/client";
import Stripe from "stripe";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { SupabaseMirrorService } from "./supabase-mirror.service";
import { TotemOffer } from "./totem.types";
import { computeScores, computeReveal } from "./junior.service";

const adultCheckoutSchema = z.object({
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
    .max(10),
  locale: z.string().min(2).max(12).optional(),
  customerName: z.string().min(1).max(120).optional(),
  successUrl: z.string().url().max(500).optional(),
  cancelUrl: z.string().url().max(500).optional(),
});

const juniorCheckoutSchema = z.object({
  offer: z.literal("junior"),
  externalCommandId: z.string().min(1).max(120).optional(),
  firstName: z.string().trim().max(40).optional(),
  answers: z.record(
    z.string(),
    z.object({
      choice: z.enum(["A", "B", "C", "D"]),
    }),
  ),
  locale: z.enum(["fr", "en"]).optional(),
  successUrl: z.string().url().max(500).optional(),
  cancelUrl: z.string().url().max(500).optional(),
});

const checkoutInputSchema = z.discriminatedUnion("offer", [
  adultCheckoutSchema,
  juniorCheckoutSchema,
]);

type AdultCheckoutInput = z.infer<typeof adultCheckoutSchema>;
type JuniorCheckoutInput = z.infer<typeof juniorCheckoutSchema>;
export type CheckoutInput = AdultCheckoutInput | JuniorCheckoutInput;

const OFFER_LABELS: Record<TotemOffer, string> = {
  origine: "TOTEM ANCESTRAL - Origine",
  ancestral: "TOTEM ANCESTRAL - Ancestral",
  famille: "TOTEM ANCESTRAL - Famille",
  junior: "TOTEM JUNIOR",
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
      junior: config.getOrThrow<number>("TOTEM_PRICE_JUNIOR_CENTS"),
    };
  }

  async createSession(input: {
    body: unknown;
    userId: string;
    email?: string;
  }): Promise<{ id: string; url: string | null; reveal?: Record<string, unknown> }> {
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
      success_url: payload.offer === "junior"
        ? `${payload.successUrl ?? this.successUrl}&type=junior`
        : (payload.successUrl ?? this.successUrl),
      cancel_url: payload.cancelUrl ?? this.cancelUrl,
    });

    if (payload.offer === "junior") {
      return this.createJuniorOrder({ payload, session, amount, userId: input.userId, email: input.email });
    }

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

  private async createJuniorOrder(input: {
    payload: JuniorCheckoutInput;
    session: Stripe.Checkout.Session;
    amount: number;
    userId: string;
    email?: string;
  }) {
    const { payload, session, amount, userId, email } = input;

    const scores = computeScores(payload.answers);
    const reveal = computeReveal(scores, payload.firstName);

    const order = await this.prisma.totemOrder.create({
      data: {
        userId,
        customerEmail: email,
        customerName: payload.firstName,
        checkoutSessionId: session.id,
        status: TotemOrderStatus.pending,
        locale: payload.locale,
        offer: "junior",
        amountCents: amount,
        currency: "EUR",
        answers: payload.answers as unknown as Prisma.InputJsonValue,
        juniorPayload: {
          scores,
          dominant: reveal.dominant,
          secondary: reveal.secondary,
          totemName: reveal.name,
          quality: reveal.quality,
          orderNumber: reveal.orderNumber,
          phrase: reveal.phrase,
          share: reveal.share,
        },
      },
    });

    await this.readStripe().checkout.sessions.update(session.id, {
      metadata: {
        userId,
        ...(email ? { email } : {}),
        ...(payload.firstName ? { prenom: payload.firstName } : {}),
        ...(payload.locale ? { locale: payload.locale } : {}),
        offer: "junior",
        orderId: order.id,
      },
    });

    return {
      id: session.id,
      url: session.url,
      reveal: {
        orderNumber: reveal.orderNumber,
        scores,
        dominant: reveal.dominant,
        secondary: reveal.secondary,
        totem: { name: reveal.name, quality: reveal.quality },
        phrase: reveal.phrase,
        share: reveal.share,
      },
    };
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
    const meta: Record<string, string> = {
      userId: input.userId,
      ...(input.email ? { email: input.email } : {}),
      offer: input.payload.offer,
    };

    if (input.payload.offer === "junior") {
      if (input.payload.firstName) meta.prenom = input.payload.firstName;
      if (input.payload.locale) meta.locale = input.payload.locale;
      meta.answers = JSON.stringify(input.payload.answers);
    } else {
      if (input.payload.customerName) meta.prenom = input.payload.customerName;
      if (input.payload.locale) meta.locale = input.payload.locale;
      if (input.payload.externalCommandId) {
        meta.externalCommandId = input.payload.externalCommandId;
        meta.commande_id = input.payload.externalCommandId;
      }
    }

    return meta;
  }
}
