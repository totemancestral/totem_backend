import { BadRequestException, Body, Controller, Get, Headers, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { ConsultationCaurisService } from "./consultation-cauris.service";
import { SupabaseAuthService } from "./supabase-auth.service";

const tirageBodySchema = z.object({
  mood: z.enum(["apaise", "en_doute", "en_combat"]).optional(),
});

@Controller("consultations")
export class ConsultationCaurisController {
  constructor(
    private readonly consultations: ConsultationCaurisService,
    private readonly auth: SupabaseAuthService,
  ) {}

  @Get("etat")
  async etat(@Headers("authorization") authorization?: string, @Headers("accept-language") language?: string) {
    const user = await this.auth.requireUser(authorization);
    return this.consultations.etat(user.id, this.language(language));
  }

  @Post("tirer")
  async tirer(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("accept-language") language?: string) {
    const user = await this.auth.requireUser(authorization);
    const payload = this.readBody(body);
    return this.consultations.tirer(user.id, payload.mood, this.language(language));
  }

  @Get("historique")
  async historique(@Headers("authorization") authorization?: string, @Query("before") before?: string, @Headers("accept-language") language?: string) {
    const user = await this.auth.requireUser(authorization);
    if (before && !/^\d{4}-\d{2}-\d{2}$/.test(before)) throw new BadRequestException("invalid_cursor");
    return this.consultations.historique(user.id, before, this.language(language));
  }

  private language(value?: string): "fr" | "en" {
    return /^en(?:[-,;]|$)/i.test(value?.trim() ?? "") ? "en" : "fr";
  }

  private readBody(body: unknown) {
    try {
      return tirageBodySchema.parse(body ?? {});
    } catch (error) {
      throw new BadRequestException({
        code: "tirage_payload_invalid",
        detail: error instanceof Error ? error.message : "invalid_payload",
      });
    }
  }
}
