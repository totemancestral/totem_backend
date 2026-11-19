import { describe, expect, it, vi } from "vitest";
import { StripeWebhookService } from "../src/totem/stripe-webhook.service";
import { TOTEM_QUEUE_STALE_MS } from "../src/totem/totem-queue.service";
vi.mock("../src/totem/junior-documents", () => ({ generateJuniorDocuments: async () => ({
  pdf: { bytes: Buffer.from("%PDF-card"), contentType: "application/pdf", extension: "pdf" },
  certificate: { bytes: Buffer.from("%PDF-certificate"), contentType: "application/pdf", extension: "pdf" },
}) }));

function setup() {
  const row = {
    id: "junior-order", userId: "user", offer: "junior", status: "pending", processingAt: null as Date | null,
    createdAt: new Date("2026-11-17"), customerEmail: "parent@example.invalid", deliveryEmailSentAt: null,
    parentConsentId: "confirmed-parent" as string | null, imageKey: null as string | null,
    answers: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [String(i + 1), { choice: "A" }])),
  };
  const prisma = {
    totemOrder: {
      findUnique: vi.fn(async () => ({ ...row })),
      update: vi.fn(async ({ data }) => { Object.assign(row, data); return { ...row }; }),
      updateMany: vi.fn(async ({ where, data }) => {
        if (where.OR) {
          const stale = row.processingAt && row.processingAt.getTime() <= Date.now() - TOTEM_QUEUE_STALE_MS;
          const legacy = row.status === "done" && (!Reflect.get(row, "pdfKey") || !Reflect.get(row, "certificateKey"));
          if (row.status !== "pending" && row.status !== "error" && !legacy && !(row.status === "processing" && stale)) return { count: 0 };
        } else if (row.status !== where.status || row.processingAt?.getTime() !== where.processingAt.getTime()) {
          return { count: 0 };
        }
        Object.assign(row, data); return { count: 1 };
      }),
    },
    userProfile: { upsert: vi.fn(async () => ({})) },
    juniorTotem: { create: vi.fn(async () => ({})) },
    totemPipelineError: { create: vi.fn(async () => ({})) },
  };
  const generation = { generateImage: vi.fn(async () => ({})) };
  const storage = {
    store: vi.fn(async (_id: string, kind: string) => ({ key: kind, url: `https://example.invalid/${kind}` })),
    signDeliveryUrl: vi.fn((key: string) => `https://example.invalid/${key}`),
    readOwnedArtefact: vi.fn(async () => ({ bytes: Buffer.from("%PDF-saved") })),
  };
  const mirror = { markJuniorDelivered: vi.fn(async () => {}) };
  const mailer = { sendJuniorDelivery: vi.fn(async () => true) };
  const service = new StripeWebhookService({ get: () => undefined } as never, prisma as never,
    {} as never, mirror as never, generation as never, storage as never, mailer as never);
  return { row, prisma, generation, mirror, mailer, storage, service };
}
describe("junior generation reservation", () => {
  it("generates once for two simultaneous requests", async () => {
    const s = setup();
    await Promise.all([s.service.computeJuniorRevealIfNeeded("junior-order"), s.service.computeJuniorRevealIfNeeded("junior-order")]);
    expect(s.generation.generateImage).toHaveBeenCalledOnce();
    expect(s.prisma.juniorTotem.create).toHaveBeenCalledOnce();
    expect(s.mirror.markJuniorDelivered).toHaveBeenCalledOnce();
    expect(s.row.status).toBe("done");
    expect(s.storage.store.mock.calls.map(call => call[1])).toEqual(["image", "pdf", "certificate"]);
    expect(s.mailer.sendJuniorDelivery).toHaveBeenCalledWith(expect.objectContaining({ email: "parent@example.invalid", attachments: [
      expect.objectContaining({ filename: "Carte-ancestrale-Junior.pdf" }), expect.objectContaining({ filename: "Certificat-authenticite-Junior.pdf" }),
    ] }));
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
  it("does not mark a document as delivered when PDF storage fails", async () => {
    const s = setup();
    s.storage.store.mockImplementation(async (_id, kind) => {
      if (kind === "pdf") throw Error("upload_failed");
      return { key: kind, url: `https://example.invalid/${kind}` };
    });
    await expect(s.service.computeJuniorRevealIfNeeded("junior-order")).rejects.toThrow("upload_failed");
    expect(s.row.status).toBe("error"); expect(s.mirror.markJuniorDelivered).not.toHaveBeenCalled();
    expect(s.mailer.sendJuniorDelivery).not.toHaveBeenCalled();
  });
  it("retries email delivery from stored PDFs without creating another totem", async () => {
    const s = setup(); s.mailer.sendJuniorDelivery.mockRejectedValueOnce(Error("mail_unavailable"));
    await expect(s.service.computeJuniorRevealIfNeeded("junior-order")).rejects.toThrow("mail_unavailable");
    expect(s.row.status).toBe("done");
    await s.service.computeJuniorRevealIfNeeded("junior-order");
    expect(s.generation.generateImage).toHaveBeenCalledOnce();
    expect(s.prisma.juniorTotem.create).toHaveBeenCalledOnce();
    expect(s.storage.readOwnedArtefact).toHaveBeenCalledTimes(2);
    expect(s.row.deliveryEmailSentAt).toBeInstanceOf(Date);
    await s.service.computeJuniorRevealIfNeeded("junior-order");
    expect(s.mailer.sendJuniorDelivery).toHaveBeenCalledTimes(2);
  });
  it("completes an older paid card from its existing image without emailing an unconfirmed address", async () => {
    const s = setup(); s.row.status = "done"; s.row.parentConsentId = null;
    Object.assign(s.row, { imageKey: "saved-image" });
    await s.service.computeJuniorRevealIfNeeded("junior-order");
    expect(s.generation.generateImage).not.toHaveBeenCalled();
    expect(s.storage.readOwnedArtefact).toHaveBeenCalledWith("junior-order", "saved-image");
    expect(s.storage.store.mock.calls.map(call => call[1])).toEqual(["pdf", "certificate"]);
    expect(s.mailer.sendJuniorDelivery).not.toHaveBeenCalled();
    expect(s.row.status).toBe("done");
  });
});

describe("Junior background recovery", () => {
  it("reuses a saved image when document storage fails before publication", async () => {
    const s = setup();
    s.storage.store.mockImplementationOnce(async () => ({ key: "image", url: "https://example.invalid/image" }))
      .mockImplementationOnce(async () => { throw Error("pdf_down"); });
    await expect(s.service.computeJuniorRevealIfNeeded("junior-order")).rejects.toThrow("pdf_down");
    expect(s.row.imageKey).toBe("image");
    await s.service.computeJuniorRevealIfNeeded("junior-order");
    expect(s.generation.generateImage).toHaveBeenCalledOnce();
    expect(s.row.status).toBe("done");
  });
  it("does not publish if a background worker loses its lease", async () => {
    const s = setup(); const assertLease = vi.fn(async () => { throw Error("worker_lease_lost"); });
    s.row.status = "processing"; s.row.processingAt = new Date();
    await expect(s.service.computeJuniorRevealIfNeeded("junior-order", { processingAt: s.row.processingAt, assertLease })).rejects.toThrow("worker_lease_lost");
    expect(s.mailer.sendJuniorDelivery).not.toHaveBeenCalled();
    expect(s.mirror.markJuniorDelivered).not.toHaveBeenCalled();
    expect(s.row.status).toBe("processing");
  });
});
