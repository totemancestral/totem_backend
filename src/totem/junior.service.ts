import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TotemOrderStatus } from '@prisma/client';
import Stripe from 'stripe';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseAuthService } from './supabase-auth.service';

type Choice = 'A' | 'B' | 'C' | 'D';
type QuestionNumber = 1 | 2 | 3 | 4 | 5;
type Dimension = 'F' | 'E' | 'T' | 'A';
type Scores = Record<Dimension, number>;

const juniorInputSchema = z.object({
  firstName: z.string().trim().max(40).optional(),
  locale: z.enum(['fr', 'en']).optional(),
  answers: z.record(
    z.string(),
    z.object({
      choice: z.enum(['A', 'B', 'C', 'D']),
    }),
  ),
});

const dimensions: Dimension[] = ['F', 'E', 'T', 'A'];
const questionNumbers: QuestionNumber[] = [1, 2, 3, 4, 5];

const scoring: Record<QuestionNumber, Record<Choice, Scores>> = {
  1: {
    A: { F: 3, E: 0, T: 0, A: 1 },
    B: { F: 0, E: 3, T: 1, A: 0 },
    C: { F: 0, E: 1, T: 0, A: 3 },
    D: { F: 2, E: 0, T: 0, A: 2 },
  },
  2: {
    A: { F: 0, E: 1, T: 3, A: 0 },
    B: { F: 1, E: 0, T: 1, A: 3 },
    C: { F: 0, E: 3, T: 0, A: 1 },
    D: { F: 2, E: 0, T: 1, A: 2 },
  },
  3: {
    A: { F: 0, E: 2, T: 0, A: 2 },
    B: { F: 1, E: 0, T: 3, A: 0 },
    C: { F: 0, E: 0, T: 1, A: 3 },
    D: { F: 3, E: 1, T: 0, A: 0 },
  },
  4: {
    A: { F: 0, E: 2, T: 1, A: 1 },
    B: { F: 2, E: 0, T: 2, A: 0 },
    C: { F: 0, E: 1, T: 0, A: 3 },
    D: { F: 3, E: 1, T: 0, A: 0 },
  },
  5: {
    A: { F: 1, E: 0, T: 0, A: 3 },
    B: { F: 3, E: 0, T: 1, A: 0 },
    C: { F: 0, E: 0, T: 3, A: 1 },
    D: { F: 0, E: 3, T: 0, A: 1 },
  },
};

const attribution: Record<Dimension, Record<Dimension, string>> = {
  F: {
    A: 'DAYO LE LION DU FEU',
    E: 'ZARA LE LEOPARD DES OMBRES',
    T: 'KOFI LE BUFFLE DES PLAINES',
    F: 'AMARA LA LIONNE DES SAVANES',
  },
  E: {
    A: 'KEMI LE SERPENT SAGE',
    T: 'BAKARI LE CROCODILE ANCIEN',
    F: 'AIDA LA PANTHERE NOIRE',
    E: 'IMANI LA TORTUE ETERNELLE',
  },
  T: {
    F: "SEUN L'ELEPHANT GARDIEN",
    A: 'NALA LA GRUE ROYALE',
    E: 'IMANI LA TORTUE ETERNELLE',
    T: "SEUN L'ELEPHANT GARDIEN",
  },
  A: {
    F: "KWAME L'AIGLE DES CIMES",
    E: 'FATOU LE FAUCON LIBRE',
    T: "KWAME L'AIGLE DES CIMES",
    A: 'FATOU LE FAUCON LIBRE',
  },
};

