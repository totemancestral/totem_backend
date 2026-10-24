import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TotemOrder } from "@prisma/client";
import { SupabaseMirrorService } from "../src/totem/supabase-mirror.service";
import { CheckoutService } from "../src/totem/checkout.service";

const db = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  writes: [] as Record<string, unknown>[],
  queries: [] as Array<Array<[string, unknown]>>,
  loseOwnership: false,
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({
  from: () => {
    const filters: Array<[string, unknown]> = [];
    let patch: Record<string, unknown> | undefined;
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      update: (value: Record<string, unknown>) => { patch = value; return query; },
      insert: () => { throw new Error("unexpected_insert"); },
      maybeSingle: async () => {
        db.queries.push(filters);
        if (patch && db.loseOwnership) db.rows.forEach((row) => { row.user_id = "other"; });
        const row = db.rows.find((entry) => filters.every(([key, value]) => entry[key] === value));
        if (row && patch) { db.writes.push(patch); Object.assign(row, patch); }
        return { data: row ? { id: row.id } : null, error: null };
      },
    };
    return query;
  },
}) }));

const commandId = "00000000-0000-4000-8000-000000000001";
const config = { get: () => undefined, getOrThrow: () => "https://example.invalid" };
const order = { userId: "owner", checkoutSessionId: "cs_1", paymentIntentId: "pi_1" } as TotemOrder;
let mirror: SupabaseMirrorService;

beforeEach(() => {
  db.rows = [{ id: commandId, user_id: "owner", stripe_session_id: "cs_1", stripe_payment_intent_id: "pi_1" }];
  db.writes = []; db.queries = []; db.loseOwnership = false;
  mirror = new SupabaseMirrorService(config as never);
});

describe("command ownership", () => {
  it("does not delete pipeline history when marking a retry", async () => {
    // The fake client has no delete method: an attempted deletion fails the test.
    await expect(mirror.markRetrying(commandId)).resolves.toBeUndefined();
  });
  it("allows repeated paid notifications for the owner", async () => {
    for (let i = 0; i < 2; i++) {
      await expect(mirror.markPaid({ order, externalCommandId: commandId })).resolves.toBe(commandId);
    }
    expect(db.writes).toHaveLength(2);
    expect(db.queries.every((filters) => filters.some(([key, value]) => key === "user_id" && value === "owner"))).toBe(true);
  });

  it.each(["other", "missing"])("refuses an explicitly supplied %s command without fallback", async (kind) => {
    if (kind === "other") db.rows[0]!.user_id = "victim";
    else db.rows = [];
    await expect(mirror.markPaid({ order, externalCommandId: commandId })).rejects.toThrow("commande_not_found");
    expect(db.writes).toEqual([]);
    expect(db.queries).toHaveLength(1);
  });

  it("rejects a malformed explicit identifier", async () => {
    await expect(mirror.markPaid({ order, externalCommandId: "invalid" })).rejects.toThrow("external_command_invalid");
    expect(db.queries).toEqual([]);
  });

  it("does not write if ownership changes after lookup", async () => {
    db.loseOwnership = true;
    await expect(mirror.markPaid({ order, externalCommandId: commandId })).rejects.toThrow("commande_not_found");
    expect(db.writes).toEqual([]);
  });

  it.each(["session", "intent"])("isolates fallback lookup by %s", async (kind) => {
    db.rows[0]!.user_id = "victim";
    if (kind === "intent") db.rows[0]!.stripe_session_id = "another_session";
    await mirror.markProcessing(order);
    expect(db.writes).toEqual([]);
    expect(db.queries).toHaveLength(2);
    expect(db.queries.every((filters) => filters.some(([key, value]) => key === "user_id" && value === "owner"))).toBe(true);
  });

  it.each(["session", "intent"])("preserves owner lookup by %s without an external identifier", async (kind) => {
    if (kind === "intent") db.rows[0]!.stripe_session_id = "another_session";
    await expect(mirror.markPaid({ order })).resolves.toBe(commandId);
    expect(db.writes).toHaveLength(1);
    expect(db.rows[0]!.statut).toBe("paye");
  });

  it("attaches a session only to an owned command", async () => {
    await mirror.attachCheckoutSession({ externalCommandId: commandId, userId: "owner", checkoutSessionId: "cs_new" });
    expect(db.rows[0]!.stripe_session_id).toBe("cs_new");
    await expect(mirror.attachCheckoutSession({ externalCommandId: commandId, userId: "attacker", checkoutSessionId: "cs_bad" }))
      .rejects.toThrow("commande_not_found");
    expect(db.rows[0]!.stripe_session_id).toBe("cs_new");
  });

  it.each(["origine", "junior"])("rejects an unauthorized %s checkout before Stripe or order creation", async (offer) => {
    const create = vi.fn();
    const service = new CheckoutService(config as never, { totemOrder: { create } } as never, mirror);
    const body = offer === "junior"
      ? { offer, externalCommandId: commandId, answers: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [String(i + 1), { choice: "A" }])) }
      : { offer, externalCommandId: commandId, answers: Array.from({ length: 4 }, (_, i) => ({ questionId: `q${i + 1}`, answer: "A" })) };
    db.rows[0]!.user_id = "victim";
    await expect(service.createSession({ body, userId: "owner" })).rejects.toThrow("commande_not_found");
    expect(create).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });
});
