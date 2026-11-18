import { describe, expect, it, vi } from "vitest";
import { ParentConsentService } from "../src/totem/parent-consent.service";
import { PARENT_CONSENT_VERSION, parentTokenHash, requireParentConsent } from "../src/totem/parent-consent";

const token = "a".repeat(43);
function setup(overrides = {}) {
  const record = { id: "request-one", childUserId: "child", externalCommandId: "command", parentEmail: "parent@example.invalid", firstName: "Nadia", locale: "fr", answers: { q1: "A" }, confirmedAt: null, paidAt: null, revokedAt: null, expiresAt: new Date(Date.now() + 60_000), consentVersion: PARENT_CONSENT_VERSION, ...overrides };
  const consent = { findUnique: vi.fn(async () => record), updateMany: vi.fn(async () => { record.confirmedAt = new Date() as never; return { count: 1 }; }) };
  const db = { juniorParentalConsent: consent };
  const checkout = { createSession: vi.fn(async () => ({ url: "https://checkout.stripe.com/test" })) };
  const service = new ParentConsentService(db as never, checkout as never, {} as never, {} as never, { getOrThrow: () => "https://example.invalid/fr/confirmation" } as never);
  return { record, consent, db, checkout, service };
}

describe("parental authorization", () => {
  it("only hashes the capability for database lookup and does not confirm when opened", async () => {
    const { service, consent } = setup();
    expect(await service.status(token)).toMatchObject({ confirmed: false, requestId: "request-one" });
    expect(consent.findUnique).toHaveBeenCalledWith({ where: { tokenHash: parentTokenHash(token) } });
    expect(consent.updateMany).not.toHaveBeenCalled();
  });
  it.each([{ revokedAt: new Date() }, { expiresAt: new Date(0) }])("rejects expired or revoked capabilities", async overrides => {
    await expect(setup(overrides).service.status(token)).rejects.toThrow("parent_link_expired");
  });
  it("rejects malformed links before looking them up", async () => {
    const { service, consent } = setup();
    await expect(service.status("bad")).rejects.toThrow("parent_link_expired");
    expect(consent.findUnique).not.toHaveBeenCalled();
  });
  it("requires an explicit confirmation before creating checkout", async () => {
    const { service, checkout } = setup();
    await expect(service.pay(token, "request-one")).rejects.toThrow("parent_confirmation_required");
    expect(checkout.createSession).not.toHaveBeenCalled();
  });
  it("rejects a different request in another browser tab", async () => {
    const { service, consent } = setup();
    await expect(service.confirm(token, "request-two")).rejects.toThrow("parent_session_changed");
    expect(consent.updateMany).not.toHaveBeenCalled();
  });
  it("confirms explicitly, then uses the saved child answers and parent email", async () => {
    const { service, checkout, record } = setup();
    expect(await service.confirm(token, record.id)).toMatchObject({ confirmed: true });
    await service.pay(token, record.id);
    expect(checkout.createSession).toHaveBeenCalledWith(expect.objectContaining({ userId: "child", email: "parent@example.invalid", body: expect.objectContaining({ answers: record.answers, parentConsentId: record.id, externalCommandId: "command" }) }));
  });
  it("does not create a second checkout after verified payment", async () => {
    const { service, checkout } = setup({ confirmedAt: new Date(), paidAt: new Date() });
    expect(await service.pay(token, "request-one")).toEqual({ paid: true });
    expect(checkout.createSession).not.toHaveBeenCalled();
  });
  it.each([{ childUserId: "other" }, { confirmedAt: null }, { revokedAt: new Date() }, { expiresAt: new Date(0) }, { consentVersion: "old" }])("guards direct checkout independently of the public link", async overrides => {
    const { db } = setup({ confirmedAt: new Date(), ...overrides });
    await expect(requireParentConsent(db as never, "request-one", "child")).rejects.toThrow("parent_confirmation_required");
  });
});
