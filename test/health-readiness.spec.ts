import { afterEach, describe, expect, it, vi } from "vitest";
import { HealthController } from "../src/health.controller";
import { TotemQueueService } from "../src/totem/totem-queue.service";
import { TotemWorker } from "../src/totem/totem.worker";

function setup() {
  const query = vi.fn().mockResolvedValue([]);
  const prisma = { $transaction: vi.fn(async (run: (tx: object) => Promise<void>) => run({ $queryRaw: query })) };
  const queue = { checkAvailability: vi.fn().mockResolvedValue(undefined) };
  const worker = { isAvailable: vi.fn().mockReturnValue(true) };
  return { controller: new HealthController(prisma as never, queue as never, worker as never), prisma, query, queue, worker };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("readiness", () => {
  it("checks queue, worker and all three database tables without writes", async () => {
    const s = setup();
    await expect(s.controller.ready()).resolves.toEqual({ status: "ok" });
    expect(s.query.mock.calls.map(([sql]) => sql.join(""))).toEqual([
      'SELECT 1 FROM "TotemOrder" LIMIT 1',
      'SELECT 1 FROM "TotemPipelineError" LIMIT 1',
      'SELECT 1 FROM "ConsultationReading" LIMIT 1',
    ]);
    expect(s.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 1000, timeout: 4000 });
    expect(s.queue.checkAvailability).toHaveBeenCalledOnce();
  });

  it.each(["redis", "database", "worker"])("returns generic 503 when %s is unavailable", async (dependency) => {
    const s = setup();
    if (dependency === "redis") s.queue.checkAvailability.mockRejectedValue(new Error("secret"));
    if (dependency === "database") s.query.mockRejectedValue(new Error("secret"));
    if (dependency === "worker") s.worker.isAvailable.mockReturnValue(false);
    await expect(s.controller.ready()).rejects.toMatchObject({ message: "service_unavailable", status: 503 });
    expect(s.controller.live()).toEqual({ status: "ok" });
  });

  it("keeps liveness independent of all dependencies", () => {
    const s = setup();
    expect(s.controller.live()).toEqual({ status: "ok" });
    expect(s.prisma.$transaction).not.toHaveBeenCalled();
    expect(s.queue.checkAvailability).not.toHaveBeenCalled();
  });

  it("checks Redis with a bounded read-only PING and rejects invalid responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: "PONG" })));
    vi.stubGlobal("fetch", fetcher);
    const queue = new TotemQueueService({ getOrThrow: (key: string) => key.endsWith("URL") ? "https://redis.example" : "test-token" } as never);
    await queue.checkAvailability();
    const options = fetcher.mock.calls[0]![1];
    expect(JSON.parse(options.body)).toEqual(["PING"]);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: "private detail" })));
    await expect(queue.checkAvailability()).rejects.toThrow("queue_unavailable");
    fetcher.mockRejectedValueOnce(new Error("network"));
    await expect(queue.checkAvailability()).rejects.toThrow();
  });

  it("worker availability follows its lifecycle without requiring an empty queue", () => {
    vi.useFakeTimers();
    const worker = new TotemWorker({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, { get: () => undefined } as never);
    expect(worker.isAvailable()).toBe(false);
    worker.onModuleInit();
    expect(worker.isAvailable()).toBe(true);
    worker.onModuleDestroy();
    expect(worker.isAvailable()).toBe(false);
  });
});
