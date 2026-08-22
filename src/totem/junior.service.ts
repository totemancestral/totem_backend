import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseAuthService } from './supabase-auth.service';
import { scoreJuniorFeta, type JuniorTotemId } from './feta-scoring';
import { juniorAnswersSchema, juniorAnswersEqual } from './junior-answers';

type Dimension = 'F' | 'E' | 'T' | 'A';
type Scores = Record<Dimension, number>;

const juniorInputSchema = z.object({
  checkoutSessionId: z.string().min(1).max(255),
  firstName: z.string().trim().max(40).optional(),
  locale: z.enum(['fr', 'en']).optional(),
  answers: juniorAnswersSchema,
});

export const JUNIOR_TOTEM_ANIMALS: Record<JuniorTotemId, string> = {
  kwame_aigle: 'Aigle',
  amara_lionne: 'Lionne',
  zara_leopard: 'Léopard',
  kemi_serpent: 'Serpent royal',
  seun_elephant: 'Éléphant',
  aida_panthere: 'Panthère',
  kofi_buffle: 'Buffle',
  nala_grue: 'Grue',
  bakari_crocodile: 'Crocodile',
  fatou_faucon: 'Faucon',
  dayo_lion: 'Lion',
  imani_tortue: 'Tortue',
};

const JUNIOR_TOTEM_NAMES: Record<JuniorTotemId, string> = {
  dayo_lion: 'DAYO LE LION DU FEU',
  zara_leopard: 'ZARA LE LÉOPARD DES OMBRES',
  kofi_buffle: 'KOFI LE BUFFLE DES PLAINES',
  amara_lionne: 'AMARA LA LIONNE DES SAVANES',
  kemi_serpent: 'KEMI LE SERPENT SAGE',
  bakari_crocodile: 'BAKARI LE CROCODILE ANCIEN',
  aida_panthere: 'AIDA LA PANTHÈRE NOIRE',
  imani_tortue: 'IMANI LA TORTUE ÉTERNELLE',
  seun_elephant: "SEUN L'ÉLÉPHANT GARDIEN",
  nala_grue: 'NALA LA GRUE ROYALE',
  kwame_aigle: "KWAME L'AIGLE DES CIMES",
  fatou_faucon: 'FATOU LE FAUCON LIBRE',
};

const qualities: Record<string, string> = {
  "KWAME L'AIGLE DES CIMES": 'Vision',
  'AMARA LA LIONNE DES SAVANES': 'Protection',
  'ZARA LE LÉOPARD DES OMBRES': 'Précision',
  'KEMI LE SERPENT SAGE': 'Sagesse',
  "SEUN L'ÉLÉPHANT GARDIEN": 'Mémoire',
  'AIDA LA PANTHÈRE NOIRE': 'Mystère',
  'KOFI LE BUFFLE DES PLAINES': 'Endurance',
  'NALA LA GRUE ROYALE': 'Grâce',
  'BAKARI LE CROCODILE ANCIEN': 'Longévité',
  'FATOU LE FAUCON LIBRE': 'Liberté',
  'DAYO LE LION DU FEU': 'Intensité',
  'IMANI LA TORTUE ÉTERNELLE': 'Patience',
};

