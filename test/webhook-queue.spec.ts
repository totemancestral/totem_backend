import { describe, expect, it, vi } from "vitest";
import { StripeWebhookService } from "../src/totem/stripe-webhook.service";

function setup(complete = true) {
  const row = {
    id: "order", status: "pending", queuedAt: null as Date | null, offer: "origine",
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