const qualities: Record<string, string> = {
  "KWAME L'AIGLE DES CIMES": 'Vision',
  'AMARA LA LIONNE DES SAVANES': 'Protection',
  'ZARA LE LEOPARD DES OMBRES': 'Precision',
  'KEMI LE SERPENT SAGE': 'Sagesse',
  "SEUN L'ELEPHANT GARDIEN": 'Memoire',
  'AIDA LA PANTHERE NOIRE': 'Mystere',
  'KOFI LE BUFFLE DES PLAINES': 'Endurance',
  'NALA LA GRUE ROYALE': 'Grace',
  'BAKARI LE CROCODILE ANCIEN': 'Longevite',
  'FATOU LE FAUCON LIBRE': 'Liberte',
  'DAYO LE LION DU FEU': 'Intensite',
  'IMANI LA TORTUE ETERNELLE': 'Patience',
};

@Injectable()
export class JuniorService {
  private stripe?: Stripe;
  private readonly stripeSecretKey?: string;
  private readonly successUrl: string;
  private readonly cancelUrl: string;
  private readonly juniorPriceCents: number;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly auth: SupabaseAuthService,
  ) {
    this.stripeSecretKey = config.get<string>("STRIPE_SECRET_KEY");
    this.successUrl = config.getOrThrow<string>("CHECKOUT_SUCCESS_URL");
    this.cancelUrl = config.getOrThrow<string>("CHECKOUT_CANCEL_URL");
    this.juniorPriceCents = config.getOrThrow<number>("TOTEM_PRICE_JUNIOR_CENTS");
  }

  async reveal(body: unknown, authorization?: string) {
    const parsed = juniorInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('junior_payload_invalid');
    }

    const scores = computeScores(parsed.data.answers);
    const { dominant, secondary, name, quality, orderNumber, phrase, share } = computeReveal(
      scores,
      parsed.data.firstName,
    );

    let userId: string | undefined;
    if (authorization) {
      try {
        const user = await this.auth.requireUser(authorization);
        userId = user.id;

        await this.prisma.userProfile.upsert({
          where: { id: userId },
          create: {
            id: userId,
            role: 'junior',
            firstName: parsed.data.firstName || undefined,
            locale: parsed.data.locale || undefined,
          },
          update: {},
        });

        const juniorTotem = await this.prisma.juniorTotem.create({
          data: {
            userId,
            answers: parsed.data.answers as object,
            scores,
            dominant,
            secondary,
            totemName: name,
            quality,
            phrase,
            orderNumber,
          },
        });

        return {
          id: juniorTotem.id,
          type: 'junior',
          firstName: parsed.data.firstName || 'Toi',
          orderNumber,
          scores,
          dominant,
          secondary,
          totem: { name, quality },
          phrase,
          share,
          saved: true,
        };
      } catch {
        // Token invalid — return anonymous result
      }
    }

    return {
      type: 'junior',
      firstName: parsed.data.firstName || 'Toi',
      orderNumber,
      scores,
      dominant,
      secondary,
      totem: { name, quality },
      phrase,
      share,
      saved: false,
    };
  }

  async createCheckoutSession(body: unknown, authorization: string) {
    const user = await this.auth.requireUser(authorization);
    const parsed = juniorInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('junior_payload_invalid');
    }

    const scores = computeScores(parsed.data.answers);
    const reveal = computeReveal(scores, parsed.data.firstName);

    const session = await this.readStripe().checkout.sessions.create({
      mode: "payment",
      customer_email: user.email,
      client_reference_id: user.id,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: this.juniorPriceCents,
            product_data: {
              name: "TOTEM JUNIOR",
            },
          },
        },
      ],
      metadata: {
        userId: user.id,
        email: user.email ?? "",
        locale: parsed.data.locale ?? "",
        offer: "junior",
        prenom: parsed.data.firstName ?? "",
        answers: JSON.stringify(parsed.data.answers),
      },
      payment_intent_data: {
        metadata: {
          userId: user.id,
          email: user.email ?? "",
          locale: parsed.data.locale ?? "",
          offer: "junior",
          prenom: parsed.data.firstName ?? "",
          answers: JSON.stringify(parsed.data.answers),
        },
      },
      success_url: `${this.successUrl}&type=junior`,
      cancel_url: this.cancelUrl,
    });

    const order = await this.prisma.totemOrder.create({
      data: {
        userId: user.id,
        customerEmail: user.email,
        customerName: parsed.data.firstName,
        checkoutSessionId: session.id,
        status: TotemOrderStatus.pending,
        locale: parsed.data.locale,
        offer: "junior",
        amountCents: this.juniorPriceCents,
        currency: "EUR",
        answers: parsed.data.answers as unknown as Prisma.InputJsonValue,
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
        userId: user.id,
        email: user.email ?? "",
        locale: parsed.data.locale ?? "",
        offer: "junior",
        prenom: parsed.data.firstName ?? "",
        answers: JSON.stringify(parsed.data.answers),
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

  private readStripe(): Stripe {
    if (!this.stripeSecretKey) {
      throw new ServiceUnavailableException("stripe_not_configured");
    }
    this.stripe ??= new Stripe(this.stripeSecretKey);
    return this.stripe;
  }

  async listTotems(authorization: string) {
    const user = await this.auth.requireUser(authorization);
    return this.prisma.juniorTotem.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        totemName: true,
        quality: true,
        phrase: true,
        orderNumber: true,
        shareCount: true,
        createdAt: true,
        scores: true,
        dominant: true,
        secondary: true,
      },
    });
  }

  async shareTotem(id: string, authorization: string) {
    const user = await this.auth.requireUser(authorization);
    const totem = await this.prisma.juniorTotem.findUnique({
      where: { id },
    });
    if (!totem || totem.userId !== user.id) {
      throw new NotFoundException('junior_totem_not_found');
    }
    return this.prisma.juniorTotem.update({
      where: { id },
      data: { shareCount: { increment: 1 } },
      select: {
        id: true,
        totemName: true,
        quality: true,
        phrase: true,
        orderNumber: true,
        shareCount: true,
      },
    });
  }
}

