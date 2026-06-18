import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TotemOrder } from "@prisma/client";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { StoredArtefact, TotemTextPayload } from "./totem.types";

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
    if (!input.externalCommandId || !isUuid(input.externalCommandId)) return;

    const { error } = await this.supabase
      .from("commandes")
      .update({ stripe_session_id: input.checkoutSessionId })
      .eq("id", input.externalCommandId)
      .eq("user_id", input.userId);

    if (error) throw new Error(`supabase_command_attach_failed:${error.message}`);
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

    const { error } = await this.supabase.from("commandes").update(patch).eq("id", commandId);
    if (error) throw new Error(`supabase_command_paid_failed:${error.message}`);

    return commandId;
  }

  async markProcessing(order: TotemOrder): Promise<void> {
    const commandId = await this.findCommandId(order);
    if (!commandId) return;

    const { error } = await this.supabase
      .from("commandes")
      .update({ statut: "en_generation" })
      .eq("id", commandId);

    if (error) throw new Error(`supabase_command_processing_failed:${error.message}`);
  }

  async markDelivered(input: {
    order: TotemOrder;
    text: TotemTextPayload;
    image: StoredArtefact;
    audio: StoredArtefact;
    pdf: StoredArtefact;
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
      audio_url: input.audio.url,
      pdf_url: input.pdf.url,
      statut: "livree",
      metadata: {
        source: "totem-backend",
        totemOrderId: input.order.id,
        archetypeId: input.text.archetypeId,
        imageKey: input.image.key,
        audioKey: input.audio.key,
        pdfKey: input.pdf.key,
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

    const { error } = await this.supabase
      .from("commandes")
      .update({ statut: "livree" })
      .eq("id", commandId);
    if (error) throw new Error(`supabase_command_delivered_failed:${error.message}`);
  }

  async markFailed(order: TotemOrder | null, message: string): Promise<void> {
    if (!order) return;
    const commandId = await this.findCommandId(order);
    if (!commandId) return;

    await this.supabase.from("commandes").update({ statut: "erreur" }).eq("id", commandId);
    await this.supabase.from("erreurs_pipeline").insert({
      commande_id: commandId,
      etape: "pipeline",
      message,
    });
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

    const { data, error } = await this.supabase
      .from("commandes")
      .insert({
        user_id: input.order.userId,
        offre: input.order.offer,
        statut: "paye",
        montant_cents: input.amountCents ?? input.order.amountCents ?? 0,
        devise: (input.currency ?? input.order.currency ?? "EUR").toUpperCase(),
        stripe_session_id: input.order.checkoutSessionId,
        stripe_payment_intent_id: input.paymentIntentId ?? input.order.paymentIntentId,
        pays: input.country ?? input.order.country,
        langue: input.order.locale ?? "fr",
      })
      .select("id")
      .single();

    if (error || !data) throw new Error(`supabase_command_create_failed:${error?.message}`);
    return data.id as string;
  }

  private async insertOeuvre(oeuvre: Record<string, unknown>): Promise<string> {
    const { data, error } = await this.supabase
      .from("oeuvres")
      .insert(oeuvre)
      .select("id")
      .single();

    if (error || !data) throw new Error(`supabase_oeuvre_mirror_failed:${error?.message}`);
    return data.id as string;
  }

  private async updateOeuvre(id: string, oeuvre: Record<string, unknown>): Promise<string> {
    const { error } = await this.supabase.from("oeuvres").update(oeuvre).eq("id", id);

    if (error) throw new Error(`supabase_oeuvre_mirror_failed:${error.message}`);
    return id;
  }

  private async ensureInitialVersion(input: {
    oeuvreId: string;
    userId: string;
    text: TotemTextPayload;
    image: StoredArtefact;
  }): Promise<void> {
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
  }

  private async findCommandId(
    order: TotemOrder,
    externalCommandId?: string,
  ): Promise<string | null> {
    if (externalCommandId && isUuid(externalCommandId)) {
      const { data, error } = await this.supabase
        .from("commandes")
        .select("id")
        .eq("id", externalCommandId)
        .maybeSingle();
      if (error) throw new Error(`supabase_command_lookup_failed:${error.message}`);
      if (data?.id) return data.id as string;
    }

    const session = await this.findCommandByColumn("stripe_session_id", order.checkoutSessionId);
    if (session) return session;

    if (order.paymentIntentId) {
      return this.findCommandByColumn("stripe_payment_intent_id", order.paymentIntentId);
    }

    return null;
  }

  private async findCommandByColumn(column: string, value: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from("commandes")
      .select("id")
      .eq(column, value)
      .maybeSingle();

    if (error) throw new Error(`supabase_command_lookup_failed:${error.message}`);
    return (data?.id as string | undefined) ?? null;
  }
}

function composeDeliveredStory(text: TotemTextPayload): string {
  const pages = text.storyPages.map((page) => `${page.title}\n${page.text}`.trim()).filter(Boolean);

  return [text.parchmentText, ...pages].filter(Boolean).join("\n\n");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
