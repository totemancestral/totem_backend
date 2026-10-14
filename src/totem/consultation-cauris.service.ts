import { ForbiddenException, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { CaurisMood, TotemOrderStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  CAURIS_ANTI_REPEAT_WINDOW,
  canDrawThisWeek,
  caurisRestitution,
  caurisSerieForArchetype,
  drawCauris,
  nextParisWeekStart,
  parisWeekKey,
} from "./totem-cauris-draw";

@Injectable()
export class ConsultationCaurisService {
  constructor(private readonly prisma: PrismaService) {}

  async etat(userId: string) {
    const order = await this.latestAdultOrder(userId);
    if (!order?.archetypeId) {
      return { accessible: false as const, reason: "oeuvre_required" as const };
    }

    const serie = caurisSerieForArchetype(order.archetypeId);
    if (!serie) {
      return { accessible: false as const, reason: "serie_indisponible" as const };
    }

    const last = await this.lastReading(userId);
    const now = new Date();
    const availableNow = canDrawThisWeek(last?.createdAt ?? null, now);

    return {
      accessible: true as const,
      archetypeId: order.archetypeId,
      serie,
      ancestralName: order.ancestralName,
      availableNow,
      nextAvailableAt: availableNow ? null : nextParisWeekStart(now).toISOString(),
    };
  }

  async tirer(userId: string, mood?: CaurisMood) {
    const order = await this.latestAdultOrder(userId);
    if (!order?.archetypeId) {
      throw new ForbiddenException("oeuvre_required");
    }

    // Garde provisoire : l'abonnement Stripe recurrent (Doc 16, 4.8 etape 2)
    // n'est pas encore concu. Seule la possession d'une oeuvre est verifiee
    // pour l'instant, par decision explicite (construire tirage + table
    // d'abord, abonnement dans un second temps).
    const serie = caurisSerieForArchetype(order.archetypeId);
    if (!serie) {
      throw new ForbiddenException("serie_indisponible");
    }

    const now = new Date();
    const last = await this.lastReading(userId);
    if (!canDrawThisWeek(last?.createdAt ?? null, now)) {
      throw new HttpException(
        { code: "tirage_deja_fait", nextAvailableAt: nextParisWeekStart(now).toISOString() },
        HttpStatus.CONFLICT,
      );
    }

    const pastReadings = await this.prisma.consultationReading.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: CAURIS_ANTI_REPEAT_WINDOW,
    });

    const draw = drawCauris({ archetypeId: order.archetypeId, pastReadings });
    if (!draw) {
      throw new ForbiddenException("serie_indisponible");
    }

    await this.prisma.consultationReading.create({
      data: {
        userId,
        archetypeId: order.archetypeId,
        serie: draw.serie,
        imageCode: draw.imageCode,
        paroleCode: draw.paroleCode,
        gesteCode: draw.gesteCode,
        mood,
        weekKey: parisWeekKey(now),
      },
    });

    return {
      ...caurisRestitution(draw, order.ancestralName ?? ""),
      nextAvailableAt: nextParisWeekStart(now).toISOString(),
    };
  }

  private latestAdultOrder(userId: string) {
    return this.prisma.totemOrder.findFirst({
      where: {
        userId,
        status: TotemOrderStatus.done,
        offer: { not: "junior" },
        archetypeId: { not: null },
      },
      orderBy: { completedAt: "desc" },
    });
  }

  private lastReading(userId: string) {
    return this.prisma.consultationReading.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }
}
