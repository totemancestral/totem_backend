import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseAuthService } from "../src/totem/supabase-auth.service";

const mocks = vi.hoisted(() => ({ role: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({
  from: () => {
    const query = { select: () => query, eq: () => query, maybeSingle: mocks.role };
    return query;
  },
}) }));
const fetchMock = vi.fn();
const token = (payload: unknown) => `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
let service: SupabaseAuthService;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "admin" }) });
  mocks.role.mockResolvedValue({ data: { id: "role" }, error: null });
  service = new SupabaseAuthService({ getOrThrow: () => "https://example.invalid" } as never);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("backend admin MFA enforcement", () => {
  it("hides a provider outage behind a stable public code", async () => {
    fetchMock.mockRejectedValue(new Error("private provider credentials and infrastructure detail"));
    await expect(service.requireUser("Bearer test")).rejects.toMatchObject({ status: 503, message: "authentication_unavailable" });
  });
  it.each([{ aal: "aal1" }, {}, { aal: "aal3" }])("rejects an admin without aal2: %j", async (payload) => {
    await expect(service.requireAdmin(`Bearer ${token(payload)}`)).rejects.toThrow("mfa_required");
  });
  it("rejects a malformed payload", async () => {
    await expect(service.requireAdmin("Bearer invalid")).rejects.toThrow("mfa_required");
  });
  it("accepts an admin only after Supabase validates the same aal2 token", async () => {
    const jwt = token({ aal: "aal2" });
    await expect(service.requireAdmin(`Bearer ${jwt}`)).resolves.toMatchObject({ id: "admin" });
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe(`Bearer ${jwt}`);
  });
  it("rejects a non-admin with aal2", async () => {
    mocks.role.mockResolvedValue({ data: null, error: null });
    await expect(service.requireAdmin(`Bearer ${token({ aal: "aal2" })}`)).rejects.toThrow("admin_access_required");
  });
  it("rejects invalid authentication even if the payload says aal2", async () => {
    fetchMock.mockResolvedValue({ ok: false });
    await expect(service.requireAdmin(`Bearer ${token({ aal: "aal2" })}`)).rejects.toMatchObject({ status: 401 });
    expect(mocks.role).not.toHaveBeenCalled();
  });
  it("rejects missing authentication", async () => {
    await expect(service.requireAdmin()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("fails closed when role lookup fails", async () => {
    mocks.role.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    await expect(service.requireAdmin(`Bearer ${token({ aal: "aal2" })}`)).rejects.toThrow("admin_role_check_failed");
  });
});
