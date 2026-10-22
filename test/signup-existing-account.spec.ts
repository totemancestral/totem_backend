import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../projet-totem-ancestral/app/api/auth/signup/route";

const mocks = vi.hoisted(() => ({ listUsers: vi.fn(), signUp: vi.fn(), limit: vi.fn() }));
vi.mock("../../projet-totem-ancestral/lib/supabase/server", () => ({
  createServiceClient: () => ({ auth: { admin: { listUsers: mocks.listUsers } } }),
  createPublicAuthClient: () => ({ auth: { signUp: mocks.signUp } }),
}));
vi.mock("../../projet-totem-ancestral/lib/rate-limit", () => ({ rateLimit: mocks.limit }));
vi.mock("../../projet-totem-ancestral/lib/env", () => ({ getServerEnv: () => ({ NEXT_PUBLIC_SITE_URL: "https://totem.example" }) }));

const request = (locale = "fr") => new Request("http://localhost/api/auth/signup", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "  Test@Example.com  ", password: "StrongPassword1", locale }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockResolvedValue(null);
  mocks.listUsers.mockResolvedValue({ data: { users: [] }, error: null });
  mocks.signUp.mockResolvedValue({ data: { user: { identities: [{ id: "new" }] }, session: null }, error: null });
});

describe("existing account at signup", () => {
  it.each([true, false])("rejects an existing account (confirmed=%s) before sending any signup email", async (confirmed) => {
    mocks.listUsers.mockResolvedValue({ data: { users: [{ email: "test@example.com", email_confirmed_at: confirmed ? "2026-01-01" : null }] }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "email_exists", error: expect.stringContaining("Un compte existe déjà") });
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("checks later Auth pages and returns the English message", async () => {
    mocks.listUsers.mockResolvedValueOnce({ data: { users: Array.from({ length: 1000 }, (_, i) => ({ email: `user${i}@example.com` })) }, error: null })
      .mockResolvedValueOnce({ data: { users: [{ email: "TEST@example.com" }] }, error: null });
    const response = await POST(request("en"));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("An account already exists");
    expect(mocks.listUsers).toHaveBeenNthCalledWith(2, { page: 2, perPage: 1000 });
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("lets a new address use the normal confirmation flow", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, sessionReady: false });
    expect(mocks.signUp).toHaveBeenCalledWith(expect.objectContaining({ email: "test@example.com" }));
  });

  it.each([
    { data: { user: { identities: [] }, session: null }, error: null },
    { data: {}, error: { code: "user_already_exists", message: "User already registered", status: 422 } },
  ])("also handles a duplicate returned by Supabase after the pre-check", async (result) => {
    mocks.signUp.mockResolvedValue(result);
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("email_exists");
  });

  it("does not send a signup email when the account lookup fails", async () => {
    mocks.listUsers.mockResolvedValue({ data: { users: [] }, error: new Error("Lookup unavailable") });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(mocks.signUp).not.toHaveBeenCalled();
  });
});
