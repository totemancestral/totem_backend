import { describe, expect, it, vi } from "vitest";
import { StripeWebhookService } from "../src/totem/stripe-webhook.service";
import { TOTEM_QUEUE_STALE_MS } from "../src/totem/totem-queue.service";

function setup() {
  const row = {
    id: "junior-order", userId: "user", offer: "junior", status: "pending", processingAt: null as Date | null,
    answers: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [String(i + 1), { choice: "A" }])),
  };
  const prisma = {
    totemOrder: {
      findUnique: vi.fn(async () => ({ ...row })),
      updateMany: vi.fn(async ({ where, data }) => {
        if (where.OR) {
          const stale = row.processingAt && row.processingAt.getTime() <= Date.now() - TOTEM_QUEUE_STALE_MS;
          if (row.status !== "pending" && row.status !== "error" && !(row.status === "processing" && stale)) return { count: 0 };
        } else if (row.status !== where.status || row.processingAt?.getTime() !== where.processingAt.getTime()) {
          return { count: 0 };
        }
        Object.assign(row, data); return { count: 1 };
      }),
    },
    userProfile: { upsert: vi.fn(async () => ({})) },
    juniorTotem: { create: vi.fn(async () => ({})) },
  };
  const generation = { generateImage: vi.fn(async () => ({})) };
  const storage = { store: vi.fn(async () => ({ key: "image", url: "https://example.invalid/image" })) };
  const mirror = { markJuniorDelivered: vi.fn(async () => {}) };
  const service = new StripeWebhookService({ get: () => undefined } as never, prisma as never,
    {} as never, mirror as never, generation as never, storage as never, {} as never);
  return { row, prisma, generation, mirror, service };
}
describe("junior generation reservation", () => {
  it("generates once for two simultaneous requests", async () => {
    const s = setup();
    await Promise.all([s.service.computeJuniorRevealIfNeeded("junior-order"), s.service.computeJuniorRevealIfNeeded("junior-order")]);
    expect(s.generation.generateImage).toHaveBeenCalledOnce();
    expect(s.prisma.juniorTotem.create).toHaveBeenCalledOnce();
    expect(s.mirror.markJuniorDelivered).toHaveBeenCalledOnce();
    expect(s.row.status).toBe("done");
  });
  it("leaves a recent active generation alone", async () => {
    const s = setup(); s.row.status = "processing"; s.row.processingAt = new Date();
    await s.service.computeJuniorRevealIfNeeded("junior-order");
    expect(s.generation.generateImage).not.toHaveBeenCalled();
  });
  it("preserves retry of a failed Junior order", async () => {
    const s = setup(); s.row.status = "error";
    await s.service.computeJuniorRevealIfNeeded("junior-order");
    expect(s.generation.generateImage).toHaveBeenCalledOnce();
    expect(s.row.status).toBe("done");
  });
  it("does not publish from an obsolete generation", async () => {
    const s = setup();
    s.generation.generateImage.mockImplementationOnce(async () => {
      s.row.processingAt = new Date(Date.now() + 1000);
      return {};
    });
    await s.service.computeJuniorRevealIfNeeded("junior-order");
    expect(s.prisma.juniorTotem.create).not.toHaveBeenCalled();
    expect(s.mirror.markJuniorDelivered).not.toHaveBeenCalled();
    expect(s.row.status).toBe("processing");
  });
});
