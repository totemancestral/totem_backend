import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TOTEM_QUEUE } from './totem.constants';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';
import { TotemQueueService } from './totem-queue.service';
import { TotemWorker } from './totem.worker';
import { TotemMicroservicesClient } from './totem-microservices.client';
import { R2StorageService } from './r2-storage.service';
import { BrevoMailerService } from './brevo-mailer.service';
import { TotemAssetsController } from './totem-assets.controller';
import { HealthController } from '../health.controller';

@Module({
  imports: [
    BullModule.registerQueue({
      name: TOTEM_QUEUE,
      streams: {
        events: {
          maxLen: 10_000,
        },
      },
    }),
  ],
  controllers: [StripeWebhookController, TotemAssetsController, HealthController],
  providers: [
    StripeWebhookService,
    TotemQueueService,
    TotemWorker,
    TotemMicroservicesClient,
    R2StorageService,
    BrevoMailerService,
  ],
})
export class TotemModule {}
