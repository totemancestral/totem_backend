import { afterEach, describe, expect, it, vi } from "vitest";
import { TotemOrder, TotemOrderStatus } from "@prisma/client";
import { TotemWorker } from "../src/totem/totem.worker";
import { TOTEM_QUEUE_STALE_MS, TotemJob } from "../src/totem/totem-queue.service";

const job = { orderId: "order", token: "owner-token" };
const answers = Array.from({ length: 10 }, (_, i) => ({ questionId: `q${i + 1}`, answer: "A" }));
function setup(patch: Partial<TotemOrder> = {}) {
  const row = {
    id: "order", userId: "user", offer: "origine", status: TotemOrderStatus.pending,
    attempts: 0, queuedAt: new Date(), processingAt: null, answers: { answers }, ...patch,
  } as TotemOrder;
  const prisma = {
    totemOrder: {
      findUniqueOrThrow: vi.fn(async () => ({ ...row })),
      findUnique: vi.fn(async () => ({ ...row })),
      findMany: vi.fn(async () => [{ id: row.id }]),
      update: vi.fn(async ({ data }) => { Object.assign(row, data); return { ...row }; }),
      updateMany: vi.fn(async ({ where, data }) => {
        if (where.OR) {
          const stale = row.status === "processing" && row.processingAt
            && row.processingAt.getTime() <= Date.now() - TOTEM_QUEUE_STALE_MS;
          if (row.status !== "pending" && !stale) return { count: 0 };
        } else if (row.status !== where.status || row.processingAt?.getTime() !== where.processingAt?.getTime()) {
          return { count: 0 };
        }
        const { attempts, ...rest } = data;
        if (attempts && typeof attempts === "object") row.attempts += attempts.increment;
        else if (attempts !== undefined) row.attempts = attempts;
        Object.assign(row, rest);
        return { count: 1 };
      }),
    },
    totemPipelineError: { create: vi.fn(async () => ({})) },
  };
  const queue = {
    heartbeat: vi.fn(async () => true), ack: vi.fn(async () => {}), retry: vi.fn(async () => {}),
    enqueue: vi.fn(async () => {}), reclaimStale: vi.fn(async () => 0), dequeue: vi.fn(async () => null),
  };
  const generation = {
    generateText: vi.fn(async () => { throw new Error("provider_down"); }),
    generateImage: vi.fn(async () => ({})), generatePdf: vi.fn(async () => ({})),
    generateCertificate: vi.fn(async () => ({})),
    generateAudio: vi.fn(async () => ({})), buildAudioNarration: vi.fn(() => "Narration"),
  };
  const storage = { store: vi.fn(async (_id: string, kind: string) => ({ key: kind, url: `https://example.invalid/${kind}` })) };
  const mirror = { markProcessing: vi.fn(async () => {}), markFailed: vi.fn(async () => {}), markDelivered: vi.fn(async () => {}) };
  const mailer = { sendFailureAlert: vi.fn(async () => {}), sendDelivery: vi.fn(async () => true) };
  const worker = new TotemWorker(prisma as never, queue as never, generation as never, storage as never,
    mirror as never, mailer as never, { get: () => undefined } as never);
  const internal = worker as unknown as {
    process(job: TotemJob): Promise<void>; recoverPending(): Promise<void>;
    persistClaim(id: string, date: Date, data: object): Promise<void>;
    running: boolean; poll(): Promise<void>;
  };
  return { row, prisma, queue, generation, mirror, mailer, worker, internal };
}
afterEach(() => { vi.useRealTimers(); });

