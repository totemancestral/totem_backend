import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, TotemOrderStatus } from "@prisma/client";
import Stripe from "stripe";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { SupabaseMirrorService } from "./supabase-mirror.service";
import { TotemQueueService } from "./totem-queue.service";
import { isCompleteAdultAnswers } from "./adult-answers";
import { hasEnoughAnswersForGeneration } from "./stripe-webhook.service";

const completeOrderSchema = z.object({
  externalCommandId: z.string().uuid(),
  // Les dix questions du parcours, plus les entrees de contexte que le site
  // peut joindre (le sexe declare sur le profil, par exemple). Un compte exact
  // rendait la chaine cassante : toute entree supplementaire faisait echouer
  // l'appel en silence et la commande n'etait jamais mise en file.
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
    config: ConfigService,
  ) {
    this.stripeSecretKey = config.get<string>("STRIPE_SECRET_KEY");
  }

  async getByCheckoutSession(input: { checkoutSessionId: string; userId: string }) {
    const order = await this.prisma.totemOrder.findUnique({
      where: { checkoutSessionId: input.checkoutSessionId },
    });
    if (!order) throw new NotFoundException("order_not_found");
    if (order.userId !== input.userId) throw new BadRequestException("order_user_mismatch");

    const paid = await this.isPaid(order);
    if (!paid) {
      throw new HttpException({ code: "payment_not_confirmed" }, HttpStatus.PAYMENT_REQUIRED);
    }

    return {
      id: order.id,
      offer: order.offer,
      paid: true,
      status: order.status,
      errorMessage: order.errorMessage ?? null,
      juniorPayload: order.offer === "junior" ? order.juniorPayload : null,
      imageUrl: order.offer === "junior" ? order.imageUrl : null,
    };
  }

  async retry(body: unknown): Promise<{ orderId: string; queued: boolean }> {
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
      return { orderId: order.id, queued: false };
    }

    await this.prisma.totemOrder.update({
      where: { id: order.id },
      data: {
        status: TotemOrderStatus.pending,
        errorMessage: null,
        attempts: 0,
      },
    });

    await this.prisma.totemPipelineError.updateMany({
      where: { orderId: order.id, resolved: false },
      data: { resolved: true, resolvedAt: new Date() },
    });

    await this.mirror.markRetrying(command.id).catch(() => undefined);

    await this.queue.enqueue(order.id, true);
    await this.prisma.totemOrder.update({
      where: { id: order.id },
      data: { queuedAt: new Date() },
    });

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

    const updated = await this.prisma.totemOrder.update({
      where: { id: order.id },
      data: {
        answers: {
          answers: payload.answers,
          questionnaireVersion: payload.questionnaireVersion ?? "griot-v2",
          indicators: payload.indicators ?? {},
        } as unknown as Prisma.InputJsonValue,
        locale: payload.locale ?? order.locale,
        errorMessage: null,
      },
    });

    if (updated.status !== TotemOrderStatus.pending || updated.queuedAt) {
      return { orderId: updated.id, queued: Boolean(updated.queuedAt) };
    }

    if (!hasEnoughAnswersForGeneration(updated.answers, order.offer)) {
      throw new BadRequestException("answers_incomplete");
    }

    await this.queue.enqueue(updated.id);
    await this.prisma.totemOrder.update({
      where: { id: updated.id },
      data: { queuedAt: new Date() },
    });

    return { orderId: updated.id, queued: true };
  }

  private async isPaid(order: {
    paymentIntentId: string | null;
    queuedAt: Date | null;
    status: TotemOrderStatus;
    checkoutSessionId: string | null;
  }): Promise<boolean> {
    if (order.paymentIntentId) return true;
    if (order.queuedAt) return true;
    if (order.status === TotemOrderStatus.processing || order.status === TotemOrderStatus.done) {
      return true;
    }
    if (!order.checkoutSessionId || !this.stripeSecretKey) return false;

    try {
      this.stripe ??= new Stripe(this.stripeSecretKey);
      const session = await this.stripe.checkout.sessions.retrieve(order.checkoutSessionId);
      return session.payment_status === "paid";
    } catch {
      return false;
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
