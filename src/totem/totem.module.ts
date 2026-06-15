import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { TOTEM_QUEUE } from "./totem.constants";
import { StripeWebhookController } from "./stripe-webhook.controller";
import { StripeWebhookService } from "./stripe-webhook.service";
import { CheckoutController } from "./checkout.controller";
import { CheckoutService } from "./checkout.service";
import { TotemQueueService } from "./totem-queue.service";
import { TotemWorker } from "./totem.worker";
import { TotemMicroservicesClient } from "./totem-microservices.client";
import { SupabaseStorageService } from "./supabase-storage.service";
import { ResendMailerService } from "./resend-mailer.service";
import { SupabaseAuthService } from "./supabase-auth.service";
import { SupabaseMirrorService } from "./supabase-mirror.service";
import { TotemAssetsController } from "./totem-assets.controller";
import { HealthController } from "../health.controller";

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
  controllers: [
    CheckoutController,
    StripeWebhookController,
    TotemAssetsController,
    HealthController,
  ],
  providers: [
    CheckoutService,
    StripeWebhookService,
    TotemQueueService,
    TotemWorker,
    TotemMicroservicesClient,
    SupabaseStorageService,
    ResendMailerService,
    SupabaseAuthService,
    SupabaseMirrorService,
  ],
})
export class TotemModule {}
