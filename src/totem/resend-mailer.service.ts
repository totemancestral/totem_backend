import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TotemOrder } from '@prisma/client';

type DeliveryPayload = {
  order: TotemOrder;
  imageUrl: string;
  audioUrl: string;
  pdfUrl: string;
};

@Injectable()
export class ResendMailerService {
  private readonly apiKey: string;
  private readonly senderEmail?: string;
  private readonly senderName: string;
  private readonly alertEmail?: string;

  constructor(config: ConfigService) {
    this.apiKey = config.getOrThrow<string>('RESEND_API_KEY');
    this.senderEmail = config.get<string>('RESEND_SENDER_EMAIL');
    this.senderName = config.getOrThrow<string>('RESEND_SENDER_NAME');
    this.alertEmail = config.get<string>('ALERT_EMAIL');
  }

  async sendDelivery(payload: DeliveryPayload): Promise<boolean> {
    const email = payload.order.customerEmail;

    if (!email) {
      return false;
    }

    if (!this.senderEmail) {
      return false;
    }

    await this.send({
      to: [email],
      subject: 'Votre coffret TOTEM ANCESTRAL est pret',
      html: renderDeliveryEmail(payload),
    });

    return true;
  }

  async sendFailureAlert(orderId: string, error: string): Promise<void> {
    if (!this.alertEmail) return;

    await this.send({
      to: [this.alertEmail],
      subject: `Erreur pipeline TOTEM ${orderId}`,
      html: renderFailureEmail(orderId, error),
    });
  }

  private async send(payload: {
    to: string[];
    subject: string;
    html: string;
  }): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${this.senderName} <${this.senderEmail}>`,
        ...payload,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`resend_failed:${response.status}:${detail.slice(0, 300)}`);
    }
  }
}

function renderDeliveryEmail(payload: DeliveryPayload): string {
  const name = payload.order.ancestralName ?? 'Votre totem';

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #171717;">
      <h1>TOTEM ANCESTRAL</h1>
      <p>Votre coffret digital est pret.</p>
      <p><strong>${escapeHtml(name)}</strong></p>
      <ul>
        <li><a href="${escapeAttribute(payload.imageUrl)}">Image</a></li>
        <li><a href="${escapeAttribute(payload.audioUrl)}">Audio</a></li>
        <li><a href="${escapeAttribute(payload.pdfUrl)}">PDF</a></li>
      </ul>
      <p>Ces liens sont signes et restent valides pendant 30 jours.</p>
    </div>
  `;
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
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('`', '&#96;');
}
