import { Module } from "@nestjs/common";
import { HealthController, RootController } from "../health.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { CheckoutController } from "./checkout.controller";
import { CheckoutService } from "./checkout.service";
import { ConsultationCaurisController } from "./consultation-cauris.controller";
import { ConsultationCaurisService } from "./consultation-cauris.service";
import { JuniorController } from "./junior.controller";
import { JuniorService } from "./junior.service";
import { ResendMailerService } from "./resend-mailer.service";
import { StripeWebhookController } from "./stripe-webhook.controller";
import { StripeWebhookService } from "./stripe-webhook.service";
import { SupabaseAuthService } from "./supabase-auth.service";
import { SupabaseMirrorService } from "./supabase-mirror.service";
import { SupabaseStorageService } from "./supabase-storage.service";
import { TotemAiService } from "./totem-ai.service";
import { TotemAssetsController } from "./totem-assets.controller";
import { TotemOrdersController } from "./totem-orders.controller";
import { TotemOrdersService } from "./totem-orders.service";
import { TotemQueueService } from "./totem-queue.service";
import { TotemWorker } from "./totem.worker";

@Module({
  imports: [
    PrismaModule,
  ],
  controllers: [
    RootController,
    CheckoutController,
    TotemOrdersController,
    StripeWebhookController,
    TotemAssetsController,
    JuniorController,
    ConsultationCaurisController,
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
    JuniorService,
    ConsultationCaurisService,
  ],
})
export class TotemModule {}