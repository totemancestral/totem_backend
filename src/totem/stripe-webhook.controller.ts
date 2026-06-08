import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  RawBodyRequest,
} from '@nestjs/common';
import { Request } from 'express';
import { StripeWebhookService } from './stripe-webhook.service';

@Controller('webhooks/stripe')
export class StripeWebhookController {
  constructor(private readonly stripeWebhook: StripeWebhookService) {}

  @Post()
  @HttpCode(202)
  async handle(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ): Promise<{ received: true }> {
    if (!signature || !request.rawBody) {
      throw new BadRequestException('stripe_signature_missing');
    }

    await this.stripeWebhook.handle(request.rawBody, signature);

    return { received: true };
  }
}
