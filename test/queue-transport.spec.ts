import { beforeEach, describe, expect, it, vi } from "vitest";
import { QUEUE_SCRIPTS, TOTEM_QUEUE_STALE_MS, TotemQueueService } from "../src/totem/totem-queue.service";

const mocks = vi.hoisted(() => ({ eval: vi.fn(), ping: vi.fn() }));
vi.mock("@upstash/redis", () => ({ Redis: class { eval = mocks.eval; ping = mocks.ping; } }));
let queue: TotemQueueService;
beforeEach(() => {
  vi.clearAllMocks(); mocks.eval.mockResolvedValue(1); mocks.ping.mockResolvedValue("PONG");
  queue = new TotemQueueService({ getOrThrow: () => "test" } as never);
});

describe("queue transport contract", () => {
  it("does not reclaim recent work when a new server starts", async () => {
    const before = Date.now();
    await queue.onModuleInit();
    const cutoff = mocks.eval.mock.calls[0]![2][0];
    expect(cutoff).toBeGreaterThanOrEqual(before - TOTEM_QUEUE_STALE_MS);
    expect(cutoff).toBeLessThanOrEqual(Date.now() - TOTEM_QUEUE_STALE_MS);
  });
  it("gives distinct ownership tokens to different claims", async () => {
    mocks.eval.mockResolvedValue("order");
    const first = await queue.dequeue(), second = await queue.dequeue();
    expect(first?.orderId).toBe("order");
    expect(first?.token).not.toBe(second?.token);
  });
  it("treats the empty queue response as no job", async () => {
    mocks.eval.mockResolvedValue(null);
    expect(await queue.dequeue()).toBeNull();
  });
  it("reports a refused heartbeat as loss of ownership", async () => {
    mocks.eval.mockResolvedValue(0);
    expect(await queue.heartbeat({ orderId: "order", token: "old" })).toBe(false);
  });
  it("passes ownership on both acknowledgement and retry", async () => {
    const job = { orderId: "order", token: "owner" };
    await queue.ack(job); await queue.retry(job);
    expect(mocks.eval).toHaveBeenNthCalledWith(1, QUEUE_SCRIPTS.finish, expect.any(Array), ["order", "owner", "ack"]);
    expect(mocks.eval).toHaveBeenNthCalledWith(2, QUEUE_SCRIPTS.finish, expect.any(Array), ["order", "owner", "retry"]);
  });
});
