import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TotemOrder } from "@prisma/client";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { emailFrame } from "./email-design";
import { renderAdultDelivery, renderJuniorDelivery, renderParentalConfirmation } from "./customer-emails";

type DeliveryPayload = {
  order: TotemOrder;
  imageUrl: string;
  audioUrl: string | null;
  pdfUrl: string;
  certificateUrl: string;
};

type DeliveryCopy = {
  subject: string;
  fallbackName: string;
};

type EmailTemplate = {
  subject: string;
  html_content: string;
};

type RenderedEmail = {
  subject: string;
  html: string;
};

@Injectable()
export class ResendMailerService {
  private readonly apiKey: string;
  private readonly senderEmail: string;
  private readonly senderName: string;
  private readonly alertEmail?: string;
  private readonly supabase: SupabaseClient;

  constructor(config: ConfigService) {
    this.apiKey = config.getOrThrow<string>("RESEND_API_KEY");
    this.senderEmail = config.getOrThrow<string>("RESEND_FROM_EMAIL");
    this.senderName = config.get<string>("RESEND_FROM_NAME") ?? "Totem Ancestral";
    this.alertEmail = config.get<string>("ALERT_EMAIL") ?? config.get<string>("CONTACT_EMAIL");
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

  async sendDelivery(payload: DeliveryPayload): Promise<boolean> {
    const email = payload.order.customerEmail;

    if (!email) {
      return false;
    }

    const content = await this.renderDelivery(payload);

    await this.send({
      to: [email],
      subject: content.subject,
      html: content.html,
    });

    return true;
  }

  async sendJuniorDelivery(input: {
    email: string;
    firstName: string;
    totemName: string;
    quality: string;
    phrase: string;
    locale?: string;
    orderId: string;
    pdfUrl: string;
    certificateUrl: string;
    attachments: { filename: string; content: string }[];
  }): Promise<boolean> {
    const isFr = input.locale !== "en";
    const subject = isFr
      ? `La carte ancestrale Junior de ${input.firstName} est prête`
      : `${input.firstName}’s Junior Ancestral Card is ready`;
    await this.send({
      to: [input.email],
      subject,
      html: renderJuniorDelivery(input),
      attachments: input.attachments,
      idempotencyKey: `junior-delivery-${input.orderId}`,
    });

    return true;
  }

  async sendParentConfirmation(input: { email: string; firstName: string; locale: string; link: string }): Promise<void> {
    const fr = input.locale !== "en";
    const title = fr ? "Autorisation parentale pour Totem Junior" : "Parental permission for Junior Totem";
    await this.send({ to: [input.email], subject: title, html: renderParentalConfirmation(input) });
  }

  async sendFailureAlert(orderId: string, error: string): Promise<void> {
    if (!this.alertEmail) return;

    const content = await this.renderFailure(orderId, error);

    await this.send({
      to: [this.alertEmail],
      subject: content.subject,
      html: content.html,
    });
  }

  private async renderDelivery(payload: DeliveryPayload): Promise<RenderedEmail> {
    const locale = normalizeLocale(payload.order.locale);
    const copy = readDeliveryCopy(locale);
    const template = await this.readTemplate("delivery", locale);
    // The approved layout is authoritative. Existing localized subjects remain
    // supported, but legacy HTML cannot override the new customer design.
    const subject = (template?.subject ?? copy.subject)
      .replace(/\ble parchemin ancestral\b/gi, "la carte ancestrale")
      .replace(/\bun parchemin ancestral\b/gi, "une carte ancestrale")
      .replace(/\bdu parchemin ancestral\b/gi, "de la carte ancestrale")
      .replace(/\bparchemin ancestral\b|\bparchemin\b/gi, "Carte ancestrale")
      .replace(/\bancestral parchment\b|\bancestral map\b|\bparchment\b/gi, "Ancestral Card");
    return { subject: interpolate(subject, { ancestralName: payload.order.ancestralName ?? copy.fallbackName, orderId: payload.order.id }), html: renderAdultDelivery(payload) };
  }

  private async renderFailure(orderId: string, error: string): Promise<RenderedEmail> {
    const params = {
      orderId: escapeHtml(orderId),
      error: escapeHtml(error),
    };
    const template = await this.readTemplate("pipeline_failure", "fr");

    if (template) return renderStoredTemplate(template, params);
    return {
      subject: `Erreur pipeline TOTEM ${orderId}`,
      html: renderFailureEmail(orderId, error),
    };
  }

  private async readTemplate(
    templateKey: string,
    locale: "fr" | "en",
  ): Promise<EmailTemplate | null> {
    // Missing English templates use the built-in English copy, never French.
    return this.readTemplateRow(templateKey, locale);
  }

  private async readTemplateRow(
    templateKey: string,
    locale: "fr" | "en",
  ): Promise<EmailTemplate | null> {
    const { data, error } = await this.supabase
      .from("email_templates")
      .select("subject, html_content")
      .eq("template_key", templateKey)
      .eq("locale", locale)
      .maybeSingle();

    if (error) return null;
    return data as EmailTemplate | null;
  }

  private async send(payload: { to: string[]; subject: string; html: string; attachments?: { filename: string; content: string }[]; idempotencyKey?: string }): Promise<void> {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(25_000),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
          ...(payload.idempotencyKey ? { "Idempotency-Key": payload.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: `${this.senderName} <${this.senderEmail}>`,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
          ...(payload.attachments ? { attachments: payload.attachments } : {}),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`resend_failed:${response.status}:${detail.slice(0, 300)}`);
    }
  }
}

function normalizeLocale(locale: string | null): "fr" | "en" {
  return locale === "en" ? "en" : "fr";
}

function renderStoredTemplate(
  template: EmailTemplate,
  params: Record<string, string>,
): RenderedEmail {
  return {
    subject: interpolate(template.subject, params),
    html: interpolate(template.html_content, params),
  };
}

function interpolate(template: string, params: Record<string, string>): string {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key: string) => params[key] ?? "");
}

function readDeliveryCopy(locale: "fr" | "en"): DeliveryCopy {
  if (locale === "en") {
    return {
      subject: "Your TOTEM ANCESTRAL box is ready",
      fallbackName: "Your totem",
    };
  }

  return {
    subject: "Votre coffret TOTEM ANCESTRAL est prêt",
    fallbackName: "Votre totem",
  };
}

/**
 * Gabarit HTML de marque, compatible clients mail (tables + styles inline).
 * Palette TOTEM : nuit profonde + or ancestral. Logo embarqué en base64 (pas
 * d'URL publique stable tant que le site n'est pas déployé) : PNG 84x84,
 * quelques Ko, tiré et réduit du logo réel du site.
 */
function wrapEmail(title: string, inner: string, locale: "fr" | "en" = "fr"): string {
  return emailFrame(title, inner, locale);
}

function renderFailureEmail(orderId: string, error: string): string {
  const inner = `
        <p style="margin:0 0 12px">Une erreur est survenue durant la composition d'une commande.</p>
        <p style="margin:0 0 6px;color:#8a8677;font-size:13px;text-transform:uppercase;letter-spacing:.12em">Commande</p>
        <p style="margin:0 0 18px;color:#84662e;font-size:15px;font-family:Georgia,serif">${escapeHtml(orderId)}</p>
        <pre style="white-space:pre-wrap;background:#f5f2e9;border:1px solid rgba(216,173,77,.18);border-radius:8px;padding:14px;color:#65635c;font-size:13px;margin:0">${escapeHtml(error)}</pre>`;
  return wrapEmail("Erreur pipeline", inner);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
