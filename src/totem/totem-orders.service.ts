import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma, TotemOrderStatus } from "@prisma/client";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { SupabaseMirrorService } from "./supabase-mirror.service";
import { TotemQueueService } from "./totem-queue.service";
import { hasEnoughAnswersForGeneration } from "./stripe-webhook.service";

const completeOrderSchema = z.object({
  externalCommandId: z.string().uuid(),
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1).max(80),
        answer: z.string().min(1).max(4000),
      }),
    )
    .length(11),
  locale: z.string().min(2).max(12).optional(),
});

@Injectable()
export class TotemOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mirror: SupabaseMirrorService,
    private readonly queue: TotemQueueService,
  ) {}

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
