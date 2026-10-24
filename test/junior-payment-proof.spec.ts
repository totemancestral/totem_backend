import { beforeEach, describe, expect, it, vi } from "vitest";
import { JuniorService } from "../src/totem/junior.service";

const { retrieve } = vi.hoisted(() => ({ retrieve: vi.fn() }));
vi.mock("stripe", () => ({ default: class { checkout = { sessions: { retrieve } }; } }));
const answers = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [String(i + 1), { choice: "A" }]));
const body = { checkoutSessionId: "cs_test", answers };
function setup(secret: string | undefined = "sk_test_mock") {
  const order = { id: "owned-order", userId: "owner", offer: "junior", checkoutSessionId: "cs_test", paymentIntentId: "pi_created_only", answers, locale: "fr", imageKey: null, imageUrl: null };
  const prisma = {
    totemOrder: { findFirst: vi.fn().mockResolvedValue(order) },
    userProfile: { upsert: vi.fn().mockResolvedValue({}) },
    juniorTotem: { findFirst: vi.fn().mockResolvedValue({ id: "existing", scores: {}, dominant: "F", secondary: "E", totemName: "Name", quality: "Vision", phrase: "Saved" }), create: vi.fn() },
  };
  const service = new JuniorService(prisma as never, { requireUser: vi.fn().mockResolvedValue({ id: "owner" }) } as never,
    { renewOwnedUrl: vi.fn().mockReturnValue(null) } as never, { get: () => secret } as never);
  return { service, prisma, order };
}
beforeEach(() => { retrieve.mockReset(); });
describe("Junior payment proof", () => {
  it.each(["unpaid", "no_payment_required"])("does not reveal or write for %s despite an existing intent", async payment_status => {
    const s = setup(); retrieve.mockResolvedValue({ payment_status });
    await expect(s.service.reveal(body, "Bearer test")).rejects.toThrow("junior_payment_not_confirmed");
    expect(s.prisma.userProfile.upsert).not.toHaveBeenCalled();
    expect(s.prisma.juniorTotem.findFirst).not.toHaveBeenCalled();
    expect(s.prisma.juniorTotem.create).not.toHaveBeenCalled();
  });
  it("looks up the authenticated owner's Junior order before contacting Stripe", async () => {
    const s = setup(); s.prisma.totemOrder.findFirst.mockResolvedValue(null);
    await expect(s.service.reveal(body, "Bearer test")).rejects.toThrow("junior_payment_not_confirmed");
    expect(s.prisma.totemOrder.findFirst).toHaveBeenCalledWith({ where: { checkoutSessionId: "cs_test", userId: "owner", offer: "junior" } });
    expect(retrieve).not.toHaveBeenCalled();
  });
  it("returns the existing result only after Stripe confirms payment", async () => {
    const s = setup(); retrieve.mockResolvedValue({ payment_status: "paid" });
    await expect(s.service.reveal(body, "Bearer test")).resolves.toMatchObject({ id: "existing", saved: true });
    expect(retrieve).toHaveBeenCalledExactlyOnceWith("cs_test");
    expect(s.prisma.juniorTotem.create).not.toHaveBeenCalled();
  });
  it("reports a verification outage without treating it as an unpaid order", async () => {
    const s = setup(); retrieve.mockRejectedValue(new Error("Stripe unavailable"));
    await expect(s.service.reveal(body, "Bearer test")).rejects.toMatchObject({ status: 503, message: "payment_verification_unavailable" });
    expect(s.prisma.userProfile.upsert).not.toHaveBeenCalled();
  });
  it("fails closed when the payment verification secret is unavailable", async () => {
    const s = setup(); s.service = new JuniorService(s.prisma as never, { requireUser: async () => ({ id: "owner" }) } as never, {} as never, { get: () => undefined } as never);
    await expect(s.service.reveal(body, "Bearer test")).rejects.toMatchObject({ status: 503 });
    expect(retrieve).not.toHaveBeenCalled();
  });
});
