import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TotemOrder } from "@prisma/client";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { StoredArtefact, TotemTextPayload } from "./totem.types";
import { deliveredParchmentText } from "./parchment-text";

@Injectable()
export class SupabaseMirrorService {
  private readonly supabase: SupabaseClient;

  constructor(config: ConfigService) {
    this.supabase = createClient(
      config.getOrThrow<string>("SUPABASE_URL"),
      config.getOrThrow<string>("SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );
  }

  async attachCheckoutSession(input: {
    externalCommandId?: string;
    userId: string;
    checkoutSessionId: string;
  }): Promise<void> {
    if (!input.externalCommandId) return;
    await this.requireOwnedCommand(input.externalCommandId, input.userId);
    await this.updateOwnedCommand(input.externalCommandId, input.userId, {
      stripe_session_id: input.checkoutSessionId,
    });
  }

  async requireOwnedCommand(commandId: string, userId: string): Promise<string> {
    if (!isUuid(commandId)) throw new BadRequestException("external_command_invalid");
    const { data, error } = await this.supabase.from("commandes").select("id")
      .eq("id", commandId).eq("user_id", userId).maybeSingle();
    if (error) throw new Error(`supabase_command_lookup_failed:${error.message}`);
    if (!data?.id) throw new NotFoundException("commande_not_found");
    return data.id as string;
  }

  private async updateOwnedCommand(commandId: string, userId: string, patch: Record<string, unknown>): Promise<void> {
    const { data, error } = await this.supabase.from("commandes").update(patch)
      .eq("id", commandId).eq("user_id", userId).select("id").maybeSingle();
    if (error) throw new Error(`supabase_command_update_failed:${error.message}`);
    if (!data?.id) throw new NotFoundException("commande_not_found");
  }

  async markPaid(input: {
    order: TotemOrder;
    externalCommandId?: string;
    paymentIntentId?: string;
    amountCents?: number;
    currency?: string;
    country?: string;
  }): Promise<string> {
    const commandId = await this.findOrCreateCommand(input);
    const patch: Record<string, unknown> = {
      statut: "paye",
      stripe_session_id: input.order.checkoutSessionId,
      stripe_payment_intent_id: input.paymentIntentId ?? input.order.paymentIntentId,
      montant_cents: input.amountCents ?? input.order.amountCents ?? 0,
      devise: (input.currency ?? input.order.currency ?? "EUR").toUpperCase(),
      pays: input.country ?? input.order.country,
      langue: input.order.locale ?? "fr",
    };

    try {
      await this.updateOwnedCommand(commandId, input.order.userId, patch);
    } catch (error) {
      if (!(error instanceof Error) || !isMissingColumnError(error.message, "pays")) throw error;
      delete patch.pays;
      await this.updateOwnedCommand(commandId, input.order.userId, patch);
    }

    return commandId;
  }

  async markProcessing(order: TotemOrder): Promise<void> {
    const commandId = await this.findCommandId(order);
    if (!commandId) return;

    await this.updateOwnedCommand(commandId, order.userId, { statut: "en_generation" });
  }

  async markDelivered(input: {
    order: TotemOrder;
    text: TotemTextPayload;
    image: StoredArtefact;
    audio: StoredArtefact | null;
    pdf: StoredArtefact;
    certificate: StoredArtefact;
  }): Promise<void> {
    const commandId = await this.findCommandId(input.order);
    if (!commandId) return;

    const numeroSerie = `TTM-${new Date().getFullYear()}-${commandId.slice(0, 8).toUpperCase()}`;
    const oeuvre = {
      user_id: input.order.userId,
      commande_id: commandId,
      numero_serie: numeroSerie,
      nom_totem: input.text.ancestralName,
      recit: composeDeliveredStory(input.text),
      image_url: input.image.url,
      audio_url: input.audio?.url ?? null,
      pdf_url: input.pdf.url,
      certificate_url: input.certificate.url,
      statut: "livree",
      metadata: {
        source: "totem-backend",
        totemOrderId: input.order.id,
        archetypeId: input.text.archetypeId,
        nomComplet: input.text.ancestralName,
        workTitleFr: input.text.workTitleFr,
        workTitleEn: input.text.workTitleEn,
        people: input.text.people,
        region: input.text.region,
        scores: input.text.scores,
        dominant: input.text.dominant,
        secondary: input.text.secondary,
        narrativeVariant: input.text.narrativeVariant,
        visualFrame: input.text.visualFrame,
        share: input.text.shareMessages,
        langue: input.order.locale ?? "fr",
        offre: input.order.offer,
        imageKey: input.image.key,
        audioKey: input.audio?.key ?? null,
        pdfKey: input.pdf.key,
        certificateKey: input.certificate.key,
      },
    };

    const { data: existing, error: existingError } = await this.supabase
      .from("oeuvres")
      .select("id")
      .eq("commande_id", commandId)
      .maybeSingle();
    if (existingError) throw new Error(`supabase_oeuvre_lookup_failed:${existingError.message}`);

    const oeuvreId = existing
      ? await this.updateOeuvre(existing.id as string, oeuvre)
      : await this.insertOeuvre(oeuvre);

    await this.ensureInitialVersion({
      oeuvreId,
      userId: input.order.userId,
      text: input.text,
      image: input.image,
    });

    await this.updateOwnedCommand(commandId, input.order.userId, { statut: "livree" });
  }

  async markJuniorDelivered(input: {
    order: TotemOrder;
    reveal: {
      totemId: string;
      name: string;
      quality: string;
      phrase: string;
      orderNumber: number;
      dominant: string;
      secondary: string;
      share: { caption: string; messageDefi: string };
    };
    image?: { url: string; key: string } | null;
    scores?: Record<string, number>;
  }): Promise<void> {
    const commandId = await this.findCommandId(input.order);
    if (!commandId) return;

    const numeroSerie = `JNR-${new Date().getFullYear()}-${commandId.slice(0, 8).toUpperCase()}`;
    const oeuvre = {
      user_id: input.order.userId,
      commande_id: commandId,
      numero_serie: numeroSerie,
      nom_totem: input.reveal.name,
      recit: input.reveal.phrase,
      image_url: input.image?.url ?? "/assets/masque-ngil-authentique.webp",
      statut: "livree",
      metadata: {
        type: "junior",
        source: "totem-backend",
        totemOrderId: input.order.id,
        totemId: input.reveal.totemId,
        totem: {
          name: input.reveal.name,
          quality: input.reveal.quality,
        },
        orderNumber: input.reveal.orderNumber,
        scores: input.scores,
        dominant: input.reveal.dominant,
        secondary: input.reveal.secondary,
        share: input.reveal.share,
        attribut: input.reveal.quality,
        langue: input.order.locale ?? "fr",
        offre: "junior",
        imageKey: input.image?.key ?? null,
      },
    };

    const { data: existing } = await this.supabase
      .from("oeuvres")
      .select("id")
      .eq("commande_id", commandId)
      .maybeSingle();

    if (existing) {
      await this.updateOeuvre(existing.id as string, oeuvre);
    } else {
      await this.insertOeuvre(oeuvre);
    }

    await this.updateOwnedCommand(commandId, input.order.userId, { statut: "livree" });

    // Delete any draft for this junior flow
    await this.supabase
      .from("brouillons_parcours")
      .delete()
      .eq("user_id", input.order.userId)
      .eq("piste", "junior");
  }

  async markRetrying(commandId: string): Promise<void> {
    await this.supabase.from("commandes").update({ statut: "en_generation" }).eq("id", commandId);
    await this.supabase.from("oeuvres").update({ statut: "en_generation" }).eq("commande_id", commandId);
    // Keep previous failures as history; retrying does not erase their evidence.
  }

  async markFailed(order: TotemOrder | null, message: string): Promise<void> {
    if (!order) return;
    const commandId = await this.findCommandId(order);
    if (!commandId) return;

    await this.updateOwnedCommand(commandId, order.userId, { statut: "erreur" });
    await this.supabase.from("erreurs_pipeline").insert({
      commande_id: commandId,
      etape: "pipeline",
      message,
    });
  }

  async readCommandByExternalId(
    externalCommandId: string,
  ): Promise<{ id: string; checkoutSessionId: string; status: string } | null> {
    if (!isUuid(externalCommandId)) return null;

    const { data, error } = await this.supabase
      .from("commandes")
      .select("id, stripe_session_id, statut")
      .eq("id", externalCommandId)
      .maybeSingle();

    if (error) throw new Error(`supabase_command_lookup_failed:${error.message}`);
    if (!data?.id) return null;

    return {
      id: data.id as string,
      checkoutSessionId: data.stripe_session_id as string,
      status: data.statut as string,
    };
  }

  async readPaidCommand(input: {
    externalCommandId: string;
    userId: string;
  }): Promise<{ id: string; checkoutSessionId: string; status: string }> {
    if (!isUuid(input.externalCommandId)) throw new Error("external_command_invalid");

    const { data, error } = await this.supabase
      .from("commandes")
      .select("id, stripe_session_id, statut")
      .eq("id", input.externalCommandId)
      .eq("user_id", input.userId)
      .maybeSingle();

    if (error) throw new Error(`supabase_command_lookup_failed:${error.message}`);
    if (!data?.id) throw new Error("commande_not_found");
    if (data.statut !== "paye" && data.statut !== "en_generation" && data.statut !== "livree") {
      throw new Error("payment_not_confirmed");
    }
    if (!data.stripe_session_id) throw new Error("stripe_session_missing");

    return {
      id: data.id as string,
      checkoutSessionId: data.stripe_session_id as string,
      status: data.statut as string,
    };
  }

  private async findOrCreateCommand(input: {
    order: TotemOrder;
    externalCommandId?: string;
    paymentIntentId?: string;
    amountCents?: number;
    currency?: string;
    country?: string;
  }): Promise<string> {
    const existing = await this.findCommandId(input.order, input.externalCommandId);
    if (existing) return existing;

    const command: Record<string, unknown> = {
      user_id: input.order.userId,
      offre: input.order.offer,
      statut: "paye",
      montant_cents: input.amountCents ?? input.order.amountCents ?? 0,
      devise: (input.currency ?? input.order.currency ?? "EUR").toUpperCase(),
      stripe_session_id: input.order.checkoutSessionId,
      stripe_payment_intent_id: input.paymentIntentId ?? input.order.paymentIntentId,
      pays: input.country ?? input.order.country,
      langue: input.order.locale ?? "fr",
    };

    let result = await this.supabase
      .from("commandes")
      .insert(command)
      .select("id")
      .single();

    if (result.error && isMissingColumnError(result.error.message, "pays")) {
      delete command.pays;
      result = await this.supabase.from("commandes").insert(command).select("id").single();
    }

    if (result.error || !result.data) {
      throw new Error(`supabase_command_create_failed:${result.error?.message}`);
    }
    return result.data.id as string;
  }

  private async insertOeuvre(oeuvre: Record<string, unknown>): Promise<string> {
    let { data, error } = await this.supabase
      .from("oeuvres")
      .insert(oeuvre)
      .select("id")
      .single();

    if (error && isMissingColumnError(error.message, "certificate_url")) {
      const patch = { ...oeuvre };
      delete patch.certificate_url;
      ({ data, error } = await this.supabase.from("oeuvres").insert(patch).select("id").single());
    }

    if (error || !data) throw new Error(`supabase_oeuvre_mirror_failed:${error?.message}`);
    return data.id as string;
  }

  private async updateOeuvre(id: string, oeuvre: Record<string, unknown>): Promise<string> {
    let { error } = await this.supabase.from("oeuvres").update(oeuvre).eq("id", id);

    if (error && isMissingColumnError(error.message, "certificate_url")) {
      const patch = { ...oeuvre };
      delete patch.certificate_url;
      ({ error } = await this.supabase.from("oeuvres").update(patch).eq("id", id));
    }

    if (error) throw new Error(`supabase_oeuvre_mirror_failed:${error.message}`);
    return id;
  }

  private async ensureInitialVersion(input: {
    oeuvreId: string;
    userId: string;
    text: TotemTextPayload;
    image: StoredArtefact;
  }): Promise<void> {
    try {
      const { data: existing, error: lookupError } = await this.supabase
        .from("oeuvre_versions")
        .select("id")
        .eq("oeuvre_id", input.oeuvreId)
        .eq("version", 1)
        .eq("type", "full")
        .maybeSingle();

      if (lookupError) throw new Error(`supabase_version_lookup_failed:${lookupError.message}`);

      const version = {
        oeuvre_id: input.oeuvreId,
        user_id: input.userId,
        version: 1,
        type: "full",
        recit: composeDeliveredStory(input.text),
        nom_totem: input.text.ancestralName,
        image_url: input.image.url,
        is_current: true,
      };

      const result = existing
        ? await this.supabase.from("oeuvre_versions").update(version).eq("id", existing.id)
        : await this.supabase.from("oeuvre_versions").insert(version);

      if (result.error) throw new Error(`supabase_version_mirror_failed:${result.error.message}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`supabase_version_mirror_skipped:${message}`);
    }
  }

  private async findCommandId(
    order: TotemOrder,
    externalCommandId?: string,
  ): Promise<string | null> {
    if (externalCommandId !== undefined) {
      return this.requireOwnedCommand(externalCommandId, order.userId);
    }

    const session = await this.findCommandByColumn("stripe_session_id", order.checkoutSessionId, order.userId);
    if (session) return session;

    if (order.paymentIntentId) {
      return this.findCommandByColumn("stripe_payment_intent_id", order.paymentIntentId, order.userId);
    }

    return null;
  }

  private async findCommandByColumn(column: string, value: string, userId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from("commandes")
      .select("id")
      .eq(column, value)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw new Error(`supabase_command_lookup_failed:${error.message}`);
    return (data?.id as string | undefined) ?? null;
  }
}

function composeDeliveredStory(text: TotemTextPayload): string {
  return deliveredParchmentText(text);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isMissingColumnError(message: string, column: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes(column.toLowerCase()) && lower.includes("column");
}
