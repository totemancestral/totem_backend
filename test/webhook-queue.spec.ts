import { describe, expect, it, vi } from "vitest";
import { StripeWebhookService } from "../src/totem/stripe-webhook.service";

function setup(complete = true) {
  const row = {
    id: "order", status: "pending", queuedAt: null as Date | null, offer: "origine", paymentIntentId: "pi_paid" as string | null,
    pdfKey: null as string | null, certificateKey: null as string | null, parentConsentId: "parent", deliveryEmailSentAt: null as Date | null,
    answers: { answers: Array.from({ length: complete ? 10 : 4 }, (_, i) => ({ questionId: `q${i + 1}`, answer: "A" })) },
  };
  const prisma = { totemOrder: {
    findUniqueOrThrow: vi.fn(async () => ({ ...row })),
    updateMany: vi.fn(async ({ data }) => {
      if (row.queuedAt || row.status !== "pending") return { count: 0 };
      Object.assign(row, data); return { count: 1 };
    }),
  } };
  const queue = { enqueue: vi.fn(async () => {}) };
  const service = new StripeWebhookService({ get: () => undefined } as never, prisma as never,
    queue as never, {} as never, {} as never, {} as never, {} as never);
  const enqueue = (service as unknown as { enqueueIfPending(id: string): Promise<void> }).enqueueIfPending.bind(service);
  return { row, queue, prisma, enqueue };
}
describe("webhook generation reservation", () => {
  it("publishes once when two paid events arrive concurrently", async () => {
    const s = setup();
    await Promise.all([s.enqueue("order"), s.enqueue("order")]);
    expect(s.queue.enqueue).toHaveBeenCalledOnce();
    expect(s.row.queuedAt).toBeInstanceOf(Date);
  });
  it("does not reserve generation after only four questions", async () => {
    const s = setup(false);
    await s.enqueue("order");
    expect(s.queue.enqueue).not.toHaveBeenCalled();
    expect(s.row.queuedAt).toBeNull();
  });
  it("keeps the durable reservation when Redis is unavailable", async () => {
    const s = setup();
    s.queue.enqueue.mockRejectedValueOnce(new Error("redis_down"));
    await expect(s.enqueue("order")).rejects.toThrow("redis_down");
    expect(s.row.queuedAt).toBeInstanceOf(Date);
  });
});

describe("Junior webhook background reservation", () => {
  it("reserves only once for concurrent payment notifications", async () => {
    const s = setup(); s.row.offer = "junior";
    await Promise.all([s.enqueue("order"), s.enqueue("order")]);
    expect(s.queue.enqueue).toHaveBeenCalledOnce();
    expect(s.row.queuedAt).toBeInstanceOf(Date);
  });
  it("retains the Junior reservation when Redis fails", async () => {
    const s = setup(); s.row.offer = "junior";
    s.queue.enqueue.mockRejectedValueOnce(Error("redis_down"));
    await expect(s.enqueue("order")).rejects.toThrow("redis_down");
    expect(s.row.queuedAt).toBeInstanceOf(Date);
  });
  it("never queues an unpaid Junior", async () => {
    const s = setup(); s.row.offer = "junior"; s.row.paymentIntentId = null;
    await s.enqueue("order"); expect(s.queue.enqueue).not.toHaveBeenCalled();
  });
  it("does not requeue a completed delivered Junior", async () => {
    const s = setup(); Object.assign(s.row, { offer: "junior", status: "done", pdfKey: "pdf", certificateKey: "cert", deliveryEmailSentAt: new Date() });
    await s.enqueue("order"); expect(s.queue.enqueue).not.toHaveBeenCalled();
  });
  it("returns from a paid checkout without awaiting generation or delivery", async () => {
    const s = setup(); s.row.offer = "junior";
    const service = new StripeWebhookService({ get: () => undefined } as never, s.prisma as never,
      s.queue as never, { markPaid: vi.fn(async () => {}) } as never, {} as never, {} as never, {} as never);
    const internal = service as unknown as { activatePrecreatedOrder(input: unknown): Promise<unknown> };
    vi.spyOn(internal, "activatePrecreatedOrder").mockResolvedValue(s.row);
    const generate = vi.spyOn(service, "computeJuniorRevealIfNeeded").mockImplementation(() => new Promise(() => {}));
    await service.handleCheckoutSession({ id: "cs_paid", object: "checkout.session", payment_status: "paid",
      payment_intent: "pi_paid", metadata: { orderId: "order" }, amount_total: 999, currency: "eur" });
    expect(generate).not.toHaveBeenCalled(); expect(s.queue.enqueue).toHaveBeenCalledOnce();
  }, 1000);
});
