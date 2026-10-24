import { ForbiddenException, Injectable } from "@nestjs/common";
import { CaurisMood, ConsultationReading, Prisma, TotemOrderStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CAURIS_ANTI_REPEAT_WINDOW, caurisSerieForArchetype, drawCauris, nextParisWeekStart, parisWeekKey, restoreCaurisDraw } from "./totem-cauris-draw";

@Injectable()
export class ConsultationCaurisService {
  constructor(private readonly prisma: PrismaService) {}

  async etat(userId: string, language: "fr" | "en" = "fr") {
    const now = new Date();
    const [order, current] = await Promise.all([this.latestAdultOrder(userId), this.currentReading(userId, now)]);
    const currentReading = current ? this.serialize(current, language) : null;
    if (!order?.archetypeId) return { accessible: false, reason: "oeuvre_required", currentReading };
    const serie = caurisSerieForArchetype(order.archetypeId);
    if (!serie) return { accessible: false, reason: "serie_indisponible", currentReading };
    return {
      accessible: true, archetypeId: order.archetypeId, serie, ancestralName: order.ancestralName,
      availableNow: !current, nextAvailableAt: current ? nextParisWeekStart(now).toISOString() : null,
      currentReading,
    };
  }

  async historique(userId: string, before?: string, language: "fr" | "en" = "fr") {
    const rows = await this.prisma.consultationReading.findMany({
      where: { userId, ...(before ? { weekKey: { lt: before } } : {}) },
      orderBy: { weekKey: "desc" }, take: 21,
    });
    return { readings: rows.slice(0, 20).map((row) => this.serialize(row, language)), nextCursor: rows.length > 20 ? rows[19]!.weekKey : null };
  }

  async tirer(userId: string, mood?: CaurisMood, language: "fr" | "en" = "fr") {
    const now = new Date();
    const existing = await this.currentReading(userId, now);
    if (existing) return this.drawResponse(existing, now, true, language);
    const order = await this.latestAdultOrder(userId);
    if (!order?.archetypeId) throw new ForbiddenException("oeuvre_required");
    if (!caurisSerieForArchetype(order.archetypeId)) throw new ForbiddenException("serie_indisponible");

    // L'accès reste lié à l'œuvre adulte : aucun abonnement supplémentaire.
    await this.prisma.userProfile.upsert({
      where: { id: userId },
      create: { id: userId, role: "adulte", firstName: order.customerName, locale: order.locale },
      update: {},
    });
    const pastReadings = await this.prisma.consultationReading.findMany({
      where: { userId }, orderBy: { createdAt: "desc" }, take: CAURIS_ANTI_REPEAT_WINDOW,
    });
    const draw = drawCauris({ archetypeId: order.archetypeId, pastReadings });
    if (!draw) throw new ForbiddenException("serie_indisponible");
    try {
      const saved = await this.prisma.consultationReading.create({ data: {
        userId, orderId: order.id, archetypeId: order.archetypeId, ancestralName: order.ancestralName,
        serie: draw.serie, imageCode: draw.imageCode, paroleCode: draw.paroleCode, gesteCode: draw.gesteCode,
        readingPayload: { image: draw.image, parole: draw.parole, geste: draw.geste,
          en: restoreCaurisDraw(draw, "en")! },
        mood, weekKey: parisWeekKey(now), createdAt: now,
      } });
      return this.drawResponse(saved, now, false, language);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const winner = await this.currentReading(userId, now);
        if (winner) return this.drawResponse(winner, now, true, language);
      }
      throw error;
    }
  }

  private drawResponse(reading: ConsultationReading, now: Date, alreadyDrawn: boolean, language: "fr" | "en") {
    return { reading: this.serialize(reading, language), alreadyDrawn, nextAvailableAt: nextParisWeekStart(now).toISOString() };
  }

  private serialize(reading: ConsultationReading, language: "fr" | "en") {
    const payload = reading.readingPayload;
    const snapshot = payload && typeof payload === "object" && !Array.isArray(payload)
      && typeof payload.image === "string" && typeof payload.parole === "string" && typeof payload.geste === "string"
      ? { image: payload.image, parole: payload.parole, geste: payload.geste } : null;
    const englishPayload = payload && typeof payload === "object" && !Array.isArray(payload) ? payload.en : null;
    const englishSnapshot = englishPayload && typeof englishPayload === "object" && !Array.isArray(englishPayload)
      && typeof englishPayload.image === "string" && typeof englishPayload.parole === "string" && typeof englishPayload.geste === "string"
      ? { image: englishPayload.image, parole: englishPayload.parole, geste: englishPayload.geste } : null;
    const english = language === "en" ? englishSnapshot ?? restoreCaurisDraw(reading, "en") : null;
    const text = english ?? snapshot ?? restoreCaurisDraw(reading);
    return {
      id: reading.id, weekKey: reading.weekKey, createdAt: reading.createdAt.toISOString(),
      archetypeId: reading.archetypeId, ancestralName: reading.ancestralName, mood: reading.mood,
      language: english ? "en" : "fr", image: text?.image ?? null, parole: text?.parole ?? null, geste: text?.geste ?? null,
    };
  }

  private currentReading(userId: string, now: Date) {
    return this.prisma.consultationReading.findFirst({ where: { userId, weekKey: parisWeekKey(now) } });
  }

  private latestAdultOrder(userId: string) {
    return this.prisma.totemOrder.findFirst({
      where: { userId, status: TotemOrderStatus.done, offer: { not: "junior" }, archetypeId: { not: null } },
      orderBy: { completedAt: "desc" },
    });
  }
}
