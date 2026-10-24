import "reflect-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigService } from "@nestjs/config";
import { ExecutionContext, HttpException } from "@nestjs/common";
import { of } from "rxjs";
import { UserRateLimitInterceptor, USER_RATE_LIMITS } from "../src/totem/rate-limit.interceptor";
import { SupabaseAuthService } from "../src/totem/supabase-auth.service";

afterEach(() => vi.unstubAllGlobals());
function setup(scope = "CheckoutController.create", result: unknown = [1, 60000]) {
  const [controller, handler] = scope.split(".");
  const headers = new Map<string, string>();
  const auth = {
    requireUser: vi.fn().mockResolvedValue({ id: "verified-user" }),
    requireAdmin: vi.fn().mockResolvedValue({ id: "verified-admin" }),
  };
  const config = new ConfigService({ UPSTASH_REDIS_URL: "https://redis.invalid", UPSTASH_REDIS_TOKEN: "test-token" });
  const fetcher = vi.fn().mockImplementation(async () => Response.json({ result }));
  vi.stubGlobal("fetch", fetcher);
  const context = {
    getClass: () => ({ name: controller }), getHandler: () => ({ name: handler }),
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization: "Bearer verified-token" }, body: { userId: "forged-user" } }),
      getResponse: () => ({ setHeader: (name: string, value: string) => headers.set(name, value) }),
    }),
  } as unknown as ExecutionContext;
  const next = { handle: vi.fn(() => of("business-result")) };
  const interceptor = new UserRateLimitInterceptor(config, auth as unknown as SupabaseAuthService);
  return { interceptor, context, next, headers, auth, fetcher };
}
describe("backend shared rate limits", () => {
  it.each(Object.keys(USER_RATE_LIMITS))("protects %s before business execution", async (scope) => {
    const t = setup(scope);
    await t.interceptor.intercept(t.context, t.next);
    expect(t.fetcher).toHaveBeenCalledOnce();
    expect(t.next.handle).toHaveBeenCalledOnce();
    const body = t.fetcher.mock.calls[0]![1].body;
    expect(JSON.parse(body)[0]).toBe("EVAL");
    expect(body).toContain("PEXPIRE");
    expect(body).toContain(`totem:rate-limit:backend:v1:${scope}:`);
    expect(body).not.toContain("verified-user");
    expect(body).not.toContain("forged-user");
  });
  it("rejects excess requests before invoking the handler", async () => {
    const t = setup(undefined, [11, 12001]);
    await expect(t.interceptor.intercept(t.context, t.next)).rejects.toMatchObject({ status: 429 });
    expect(t.headers.get("Retry-After")).toBe("13");
    expect(t.next.handle).not.toHaveBeenCalled();
  });
  it("checks administrator MFA before consuming the retry quota", async () => {
    const t = setup("TotemOrdersController.retry");
    t.auth.requireAdmin.mockRejectedValue(new HttpException("mfa_required", 401));
    await expect(t.interceptor.intercept(t.context, t.next)).rejects.toMatchObject({ status: 401 });
    expect(t.fetcher).not.toHaveBeenCalled();
    expect(t.next.handle).not.toHaveBeenCalled();
  });
  it("refuses unauthenticated requests before Redis", async () => {
    const t = setup();
    t.auth.requireUser.mockRejectedValue(new HttpException("unauthorized", 401));
    await expect(t.interceptor.intercept(t.context, t.next)).rejects.toMatchObject({ status: 401 });
    expect(t.fetcher).not.toHaveBeenCalled();
  });
  it.each([null, [1, -1], ["1", 1000], [1]])("fails closed for malformed counters %s", async (result) => {
    const t = setup(undefined, result);
    await expect(t.interceptor.intercept(t.context, t.next)).rejects.toMatchObject({ status: 503 });
    expect(t.headers.get("Retry-After")).toBe("30");
    expect(t.next.handle).not.toHaveBeenCalled();
  });
  it("fails closed during Redis outages", async () => {
    const t = setup();
    t.fetcher.mockRejectedValue(new Error("network"));
    await expect(t.interceptor.intercept(t.context, t.next)).rejects.toMatchObject({ status: 503 });
    expect(t.next.handle).not.toHaveBeenCalled();
  });
  it("uses separate counters for different verified accounts", async () => {
    const t = setup();
    await t.interceptor.intercept(t.context, t.next);
    t.auth.requireUser.mockResolvedValue({ id: "other-user" });
    await t.interceptor.intercept(t.context, t.next);
    expect(JSON.parse(t.fetcher.mock.calls[0]![1].body)[3]).not.toBe(JSON.parse(t.fetcher.mock.calls[1]![1].body)[3]);
  });
  it.each(["StripeWebhookController.handle", "HealthController.ready", "TotemAssetsController.download"])("excludes %s", async (scope) => {
    const t = setup(scope);
    await t.interceptor.intercept(t.context, t.next);
    expect(t.auth.requireUser).not.toHaveBeenCalled();
    expect(t.fetcher).not.toHaveBeenCalled();
    expect(t.next.handle).toHaveBeenCalledOnce();
  });
});
