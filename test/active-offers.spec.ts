import { beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutService } from "../src/totem/checkout.service";

const { create, update, expire } = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), expire: vi.fn() }));
vi.mock("stripe", () => ({ default: class { checkout = { sessions: { create, update, expire } }; } }));

function fixture() {
  const tx = {
    $queryRaw: vi.fn(async (sql: TemplateStringsArray) => sql.join("").includes("pg_try_advisory") ? [{ locked: true }] : []),
    totemOrder: { create: vi.fn(async ({ data }) => data) },
  };
  const db = { $transaction: async (fn: (value: typeof tx) => unknown) => fn(tx) };
  const config = {
    // Existing deployment overrides cannot silently charge the old amount.
    get: (key: string) => key === "STRIPE_SECRET_KEY" ? "sk_test_mock" : 9900,
    getOrThrow: () => "https://site.invalid/confirmation",
  };
  const mirror = { attachCheckoutSession: vi.fn().mockResolvedValue(undefined) };
  return { service: new CheckoutService(config as never, db as never, mirror as never), tx };
}
const answers = Array.from({ length: 4 }, (_, i) => ({ questionId: `q${i + 1}`, answer: "A" }));
beforeEach(() => {
  vi.clearAllMocks();
  create.mockResolvedValue({ id: "cs_test", url: "https://checkout.invalid/test", payment_intent: null });
  update.mockResolvedValue({});
});

describe("active adult offers", () => {
  it.each([["origine", 2900], ["ancestral", 4900]])("charges and persists %s at %s cents", async (offer, amount) => {
    const { service, tx } = fixture();
    await service.createSession({ userId: "owner", body: { offer, answers } });
    expect(create.mock.calls[0]?.[0].line_items[0].price_data.unit_amount).toBe(amount);
    expect(tx.totemOrder.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ offer, amountCents: amount }) }));
  });
  it("rejects Famille before creating any checkout", async () => {
    await expect(fixture().service.createSession({ userId: "owner", body: { offer: "famille", answers } })).rejects.toMatchObject({ status: 400 });
    expect(create).not.toHaveBeenCalled();
  });
});
