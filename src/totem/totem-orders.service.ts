import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, TotemOrderStatus } from "@prisma/client";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { SupabaseMirrorService } from "./supabase-mirror.service";
import { TotemQueueService } from "./totem-queue.service";
import { hasEnoughAnswersForGeneration } from "./stripe-webhook.service";

const completeOrderSchema = z.object({
  externalCommandId: z.string().uuid(),
  // Les dix questions du parcours, plus les entrees de contexte que le site
  // peut joindre (le sexe declare sur le profil, par exemple). Un compte exact
  // rendait la chaine cassante : toute entree supplementaire faisait echouer
  // l'appel en silence et la commande n'etait jamais mise en file.
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1).max(80),
        answer: z.string().min(1).max(4000),
      }),
    )
    .min(10)
    .max(16),
  locale: z.string().min(2).max(12).optional(),
});

const retryOrderSchema = z.object({
  externalCommandId: z.string().uuid(),
});

@Injectable()
export class TotemOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mirror: SupabaseMirrorService,
    private readonly queue: TotemQueueService,
  ) {}

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

    const order = await this.prisma.totemOrder.findUnique({
      where: { checkoutSessionId: command.checkoutSessionId },
    });
    if (!order) throw new BadRequestException("order_not_found");
    if (order.userId !== input.userId) throw new BadRequestException("order_user_mismatch");

    const updated = await this.prisma.totemOrder.update({
      where: { id: order.id },
      data: {
        answers: payload.answers as unknown as Prisma.InputJsonValue,
        locale: payload.locale ?? order.locale,
        errorMessage: null,
      },
    });

    if (updated.status !== TotemOrderStatus.pending || updated.queuedAt) {
      return { orderId: updated.id, queued: Boolean(updated.queuedAt) };
    }

    if (!hasEnoughAnswersForGeneration(updated.answers)) {
      throw new BadRequestException("answers_incomplete");
    }

    await this.queue.enqueue(updated.id);
    await this.prisma.totemOrder.update({
      where: { id: updated.id },
      data: { queuedAt: new Date() },
    });

    return { orderId: updated.id, queued: true };
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
