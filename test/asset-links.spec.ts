import { beforeEach, describe, expect, it, vi } from "vitest";
import { TotemAssetLinksService } from "../src/totem/totem-asset-links.service";
import { SupabaseStorageService } from "../src/totem/supabase-storage.service";
import { TotemOrdersController } from "../src/totem/totem-orders.controller";

const mocks = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ storage: { from: () => ({ download: mocks.download }) } }) }));
function setup() {
  const values: Record<string, string> = {
    SUPABASE_URL: "https://example.invalid", SUPABASE_SERVICE_ROLE_KEY: "test",
    SUPABASE_STORAGE_BUCKET: "private-test", DELIVERY_SIGNING_SECRET: "unit-test-signing-key",
    PUBLIC_ASSET_BASE_URL: "https://assets.example.invalid",
  };
  const storage = new SupabaseStorageService({ getOrThrow: (name: string) => values[name] } as never);
  const rows = [{
    id: "order-1", userId: "owner", status: "done", checkoutSessionId: "cs_owned",
    imageKey: "orders/order-1/image-123.png", imageUrl: null,
    audioKey: "orders/order-1/audio-123.mp3", audioUrl: null,
    pdfKey: "orders/order-1/pdf-123.pdf", pdfUrl: null,
    certificateKey: "orders/order-1/certificate-123.pdf", certificateUrl: null,
    parchmentKey: null, parchmentUrl: null,
  }];
  const prisma = { totemOrder: { findMany: vi.fn(async ({ where }) => rows.filter(row =>
    row.userId === where.userId && row.status === where.status && where.checkoutSessionId.in.includes(row.checkoutSessionId)
  )) } };
  const service = new TotemAssetLinksService(prisma as never, storage);
  return { storage, service, rows, prisma };
}
beforeEach(() => { vi.clearAllMocks(); mocks.download.mockResolvedValue({ data: new Blob(["file"]), error: null }); });
const tokenFrom = (url: string) => new URL(url).pathname.split("/totem-assets/")[1]!;

describe("renewable private asset links", () => {
  it("renews all four files after the original 30-day link has expired", async () => {
    const s = setup();
    const realNow = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(realNow - 31 * 86400_000);
    const old = s.storage.signDeliveryUrl(s.rows[0]!.imageKey);
    vi.restoreAllMocks();
    await expect(s.storage.readSignedObject(tokenFrom(old))).rejects.toThrow("signed_url_expired");
    const [links] = await s.service.forUser("owner", { sessionIds: ["cs_owned"] });
    for (const field of ["image_url", "audio_url", "pdf_url", "certificate_url"] as const) {
      const url = links![field]!;
      const payload = JSON.parse(Buffer.from(tokenFrom(url).split(".")[0]!, "base64url").toString());
      expect(payload.exp - Math.floor(Date.now() / 1000)).toBeGreaterThanOrEqual(3599);
      expect(payload.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(3600);
      await expect(s.storage.readSignedObject(tokenFrom(url))).resolves.toHaveProperty("body");
    }
  });
  it("can recover a key from an authentic expired legacy link", () => {
    const s = setup();
    const old = s.storage.signDeliveryUrl("orders/order-1/image-123.png", -1);
    const renewed = s.storage.renewOwnedUrl("order-1", null, old);
    expect(renewed).not.toBeNull();
    expect(renewed).not.toBe(old);
  });
  it("does not recover a key from a forged legacy link", () => {
    const s = setup();
    const old = s.storage.signDeliveryUrl("orders/order-1/image-123.png", -1);
    expect(s.storage.renewOwnedUrl("order-1", null, old + "x")).toBeNull();
  });
  it.each(["orders/other/image.png", "orders/order-1/../other.png", "orders/order-1/sub/image.png"])("rejects a foreign or invalid storage path: %s", (key) => {
    expect(setup().storage.renewOwnedUrl("order-1", key, null)).toBeNull();
  });
  it("never signs another user's files", async () => {
    const s = setup(); const sign = vi.spyOn(s.storage, "renewOwnedUrl");
    await expect(s.service.forUser("intruder", { sessionIds: ["cs_owned"] })).resolves.toEqual([]);
    expect(sign).not.toHaveBeenCalled();
    expect(s.prisma.totemOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: "intruder", status: "done" }),
    }));
  });
  it("does not sign unfinished orders", async () => {
    const s = setup(); s.rows[0]!.status = "processing";
    await expect(s.service.forUser("owner", { sessionIds: ["cs_owned"] })).resolves.toEqual([]);
  });
  it("does not extend links indefinitely: renewed links expire too", async () => {
    const s = setup();
    const renewed = s.storage.renewOwnedUrl("order-1", s.rows[0]!.imageKey, null)!;
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 3601_000);
    try { await expect(s.storage.readSignedObject(tokenFrom(renewed))).rejects.toThrow("signed_url_expired"); }
    finally { vi.restoreAllMocks(); }
  });
  it.each([{ sessionIds: [] }, { sessionIds: Array(101).fill("cs") }, { sessionIds: ["cs"], key: "orders/victim/file" }])("rejects invalid or oversized requests", async (body) => {
    await expect(setup().service.forUser("owner", body)).rejects.toThrow("asset_links_payload_invalid");
  });
  it("checks authentication before requesting any links", async () => {
    const forUser = vi.fn();
    const controller = new TotemOrdersController({} as never,
      { requireUser: vi.fn().mockRejectedValue(new Error("unauthorized")) } as never, { forUser } as never);
    await expect(controller.renewAssets({ sessionIds: ["cs"] }, "Bearer invalid")).rejects.toThrow("unauthorized");
    expect(forUser).not.toHaveBeenCalled();
  });
});
