import { describe, expect, it, vi } from "vitest";
import { TotemOrdersService } from "../src/totem/totem-orders.service";

const body = { externalCommandId: "00000000-0000-4000-8000-000000000001" };
function setup(status: string) {
  const order = {
    id: "order", status, queuedAt: new Date(0), attempts: 3, offer: "origine",
    checkoutSessionId: "cs", answers: { answers: Array.from({ length: 10 }, (_, i) => ({ questionId: `q${i + 1}`, answer: "A" })) },
  };
  const prisma = { totemOrder: {
    findUnique: vi.fn(async () => ({ ...order })),
    updateMany: vi.fn(async ({ where, data }) => {
      if (order.status !== where.status || order.queuedAt !== where.queuedAt) return { count: 0 };
      Object.assign(order, data); return { count: 1 };
    }),
  }, totemPipelineError: { updateMany: vi.fn(async () => ({ count: 1 })) } };
  const queue = { enqueue: vi.fn(async () => {}) };
  const mirror = {
    readCommandByExternalId: vi.fn(async () => ({ id: "command", checkoutSessionId: "cs" })),
    markRetrying: vi.fn(async () => {}),
  };
  const service = new TotemOrdersService(prisma as never, mirror as never, queue as never,
    {} as never, { get: () => undefined } as never);
  return { service, order, prisma, queue };
}
describe("administrative generation retry", () => {
  it("does not reset an active generation", async () => {
    const s = setup("processing");
    await expect(s.service.retry(body)).resolves.toMatchObject({ queued: true, outcome: "already_running" });
    expect(s.prisma.totemOrder.updateMany).not.toHaveBeenCalled();
    expect(s.queue.enqueue).not.toHaveBeenCalled();
    expect(s.order.attempts).toBe(3);
  });
  it("does not regenerate a completed order", async () => {
    const s = setup("done");
    await expect(s.service.retry(body)).resolves.toMatchObject({ queued: false, outcome: "already_done" });
    expect(s.queue.enqueue).not.toHaveBeenCalled();
  });
  it("reserves a failed order only once under simultaneous retries", async () => {
    const s = setup("error");
    await Promise.all([s.service.retry(body), s.service.retry(body)]);
    expect(s.queue.enqueue).toHaveBeenCalledOnce();
    expect(s.order.status).toBe("pending");
    expect(s.order.attempts).toBe(0);
  });
});
