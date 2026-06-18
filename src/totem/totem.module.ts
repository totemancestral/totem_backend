import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { TOTEM_QUEUE } from "./totem.constants";
import { StripeWebhookController } from "./stripe-webhook.controller";
import { StripeWebhookService } from "./stripe-webhook.service";
import { CheckoutController } from "./checkout.controller";
import { CheckoutService } from "./checkout.service";
import { TotemOrdersController } from "./totem-orders.controller";
import { TotemOrdersService } from "./totem-orders.service";
import { TotemQueueService } from "./totem-queue.service";
import { TotemWorker } from "./totem.worker";
import { TotemAiService } from "./totem-ai.service";
import { SupabaseStorageService } from "./supabase-storage.service";
import { ResendMailerService } from "./resend-mailer.service";
import { SupabaseAuthService } from "./supabase-auth.service";
import { SupabaseMirrorService } from "./supabase-mirror.service";
import { TotemAssetsController } from "./totem-assets.controller";
import { HealthController } from "../health.controller";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [
    PrismaModule,
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
    TotemOrdersController,
    StripeWebhookController,
    TotemAssetsController,
    HealthController,
  ],
  providers: [
    CheckoutService,
    TotemOrdersService,
    StripeWebhookService,
    TotemQueueService,
    TotemWorker,
    TotemAiService,
    SupabaseStorageService,
    ResendMailerService,
    SupabaseAuthService,
    SupabaseMirrorService,
  ],
})
export class TotemModule {}
