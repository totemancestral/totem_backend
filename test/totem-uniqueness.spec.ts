import { describe, expect, it, vi } from "vitest";
import { claimTotem, hasTotem, uniqueCheckout } from "../src/totem/totem-uniqueness";

function fixture(options: { owned?: boolean; locked?: boolean; orders?: Record<string, unknown>[] } = {}) {
  const tx = {
    $queryRaw: vi.fn(async (sql: TemplateStringsArray) => {
      const query = sql.join("?");
      if (query.includes("pg_try_advisory")) return [{ locked: options.locked !== false }];
      if (query.includes('FROM public."TotemIdentity"')) return options.owned ? [{ userId: "user" }] : [];
      return options.orders ?? [];
    }),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  const db = { $transaction: vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)) };
  const stripe = { checkout: { sessions: {
    retrieve: vi.fn().mockResolvedValue({ id: "cs_old", status: "expired", payment_status: "unpaid" }),
    expire: vi.fn().mockResolvedValue({ status: "expired", payment_status: "unpaid" }),
  } } };
  const create = vi.fn().mockResolvedValue({ id: "cs_new" });
  const reuse = vi.fn(async session => ({ id: session.id }));
  const run = (offer = "ancestral") => uniqueCheckout({ db: db as never, stripe: stripe as never, userId: "user", offer, create, reuse });
  return { run, tx, db, stripe, create, reuse };
}
const pending = { id: "old", status: "pending", offer: "ancestral", checkoutSessionId: "cs_old", queuedAt: null, textPayload: null, juniorPayload: null };

describe("one Totem per account, across offers", () => {
  it.each(["origine", "ancestral", "famille", "junior"])("rejects %s before any Stripe call if the account owns a Totem", async offer => {
    const s = fixture({ owned: true });
    await expect(s.run(offer)).rejects.toThrow("totem_already_exists");
    expect(s.create).not.toHaveBeenCalled(); expect(s.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
  });
  it("rejects a concurrent checkout instead of waiting or creating another session", async () => {
    const s = fixture({ locked: false });
    await expect(s.run()).rejects.toThrow("totem_checkout_in_progress");
    expect(s.create).not.toHaveBeenCalled();
  });
  it("creates a first checkout only after acquiring the account lock", async () => {
    const s = fixture(); await expect(s.run()).resolves.toEqual({ id: "cs_new" });
    expect(s.create).toHaveBeenCalledExactlyOnceWith(s.tx);
  });
  it("reuses an unpaid open session for the same offer and draft", async () => {
    const s = fixture({ orders: [pending] });
    s.stripe.checkout.sessions.retrieve.mockResolvedValue({ id: "cs_old", status: "open", payment_status: "unpaid", url: "https://checkout.example.invalid/old", metadata: {} } as never);
    await expect(s.run()).resolves.toEqual({ id: "cs_old" });
    expect(s.create).not.toHaveBeenCalled(); expect(s.stripe.checkout.sessions.expire).not.toHaveBeenCalled();
  });
  it("expires a previous unpaid session before changing offers", async () => {
    const s = fixture({ orders: [pending] });
    s.stripe.checkout.sessions.retrieve.mockResolvedValue({ id: "cs_old", status: "open", payment_status: "unpaid" });
    await s.run("junior");
    expect(s.stripe.checkout.sessions.expire).toHaveBeenCalledExactlyOnceWith("cs_old");
    expect(s.tx.$executeRaw).toHaveBeenCalled(); expect(s.create).toHaveBeenCalledOnce();
  });
  it("allows another checkout only after Stripe confirms expiration and non-payment", async () => {
    const s = fixture({ orders: [pending] }); await s.run(); expect(s.create).toHaveBeenCalledOnce();
    expect(s.tx.$executeRaw).toHaveBeenCalledOnce();
  });
  it("blocks an already paid order, including Junior to adult", async () => {
    const s = fixture({ orders: [{ ...pending, offer: "junior" }] });
    s.stripe.checkout.sessions.retrieve.mockResolvedValue({ id: "cs_old", status: "complete", payment_status: "paid" });
    await expect(s.run()).rejects.toThrow("totem_order_in_progress"); expect(s.create).not.toHaveBeenCalled();
  });
  it("does not interpret Stripe unavailability or a failed expiration as an abandoned payment", async () => {
    const s = fixture({ orders: [pending] });
    s.stripe.checkout.sessions.retrieve.mockRejectedValueOnce(new Error("network"));
    await expect(s.run()).rejects.toThrow("payment_verification_unavailable");
    s.stripe.checkout.sessions.retrieve.mockResolvedValue({ id: "cs_old", status: "open", payment_status: "unpaid" });
    s.stripe.checkout.sessions.expire.mockRejectedValueOnce(new Error("already_paid"));
    await expect(s.run("junior")).rejects.toThrow("payment_verification_unavailable"); expect(s.create).not.toHaveBeenCalled();
  });
  it("keeps a failed generation on its original paid order", async () => {
    const s = fixture({ orders: [{ ...pending, status: "error", queuedAt: new Date() }] });
    await expect(s.run()).rejects.toThrow("totem_order_in_progress"); expect(s.create).not.toHaveBeenCalled();
  });
  it("permits the same generation claim on retries but rejects another order", async () => {
    const db = { $executeRaw: vi.fn().mockResolvedValue(1), $queryRaw: vi.fn().mockResolvedValue([{ orderId: "first" }]) };
    await expect(claimTotem(db as never, "user", "first")).resolves.toBeUndefined();
    await expect(claimTotem(db as never, "user", "second")).rejects.toThrow("totem_already_exists");
    expect(await hasTotem(db as never, "user")).toBe(true);
  });
});
