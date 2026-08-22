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
  title: string;
  nameLabel: string;
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

  async sendJuniorDelivery(input: {
    email: string;
    firstName: string;
    totemName: string;
    quality: string;
    phrase: string;
    locale?: string;
  }): Promise<boolean> {
    const isFr = input.locale !== "en";
    const subject = isFr
      ? `Ton Totem Junior est prêt : ${input.totemName}`
      : `Your Junior Totem is ready: ${input.totemName}`;

    const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="background-color: #0b0b14; color: #f5f0e8; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 40px 20px; text-align: center;">
      <div style="max-width: 520px; margin: 0 auto; background: #121422; border: 1px solid rgba(216,173,77,0.3); border-radius: 16px; padding: 32px;">
        <h1 style="color: #d4af37; font-size: 24px; text-transform: uppercase; margin-bottom: 8px;">
          ${isFr ? "Ton Totem Junior s'est réveillé !" : "Your Junior Totem has awakened!"}
        </h1>
        <p style="color: rgba(245,240,232,0.8); font-size: 15px; margin-bottom: 24px;">
          ${isFr ? `Bonjour ${input.firstName}, ton voyage a révélé ton animal totem et ton nom sacré.` : `Hello ${input.firstName}, your journey has revealed your totem animal and ancestral name.`}
        </p>
        <div style="background: rgba(216,173,77,0.08); border: 1px solid rgba(216,173,77,0.25); border-radius: 12px; padding: 20px; margin-bottom: 28px;">
          <h2 style="color: #ecd99a; font-size: 20px; text-transform: uppercase; margin: 0 0 8px 0;">
            ${input.totemName}
          </h2>
          <p style="color: #d4af37; font-size: 13px; font-weight: bold; margin: 0 0 12px 0;">
            ${input.quality}
          </p>
          <p style="color: #f5f0e8; font-size: 14px; font-style: italic; margin: 0;">
            "${input.phrase}"
          </p>
        </div>
        <a href="https://totem-ancestral.com/${isFr ? "fr" : "en"}/domus_animi" style="display: inline-block; background: #d4af37; color: #0b0b14; font-weight: bold; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-size: 14px; text-transform: uppercase;">
          ${isFr ? "Accéder à mon espace personnel" : "Go to my dashboard"}
        </a>
      </div>
    </body>
    </html>
    `;

    await this.send({
      to: [input.email],
      subject,
      html,
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
      title: "Your artwork is ready",
      nameLabel: "Ancestral name",
      ready: "Your digital box is composed and waiting for you.",
      linksIntro: "Your files are available here:",
      image: "Image",
      audio: "Audio",
      pdf: "Parchment (PDF)",
      signedNotice: "These signed links remain valid for 30 days.",
      fallbackName: "Your totem",
    };
  }

  return {
    subject: "Votre coffret TOTEM ANCESTRAL est pret",
    title: "Votre oeuvre est prete",
    nameLabel: "Nom ancestral",
    ready: "Votre coffret numerique est compose et vous attend.",
    linksIntro: "Vos fichiers sont disponibles ici :",
    image: "Image",
    audio: "Audio",
    pdf: "Parchemin (PDF)",
    signedNotice: "Ces liens signes restent valides pendant 30 jours.",
    fallbackName: "Votre totem",
  };
}

/**
 * Gabarit HTML de marque, compatible clients mail (tables + styles inline).
 * Palette TOTEM : nuit profonde + or ancestral.
 */
function wrapEmail(title: string, inner: string): string {
  const site = "https://totem-ancestral.com";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0b12;padding:36px 16px;font-family:Arial,Helvetica,sans-serif">
  <tr><td align="center">
    <table role="presentation" width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;background:#16121b;background:linear-gradient(160deg,#1a1c27 0%,#131420 55%,#0e0f17 100%);border:1px solid rgba(216,173,77,.34);border-radius:22px;overflow:hidden;box-shadow:0 24px 60px -30px rgba(216,173,77,.4)">
      <tr><td style="height:3px;line-height:3px;font-size:0;background:linear-gradient(90deg,transparent,rgba(216,173,77,.85),transparent)">&nbsp;</td></tr>
      <tr><td style="padding:30px 36px 0">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td valign="middle"><img src="${site}/assets/totem-logo.png" width="42" height="42" alt="" style="display:block;border:0;outline:none"></td>
          <td valign="middle" style="padding-left:13px">
            <div style="letter-spacing:.26em;text-transform:uppercase;color:#d8ad4d;font-size:13px;font-weight:700">TOTEM ANCESTRAL</div>
          </td>
        </tr></table>
        <div style="height:1px;background:linear-gradient(90deg,rgba(216,173,77,.6),transparent);margin:22px 0 22px"></div>
        <h1 style="font-size:27px;line-height:1.18;margin:0 0 16px;color:#fff;font-family:Georgia,serif">${title}</h1>
      </td></tr>
      <tr><td style="padding:0 36px 6px;color:#e2e1ee;font-size:15px;line-height:1.66">${inner}</td></tr>
      <tr><td style="padding:26px 36px 32px">
        <div style="height:1px;background:rgba(216,173,77,.18);margin:20px 0 16px"></div>
        <p style="margin:0;color:#8a8677;font-size:12px">Totem Ancestral &middot; <a href="mailto:contact@totem-ancestral.com" style="color:#8a8677">contact@totem-ancestral.com</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}

function fileLink(url: string, label: string): string {
  return `<a href="${escapeAttribute(url)}" style="display:inline-block;margin:0 14px 8px 0;color:#f6c865;text-decoration:none;font-size:13px;border-bottom:1px solid rgba(246,200,101,.35);padding-bottom:2px">${label} &rarr;</a>`;
}

function renderFallbackDelivery(payload: DeliveryPayload, copy: DeliveryCopy): RenderedEmail {
  const name = escapeHtml(payload.order.ancestralName ?? copy.fallbackName);
  const inner = `
        <p style="margin:0 0 16px">${copy.ready}</p>
        <p style="margin:0 0 4px;color:#8a8677;font-size:13px;text-transform:uppercase;letter-spacing:.12em">${copy.nameLabel}</p>
        <p style="margin:0 0 22px;color:#f6c865;font-size:20px;font-family:Georgia,serif">${name}</p>
        <p style="margin:0 0 10px">${copy.linksIntro}</p>
        <p style="margin:0 0 18px">${fileLink(payload.imageUrl, copy.image)}${fileLink(payload.audioUrl, copy.audio)}${fileLink(payload.pdfUrl, copy.pdf)}</p>
        <p style="margin:0;color:#8a8677;font-size:13px">${copy.signedNotice}</p>`;

  return {
    subject: copy.subject,
    html: wrapEmail(copy.title, inner),
  };
}

function renderFailureEmail(orderId: string, error: string): string {
  const inner = `
        <p style="margin:0 0 12px">Une erreur est survenue durant la composition d'une commande.</p>
        <p style="margin:0 0 6px;color:#8a8677;font-size:13px;text-transform:uppercase;letter-spacing:.12em">Commande</p>
        <p style="margin:0 0 18px;color:#f6c865;font-size:15px;font-family:Georgia,serif">${escapeHtml(orderId)}</p>
        <pre style="white-space:pre-wrap;background:#0c0e16;border:1px solid rgba(216,173,77,.18);border-radius:8px;padding:14px;color:#e2e1ee;font-size:13px;margin:0">${escapeHtml(error)}</pre>`;
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