describe("worker recovery and ownership", () => {
  it("passes the order language through to narration, parchment and certificate", async () => {
    const s = setup({ offer: "ancestral", locale: "en" });
    s.generation.generateText.mockResolvedValueOnce({ archetypeId: "lion", ancestralName: "Name" } as never);
    await s.internal.process(job);
    expect(s.row.status).toBe("done");
    expect(s.generation.generateAudio).toHaveBeenCalledWith(expect.objectContaining({ locale: "en" }));
    expect(s.generation.generatePdf).toHaveBeenCalledWith(expect.objectContaining({ locale: "en" }));
    expect(s.generation.generateCertificate).toHaveBeenCalledWith(expect.objectContaining({ locale: "en" }));
  });
  it("acknowledges a successful generation only after publication", async () => {
    const s = setup();
    s.generation.generateText.mockResolvedValueOnce({ archetypeId: "lion", ancestralName: "Name" } as never);
    await s.internal.process(job);
    expect(s.row.status).toBe("done");
    expect(s.row.attempts).toBe(1);
    expect(s.mirror.markDelivered).toHaveBeenCalledOnce();
    expect(s.queue.ack).toHaveBeenCalledWith(job);
    expect(s.queue.retry).not.toHaveBeenCalled();
    expect(s.mirror.markDelivered.mock.invocationCallOrder[0]).toBeLessThan(s.queue.ack.mock.invocationCallOrder[0]!);
  });
  it("retries publication of a completed work without generating it again", async () => {
    const s = setup();
    s.generation.generateText.mockResolvedValueOnce({ archetypeId: "lion", ancestralName: "Name" } as never);
    s.mirror.markDelivered.mockRejectedValueOnce(new Error("mirror_down"));
    await s.internal.process(job);
    expect(s.row.status).toBe("done");
    expect(s.queue.retry).toHaveBeenCalledOnce();
    await s.internal.process(job);
    expect(s.generation.generateText).toHaveBeenCalledOnce();
    expect(s.mirror.markDelivered).toHaveBeenCalledTimes(2);
    expect(s.queue.ack).toHaveBeenCalledOnce();
  });
  it("makes three generation attempts, counting each only once", async () => {
    const s = setup();
    for (let i = 0; i < 3; i++) await s.internal.process(job);
    expect(s.row.attempts).toBe(3);
    expect(s.row.status).toBe("error");
    expect(s.generation.generateText).toHaveBeenCalledTimes(3);
    expect(s.queue.retry).toHaveBeenCalledTimes(2);
    expect(s.queue.ack).toHaveBeenCalledTimes(1);
    expect(s.mailer.sendFailureAlert).toHaveBeenCalledOnce();
  });
  it("does not acknowledge when failure persistence fails", async () => {
    const s = setup();
    s.prisma.totemPipelineError.create.mockRejectedValueOnce(new Error("database_down"));
    await expect(s.internal.process(job)).rejects.toThrow("database_down");
    expect(s.queue.ack).not.toHaveBeenCalled();
    expect(s.queue.retry).not.toHaveBeenCalled();
    expect(s.row.queuedAt).not.toBeNull();
  });
  it("does not acknowledge when retry publication fails", async () => {
    const s = setup();
    s.queue.retry.mockRejectedValueOnce(new Error("redis_down"));
    await expect(s.internal.process(job)).rejects.toThrow("redis_down");
    expect(s.queue.ack).not.toHaveBeenCalled();
    expect(s.row.status).toBe("pending");
  });
  it("does not acknowledge a database read failure", async () => {
    const s = setup();
    s.prisma.totemOrder.findUniqueOrThrow.mockRejectedValueOnce(new Error("database_down"));
    await expect(s.internal.process(job)).rejects.toThrow("database_down");
    expect(s.queue.ack).not.toHaveBeenCalled();
  });
  it("refuses a lost Redis lease before generation", async () => {
    const s = setup();
    s.queue.heartbeat.mockResolvedValue(false);
    await expect(s.internal.process(job)).rejects.toThrow("worker_lease_lost");
    expect(s.generation.generateText).not.toHaveBeenCalled();
    expect(s.queue.ack).not.toHaveBeenCalled();
  });
  it("never restarts a recently claimed order", async () => {
    const s = setup({ status: "processing", processingAt: new Date(), attempts: 1 });
    await s.internal.process(job);
    expect(s.generation.generateText).not.toHaveBeenCalled();
    expect(s.queue.retry).toHaveBeenCalledWith(job);
    expect(s.row.attempts).toBe(1);
  });
  it("recovers a stale processing order", async () => {
    const s = setup({ status: "processing", processingAt: new Date(Date.now() - TOTEM_QUEUE_STALE_MS - 1000), attempts: 1 });
    await s.internal.process(job);
    expect(s.generation.generateText).toHaveBeenCalledOnce();
    expect(s.row.attempts).toBe(2);
  });
  it("does not generate a fourth time after repeated crashes", async () => {
    const s = setup({ status: "processing", processingAt: new Date(0), attempts: 3 });
    await s.internal.process(job);
    expect(s.generation.generateText).not.toHaveBeenCalled();
    expect(s.row.status).toBe("error");
    expect(s.row.attempts).toBe(3);
  });
  it("does not publish or acknowledge if the lease is lost during generation", async () => {
    const s = setup();
    s.generation.generateText.mockImplementationOnce(async () => {
      s.queue.heartbeat.mockResolvedValue(false);
      return { archetypeId: "lion" } as never;
    });
    await expect(s.internal.process(job)).rejects.toThrow("worker_lease_lost");
    expect(s.row.textPayload).toBeUndefined();
    expect(s.queue.ack).not.toHaveBeenCalled();
    expect(s.queue.retry).not.toHaveBeenCalled();
  });
  it("rejects a database write by an obsolete processing owner", async () => {
    const s = setup({ status: "processing", processingAt: new Date(1000) });
    await expect(s.internal.persistClaim("order", new Date(0), { status: "done" })).rejects.toThrow("worker_lease_lost");
    expect(s.row.status).toBe("processing");
  });
  it.each([{ offer: "junior" as const }, { status: "error" as const }, { queuedAt: null }])("ignores an ineligible queue entry: %j", async (patch) => {
    const s = setup(patch);
    await s.internal.process(job);
    expect(s.generation.generateText).not.toHaveBeenCalled();
    expect(s.queue.ack).toHaveBeenCalledWith(job);
  });
  it("recovers durable pending requests without touching unpaid drafts", async () => {
    const s = setup();
    await s.internal.recoverPending();
    expect(s.prisma.totemOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "pending", queuedAt: { not: null }, offer: { not: "junior" } },
    }));
    expect(s.queue.enqueue).toHaveBeenCalledWith("order");
  });
  it("renews ownership while generation is running", async () => {
    vi.useFakeTimers();
    const s = setup();
    let finish!: () => void;
    s.generation.generateText.mockImplementationOnce(() => new Promise((_, reject) => { finish = () => reject(new Error("provider_down")); }));
    const processing = s.internal.process(job);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(s.queue.heartbeat.mock.calls.length).toBeGreaterThanOrEqual(2);
    finish();
    await processing;
    expect(vi.getTimerCount()).toBe(0);
  });
});
