import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TotemOrder } from "@prisma/client";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type DeliveryPayload = {
  order: TotemOrder;
  imageUrl: string;
  audioUrl: string;
  pdfUrl: string;
};

type DeliveryCopy = {
  subject: string;
  ready: string;
  linksIntro: string;
  image: string;
  audio: string;
  pdf: string;
  signedNotice: string;
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
    const params = {
      ancestralName: escapeHtml(payload.order.ancestralName ?? copy.fallbackName),
      orderId: escapeHtml(payload.order.id),
      imageUrl: escapeAttribute(payload.imageUrl),
      audioUrl: escapeAttribute(payload.audioUrl),
      pdfUrl: escapeAttribute(payload.pdfUrl),
    };
    const template = await this.readTemplate("delivery", locale);

    if (template) return renderStoredTemplate(template, params);
    return renderFallbackDelivery(payload, copy);
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
    const localized = await this.readTemplateRow(templateKey, locale);
    if (localized || locale === "fr") return localized;
    return this.readTemplateRow(templateKey, "fr");
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

  private async send(payload: { to: string[]; subject: string; html: string }): Promise<void> {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${this.senderName} <${this.senderEmail}>`,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
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
      ready: "Your digital box is ready.",
      linksIntro: "Your files are available here:",
      image: "Image",
      audio: "Audio",
      pdf: "PDF",
      signedNotice: "These signed links remain valid for 30 days.",
      fallbackName: "Your totem",
    };
  }

  return {
    subject: "Votre coffret TOTEM ANCESTRAL est pret",
    ready: "Votre coffret digital est pret.",
    linksIntro: "Vos fichiers sont disponibles ici :",
    image: "Image",
    audio: "Audio",
    pdf: "PDF",
    signedNotice: "Ces liens signes restent valides pendant 30 jours.",
    fallbackName: "Votre totem",
  };
}

function renderFallbackDelivery(payload: DeliveryPayload, copy: DeliveryCopy): RenderedEmail {
  const name = escapeHtml(payload.order.ancestralName ?? copy.fallbackName);

  return {
    subject: copy.subject,
    html: `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #171717;">
      <h1>TOTEM ANCESTRAL</h1>
      <p>${copy.ready}</p>
      <p><strong>${name}</strong></p>
      <p>${copy.linksIntro}</p>
      <ul>
        <li><a href="${escapeAttribute(payload.imageUrl)}">${copy.image}</a></li>
        <li><a href="${escapeAttribute(payload.audioUrl)}">${copy.audio}</a></li>
        <li><a href="${escapeAttribute(payload.pdfUrl)}">${copy.pdf}</a></li>
      </ul>
      <p>${copy.signedNotice}</p>
    </div>
  `,
  };
}

function renderFailureEmail(orderId: string, error: string): string {
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #171717;">
      <h1>Erreur pipeline TOTEM</h1>
      <p><strong>Commande:</strong> ${escapeHtml(orderId)}</p>
      <pre style="white-space: pre-wrap;">${escapeHtml(error)}</pre>
    </div>
  `;
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