@Injectable()
export class JuniorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: SupabaseAuthService,
  ) {}

  async reveal(body: unknown, authorization?: string) {
    const parsed = juniorInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('junior_payload_invalid');
    }

    const user = await this.auth.requireUser(authorization);
    const order = await this.prisma.totemOrder.findFirst({
      where: {
        checkoutSessionId: parsed.data.checkoutSessionId,
        userId: user.id,
        offer: 'junior',
      },
    });
    if (!order || !order.paymentIntentId) {
      throw new ConflictException('junior_payment_not_confirmed');
    }

    const storedAnswers = juniorAnswersSchema.safeParse(order.answers);
    if (!storedAnswers.success) {
      throw new BadRequestException('junior_order_answers_invalid');
    }
    if (!juniorAnswersEqual(storedAnswers.data, parsed.data.answers)) {
      throw new ConflictException('junior_answers_mismatch');
    }

    const scores = computeScores(storedAnswers.data);
    const { dominant, secondary, name, quality, orderNumber, phrase, share } = computeReveal(
      storedAnswers.data,
      parsed.data.firstName,
    );

    await this.prisma.userProfile.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        role: 'junior',
        firstName: parsed.data.firstName || undefined,
        locale: parsed.data.locale || undefined,
      },
      update: {},
    });

    const existing = await this.prisma.juniorTotem.findFirst({
      where: { userId: user.id, orderNumber },
    });
    if (existing) {
      return {
        id: existing.id,
        type: 'junior',
        firstName: parsed.data.firstName || 'Toi',
        orderNumber,
        scores: existing.scores,
        dominant: existing.dominant,
        secondary: existing.secondary,
        totem: { name: existing.totemName, quality: existing.quality },
        phrase: existing.phrase,
        share: computeReveal(storedAnswers.data).share,
        imageUrl: readImageUrl(order.juniorPayload),
        saved: true,
      };
    }

    const juniorTotem = await this.prisma.juniorTotem.create({
      data: {
        userId: user.id,
        answers: storedAnswers.data as object,
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
      imageUrl: readImageUrl(order.juniorPayload),
      saved: true,
    };
  }

  async listTotems(authorization: string) {
    const user = await this.auth.requireUser(authorization);
    const juniorTotems = await this.prisma.juniorTotem.findMany({
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

    if (juniorTotems.length > 0) {
      return juniorTotems;
    }

    const orders = await this.prisma.totemOrder.findMany({
      where: {
        userId: user.id,
        offer: 'junior',
        juniorPayload: { not: null as unknown as undefined },
      },
      orderBy: { createdAt: 'desc' },
    });

    return orders
      .filter((o) => o.juniorPayload != null)
      .map((o) => {
        const payload = o.juniorPayload as Record<string, unknown>;
        return {
          id: o.id,
          totemName: (payload.totemName as string) || 'Totem Junior',
          quality: (payload.quality as string) || '',
          phrase: (payload.phrase as string) || '',
          orderNumber: (payload.orderNumber as number) || 0,
          shareCount: 0,
          createdAt: o.completedAt || o.createdAt,
          scores: (payload.scores as Record<string, number>) || {},
          dominant: (payload.dominant as string) || '',
          secondary: (payload.secondary as string) || '',
        };
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
  return scoreJuniorFeta(answers).scores;
}

export function computeReveal(answers: Record<string, { choice: string }>, firstName?: string) {
  const scored = scoreJuniorFeta(answers);
  const name = JUNIOR_TOTEM_NAMES[scored.totemId];
  const quality = qualities[name] ?? 'Presence';
  const orderNumber = (hash(JSON.stringify(scored.scores)) % 999999) + 1;
    const phrase = `Avant toi, un ancêtre portait ${qualityPhrase(quality)} dans son geste, et ce signe avance maintenant avec ton nom.`;

  return {
    totemId: scored.totemId,
    dominant: scored.dominant,
    secondary: scored.secondary,
    name,
    quality,
    orderNumber,
    phrase,
    share: {
      caption: `${name}\nQuel ancetre dort en toi ?\n#RevealYourTotem`,
      messageDefi: `J'ai découvert mon totem ancestral : ${name}. Toi, tu es quoi ? totemancestral.com`,
    },
  };
}

function qualityPhrase(quality: string) {
  const phrases: Record<string, string> = {
    Vision: 'la vision',
    Protection: 'la protection',
    Précision: 'la précision',
    Sagesse: 'la sagesse',
    Mémoire: 'la mémoire',
    Mystère: 'le mystère',
    Endurance: "l'endurance",
    Grâce: 'la grâce',
    Longévité: 'la longévité',
    Liberté: 'la liberté',
    Intensité: "l'intensité",
    Patience: 'la patience',
  };
  return phrases[quality] ?? quality.toLowerCase();
}

function readImageUrl(payload: unknown): string {
  if (typeof payload === 'object' && payload !== null) {
    const imageUrl = (payload as { imageUrl?: unknown }).imageUrl;
    if (typeof imageUrl === 'string' && imageUrl.length > 0) return imageUrl;
  }
  return '/assets/masque-ngil-authentique.webp';
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return Math.abs(result >>> 0);
}