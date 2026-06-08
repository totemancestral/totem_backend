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
export class BrevoMailerService {
  private readonly apiKey: string;
  private readonly senderEmail: string;
  private readonly senderName: string;
  private readonly deliveryTemplateId: number;
  private readonly alertTemplateId: number;
  private readonly alertEmail: string;

  constructor(config: ConfigService) {
    this.apiKey = config.getOrThrow<string>('BREVO_API_KEY');
    this.senderEmail = config.getOrThrow<string>('BREVO_SENDER_EMAIL');
    this.senderName = config.getOrThrow<string>('BREVO_SENDER_NAME');
    this.deliveryTemplateId = config.getOrThrow<number>('BREVO_TEMPLATE_DELIVERY_ID');
    this.alertTemplateId = config.getOrThrow<number>('BREVO_TEMPLATE_ALERT_ID');
    this.alertEmail = config.getOrThrow<string>('ALERT_EMAIL');
  }

  async sendDelivery(payload: DeliveryPayload): Promise<void> {
    const email = payload.order.customerEmail;

    if (!email) {
      throw new Error('customer_email_missing');
    }

    await this.send({
      templateId: this.deliveryTemplateId,
      to: [{ email }],
      params: {
        orderId: payload.order.id,
        ancestralName: payload.order.ancestralName,
        archetypeId: payload.order.archetypeId,
        imageUrl: payload.imageUrl,
        audioUrl: payload.audioUrl,
        pdfUrl: payload.pdfUrl,
      },
    });
  }

  async sendFailureAlert(orderId: string, error: string): Promise<void> {
    await this.send({
      templateId: this.alertTemplateId,
      to: [{ email: this.alertEmail }],
      params: {
        orderId,
        error,
      },
    });
  }

  private async send(payload: {
    templateId: number;
    to: Array<{ email: string }>;
    params: Record<string, unknown>;
  }): Promise<void> {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: {
          email: this.senderEmail,
          name: this.senderName,
        },
        ...payload,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`brevo_failed:${response.status}:${detail.slice(0, 300)}`);
    }
  }
}
