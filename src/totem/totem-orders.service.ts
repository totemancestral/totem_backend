import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, TotemOrderStatus } from "@prisma/client";
import Stripe from "stripe";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { SupabaseMirrorService } from "./supabase-mirror.service";
import { TotemQueueService } from "./totem-queue.service";
import { isCompleteAdultAnswers } from "./adult-answers";
import { StripeWebhookService } from "./stripe-webhook.service";
import { claimTotem } from "./totem-uniqueness";

const completeOrderSchema = z.object({
  externalCommandId: z.string().uuid(),
  answers: z.array(
    z.object({
      questionId: z.string().min(1).max(80),
      answer: z.string().min(1).max(4000),
    }),
  ),
  locale: z.string().min(2).max(12).optional(),
  questionnaireVersion: z.string().min(1).max(32).optional(),
  indicators: z.record(z.string(), z.boolean()).optional(),
});

const retryOrderSchema = z.object({
  externalCommandId: z.string().uuid(),
});

@Injectable()
export class TotemOrdersService {
  private stripe?: Stripe;
  private readonly stripeSecretKey?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mirror: SupabaseMirrorService,
    private readonly queue: TotemQueueService,
    private readonly webhook: StripeWebhookService,
    config: ConfigService,
  ) {
    this.stripeSecretKey = config.get<string>("STRIPE_SECRET_KEY");
  }

  async getByCheckoutSession(input: { checkoutSessionId: string; userId: string }) {
    let order = await this.prisma.totemOrder.findUnique({
      where: { checkoutSessionId: input.checkoutSessionId },
    });
    if (!order) throw new NotFoundException("order_not_found");
    if (order.userId !== input.userId) throw new BadRequestException("order_user_mismatch");

    // Live reconciliation with Stripe: if webhook was missed or delayed, synchronize on read
    if (this.stripeSecretKey && order.checkoutSessionId && (!order.paymentIntentId || order.status === TotemOrderStatus.pending)) {
      try {
        this.stripe ??= new Stripe(this.stripeSecretKey);
        const session = await this.stripe.checkout.sessions.retrieve(order.checkoutSessionId);
        if (session.payment_status === "paid") {
          await this.webhook.handleCheckoutSession(session);
          order = (await this.prisma.totemOrder.findUnique({ where: { id: order.id } })) ?? order;
        }
      } catch (err) {
        console.warn("[TotemOrdersService] Live Stripe session sync failed:", err);
      }
    }

    const paid = await this.isPaid(order);
    if (!paid) {
      throw new HttpException({ code: "payment_not_confirmed" }, HttpStatus.PAYMENT_REQUIRED);
    }

    if (order.offer === "junior" && order.status !== TotemOrderStatus.done) {
      await this.webhook.computeJuniorRevealIfNeeded(order.id).catch((err) =>
        console.warn("[TotemOrdersService] computeJuniorRevealIfNeeded warning:", err),
      );
      order = (await this.prisma.totemOrder.findUnique({ where: { id: order.id } })) ?? order;
    }

    return {
      id: order.id,
      offer: order.offer,
      paid: true,
      requiresQuestionnaire: order.offer !== "junior" && !isCompleteAdultAnswers(order.answers),
      status: order.status,
      errorMessage: order.status === TotemOrderStatus.error ? "generation_failed" : null,
      juniorPayload: order.offer === "junior" ? order.juniorPayload : null,
      imageUrl: order.offer === "junior" ? order.imageUrl : null,
    };
  }

  async retry(body: unknown): Promise<{ orderId: string; queued: boolean; outcome?: "already_done" | "already_running" }> {
    const payload = retryOrderSchema.parse(body);

    const command = await this.mirror.readCommandByExternalId(payload.externalCommandId);
    if (!command) {
      throw new NotFoundException("commande_not_found");
    }

    if (!command.checkoutSessionId) {
      throw new BadRequestException("stripe_session_missing");
    }

    const order = await this.prisma.totemOrder.findUnique({
      where: { checkoutSessionId: command.checkoutSessionId },
    });

    if (!order) {
      throw new NotFoundException("order_not_found");
    }

    if (order.status === TotemOrderStatus.done) {
      return { orderId: order.id, queued: false, outcome: "already_done" };
    }
    if (order.status === TotemOrderStatus.processing) {
      return { orderId: order.id, queued: true, outcome: "already_running" };
    }
    if (order.offer === "junior" || !isCompleteAdultAnswers(order.answers) || !await this.isPaid(order)) {
      throw new BadRequestException("paid_complete_adult_order_required");
    }

    const reserved = await this.prisma.totemOrder.updateMany({
      where: { id: order.id, status: order.status, queuedAt: order.queuedAt },
      data: {
        status: TotemOrderStatus.pending,
        errorMessage: null,
        ...(order.status === TotemOrderStatus.error ? { attempts: 0 } : {}),
        queuedAt: new Date(),
      },
    });
    if (!reserved.count) return { orderId: order.id, queued: true, outcome: "already_running" };

    await this.prisma.totemPipelineError.updateMany({
      where: { orderId: order.id, resolved: false },
      data: { resolved: true, resolvedAt: new Date() },
    });

    await this.mirror.markRetrying(command.id).catch(() => undefined);

    await this.queue.enqueue(order.id);

    return { orderId: order.id, queued: true };
  }

  async completeAfterPayment(input: { body: unknown; userId: string }) {
    const payload = this.readInput(input.body);
    const command = await this.mirror.readPaidCommand({
      externalCommandId: payload.externalCommandId,
      userId: input.userId,
    });

    if (!isCompleteAdultAnswers(payload.answers)) {
      throw new BadRequestException("adult_answers_incomplete");
    }

    const order = await this.prisma.totemOrder.findUnique({
      where: { checkoutSessionId: command.checkoutSessionId },
    });
    if (!order) throw new BadRequestException("order_not_found");
    if (order.userId !== input.userId) throw new BadRequestException("order_user_mismatch");

    if (order.offer === "junior") throw new BadRequestException("adult_order_required");
    // Une répétition de la soumission ne doit ni modifier une œuvre en cours,
    // ni remplacer les réponses d'une commande déjà mise en file.
    if (order.queuedAt || order.status !== TotemOrderStatus.pending) {
      return { orderId: order.id, queued: Boolean(order.queuedAt) };
    }

    if (this.stripeSecretKey && order.checkoutSessionId && !order.paymentIntentId) {
      try {
        this.stripe ??= new Stripe(this.stripeSecretKey);
        const session = await this.stripe.checkout.sessions.retrieve(order.checkoutSessionId);
        if (session.payment_status === "paid") {
          await this.webhook.handleCheckoutSession(session);
        }
      } catch (err) {
        console.warn("[OrdersService] Stripe session reconciliation warning:", err);
      }
    }

    await claimTotem(this.prisma, input.userId, order.id);
    // Réserver les réponses et l'intention durable de génération dans une seule écriture.
    const reserved = await this.prisma.totemOrder.updateMany({
      where: { id: order.id, userId: input.userId, status: TotemOrderStatus.pending, queuedAt: null },
      data: {
        answers: {
          answers: payload.answers,
          questionnaireVersion: payload.questionnaireVersion ?? "griot-v2",
          indicators: payload.indicators ?? {},
        } as unknown as Prisma.InputJsonValue,
        locale: payload.locale ?? order.locale,
        errorMessage: null,
        queuedAt: new Date(),
      },
    });

    if (reserved.count === 0) {
      const current = await this.prisma.totemOrder.findUniqueOrThrow({ where: { id: order.id } });
      return { orderId: order.id, queued: Boolean(current.queuedAt) };
    }

    await this.queue.enqueue(order.id);

    return { orderId: order.id, queued: true };
  }

  private async isPaid(order: {
    paymentIntentId: string | null;
    queuedAt: Date | null;
    status: TotemOrderStatus;
    checkoutSessionId: string | null;
  }): Promise<boolean> {
    // L'existence d'un PaymentIntent ne signifie pas qu'il a été payé.
    if (order.queuedAt) return true;
    if (order.status === TotemOrderStatus.processing || order.status === TotemOrderStatus.done) {
      return true;
    }
    if (!order.checkoutSessionId) return false;
    if (!this.stripeSecretKey) throw new ServiceUnavailableException("payment_verification_unavailable");

    try {
      this.stripe ??= new Stripe(this.stripeSecretKey);
      const session = await this.stripe.checkout.sessions.retrieve(order.checkoutSessionId);
      return session.payment_status === "paid";
    } catch {
      // Une panne de Stripe ne doit pas être interprétée comme un impayé,
      // sous peine de proposer à nouveau le paiement d'une commande réglée.
      throw new ServiceUnavailableException("payment_verification_unavailable");
    }
  }

  private readInput(body: unknown) {
    try {
      return completeOrderSchema.parse(body);
    } catch (error) {
      throw new BadRequestException({
        code: "complete_order_payload_invalid",
        detail: error instanceof Error ? error.message : "invalid_payload",
      });
    }
  }
}
