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
    const title = isFr ? "Ton Totem Junior s'est réveillé !" : "Your Junior Totem has awakened!";
    const dashboardUrl = `https://totem-ancestral.com/${isFr ? "fr" : "en"}/espace`;

    const inner = `
        <p style="margin:0 0 22px">${
          isFr
            ? `Bonjour ${escapeHtml(input.firstName)}, ton voyage a révélé ton animal totem et ton nom sacré.`
            : `Hello ${escapeHtml(input.firstName)}, your journey has revealed your totem animal and ancestral name.`
        }</p>
        <div style="background:rgba(216,173,77,.08);border:1px solid rgba(216,173,77,.25);border-radius:12px;padding:20px;margin:0 0 24px">
          <p style="margin:0 0 8px;color:#f6c865;font-size:20px;font-family:Georgia,serif;text-transform:uppercase">${escapeHtml(input.totemName)}</p>
          <p style="margin:0 0 12px;color:#d8ad4d;font-size:13px;font-weight:700">${escapeHtml(input.quality)}</p>
          <p style="margin:0;color:#e2e1ee;font-size:14px;font-style:italic">&laquo; ${escapeHtml(input.phrase)} &raquo;</p>
        </div>
        <p style="margin:0 0 8px">
          <a href="${dashboardUrl}" style="display:inline-block;background:#d8ad4d;background:linear-gradient(135deg,#eacb63,#d8ad4d);color:#0c0e16;text-decoration:none;font-weight:700;padding:15px 30px;border-radius:999px;text-transform:uppercase;letter-spacing:.14em;font-size:12px">${isFr ? "Accéder à mon espace" : "Go to my space"}</a>
        </p>`;

    await this.send({
      to: [input.email],
      subject,
      html: wrapEmail(title, inner),
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
 * Palette TOTEM : nuit profonde + or ancestral. Logo embarqué en base64 (pas
 * d'URL publique stable tant que le site n'est pas déployé) : PNG 84x84,
 * quelques Ko, tiré et réduit du logo réel du site.
 */
const LOGO_DATA_URI =
  "data:image/png;base64,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";

function wrapEmail(title: string, inner: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0b12;padding:36px 16px;font-family:Arial,Helvetica,sans-serif">
  <tr><td align="center">
    <table role="presentation" width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;background:#16121b;background:linear-gradient(160deg,#1a1c27 0%,#131420 55%,#0e0f17 100%);border:1px solid rgba(216,173,77,.34);border-radius:22px;overflow:hidden;box-shadow:0 24px 60px -30px rgba(216,173,77,.4)">
      <tr><td style="height:3px;line-height:3px;font-size:0;background:linear-gradient(90deg,transparent,rgba(216,173,77,.85),transparent)">&nbsp;</td></tr>
      <tr><td style="padding:30px 36px 0">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td valign="middle"><img src="${LOGO_DATA_URI}" width="42" height="42" alt="" style="display:block;border:0;outline:none"></td>
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
        <p style="margin:0;color:#8a8677;font-size:12px">Totem Ancestral &middot; <a href="mailto:contact@totemancestral.com" style="color:#8a8677">contact@totemancestral.com</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}

function fileLink(url: string, label: string, isEn = false): string {
  const downloadUrl = url.includes("?") ? `${url}&download=1` : `${url}?download=1`;
  const prefix = isEn ? "📥 Download" : "📥 Télécharger";
  return `<a href="${escapeAttribute(downloadUrl)}" download style="display:inline-block;margin:0 10px 10px 0;background:rgba(216,173,77,0.12);color:#f6c865;text-decoration:none;font-size:13px;border:1px solid rgba(246,200,101,.4);border-radius:6px;padding:8px 14px;font-weight:600">${prefix} ${label}</a>`;
}

function renderFallbackDelivery(payload: DeliveryPayload, copy: DeliveryCopy): RenderedEmail {
  const isEn = payload.order.locale === "en";
  const name = escapeHtml(payload.order.ancestralName ?? copy.fallbackName);
  const inner = `
        <p style="margin:0 0 16px">${copy.ready}</p>
        <p style="margin:0 0 4px;color:#8a8677;font-size:13px;text-transform:uppercase;letter-spacing:.12em">${copy.nameLabel}</p>
        <p style="margin:0 0 22px;color:#f6c865;font-size:20px;font-family:Georgia,serif">${name}</p>
        <p style="margin:0 0 12px;font-weight:bold;color:#fff">${copy.linksIntro}</p>
        <p style="margin:0 0 18px">${fileLink(payload.imageUrl, copy.image, isEn)}${fileLink(payload.audioUrl, copy.audio, isEn)}${fileLink(payload.pdfUrl, copy.pdf, isEn)}</p>
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