export function computeScores(answers: Record<string, { choice: string }>): Scores {
  const scores: Scores = { F: 0, E: 0, T: 0, A: 0 };
  for (const question of questionNumbers) {
    const choice = answers[String(question)]?.choice as Choice;
    if (!choice) throw new BadRequestException('junior_answers_incomplete');
    const questionScores = scoring[question][choice];
    for (const dimension of dimensions) {
      scores[dimension] += questionScores[dimension];
    }
  }
  return scores;
}

export function computeReveal(scores: Scores, firstName?: string) {
  const sorted = [...dimensions]
    .map((dimension) => ({ dimension, score: scores[dimension] }))
    .sort((left, right) => right.score - left.score);
  const dominant = sorted[0]?.dimension ?? 'F';
  const secondary = sorted.find((item) => item.dimension !== dominant)?.dimension ?? dominant;
  const name = attribution[dominant][secondary] ?? attribution[dominant][dominant];
  const quality = qualities[name] ?? 'Presence';
  const orderNumber = (hash(JSON.stringify(scores)) % 999999) + 1;
  const phrase = `Avant toi, un ancetre portait ${qualityPhrase(quality)} dans son geste, et ce signe avance maintenant avec ton nom.`;

  return {
    dominant,
    secondary,
    name,
    quality,
    orderNumber,
    phrase,
    share: {
      caption: `${name}\nQuel ancetre dort en toi ?\n#RevealYourTotem`,
      messageDefi: `J'ai decouvert mon totem ancestral : ${name}. Toi, tu es quoi ? totemancestral.com`,
    },
  };
}

function qualityPhrase(quality: string) {
  const phrases: Record<string, string> = {
    Vision: 'la vision',
    Protection: 'la protection',
    Precision: 'la precision',
    Sagesse: 'la sagesse',
    Memoire: 'la memoire',
    Mystere: 'le mystere',
    Endurance: "l'endurance",
    Grace: 'la grace',
    Longevite: 'la longevite',
    Liberte: 'la liberte',
    Intensite: "l'intensite",
    Patience: 'la patience',
  };
  return phrases[quality] ?? quality.toLowerCase();
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return Math.abs(result >>> 0);
}