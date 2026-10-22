import { beforeEach, describe, expect, it, vi } from "vitest";
import { TotemOrderStatus } from "@prisma/client";
import { TotemOrdersService } from "../src/totem/totem-orders.service";


const { retrieve } = vi.hoisted(() => ({ retrieve: vi.fn() }));
vi.mock("stripe", () => ({ default: class { checkout = { sessions: { retrieve } }; } }));

const completeAnswers = Array.from({ length: 10 }, (_, i) => ({ questionId: `q${i + 1}`, answer: "A" }));
const baseOrder = {
  id: "order-1", userId: "user-1", offer: "ancestral", checkoutSessionId: "cs_test_1",
  paymentIntentId: "pi_created_but_not_paid", status: TotemOrderStatus.pending,
  queuedAt: null, locale: "fr", answers: { answers: completeAnswers.slice(0, 4) },
};

function setup(order: Omit<typeof baseOrder, "queuedAt"> & { queuedAt: Date | null } = baseOrder) {
  const prisma = { totemOrder: {
    findUnique: vi.fn().mockResolvedValue(order),
    update: vi.fn().mockImplementation(async ({ data }) => ({ ...order, ...data })),
  } };
  const mirror = { readPaidCommand: vi.fn().mockResolvedValue({ id: "command-1", checkoutSessionId: "cs_test_1" }) };
  const queue = { enqueue: vi.fn().mockResolvedValue(undefined) };
  const webhook = { handleCheckoutSession: vi.fn().mockResolvedValue(undefined) };
  const config = { get: () => "sk_test_mock" };
  const service = new TotemOrdersService(
    prisma as never, mirror as never, queue as never, webhook as never, config as never,
  );
  return { service, prisma, mirror, queue, webhook };
}

beforeEach(() => { vi.clearAllMocks(); retrieve.mockResolvedValue({ payment_status: "paid" }); });

describe("adult payment boundary", () => {
  it("does not unlock question 5 merely because a PaymentIntent exists", async () => {
    retrieve.mockResolvedValue({ payment_status: "unpaid" });
    const { service, queue } = setup();
    await expect(service.getByCheckoutSession({ checkoutSessionId: "cs_test_1", userId: "user-1" }))
      .rejects.toMatchObject({ status: 402 });
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("returns the continuation signal after verified payment with four answers", async () => {
    const { service, queue } = setup();
    const result = await service.getByCheckoutSession({ checkoutSessionId: "cs_test_1", userId: "user-1" });
    expect(result).toMatchObject({ paid: true, requiresQuestionnaire: true });
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("does not treat an unavailable payment provider as an unpaid order", async () => {
    retrieve.mockRejectedValue(new Error("Stripe temporarily unavailable"));
    const { service } = setup();
    await expect(service.getByCheckoutSession({ checkoutSessionId: "cs_test_1", userId: "user-1" }))
      .rejects.toMatchObject({ status: 503 });
  });

  it("rejects access to another user's paid session", async () => {
    const { service } = setup();
    await expect(service.getByCheckoutSession({ checkoutSessionId: "cs_test_1", userId: "other-user" }))
      .rejects.toThrow("order_user_mismatch");
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("does not generate a paid but unfinished questionnaire", async () => {
    const { service, queue } = setup();
    await expect(service.completeAfterPayment({ userId: "user-1", body: {
      externalCommandId: "00000000-0000-4000-8000-000000000001", answers: completeAnswers.slice(0, 4),
    } })).rejects.toThrow("adult_answers_incomplete");
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("queues the complete paid questionnaire", async () => {
    const { service, queue } = setup();
    await expect(service.completeAfterPayment({ userId: "user-1", body: {
      externalCommandId: "00000000-0000-4000-8000-000000000001", answers: completeAnswers,
    } })).resolves.toMatchObject({ queued: true });
    expect(queue.enqueue).toHaveBeenCalledOnce();
  });

  it("keeps queued answers immutable when completion is retried", async () => {
    const { service, queue, prisma } = setup({ ...baseOrder, queuedAt: new Date() });
    await service.completeAfterPayment({ userId: "user-1", body: {
      externalCommandId: "00000000-0000-4000-8000-000000000001", answers: completeAnswers,
    } });
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(prisma.totemOrder.update).not.toHaveBeenCalled();
  });
});
