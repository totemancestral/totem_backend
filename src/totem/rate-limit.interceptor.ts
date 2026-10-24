import { createHmac } from "node:crypto";
import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import { SupabaseAuthService } from "./supabase-auth.service";

// Selected controller methods only: Stripe callbacks, health and signed assets
// deliberately do not consume interactive user quotas.
export const USER_RATE_LIMITS: Record<string, number> = {
  "CheckoutController.create": 10,
  "TotemOrdersController.complete": 10,
  "TotemOrdersController.retry": 5,
  "TotemOrdersController.renewAssets": 30,
  "TotemOrdersController.bySession": 60,
  "ConsultationCaurisController.tirer": 10,
  "ConsultationCaurisController.etat": 60,
  "ConsultationCaurisController.historique": 30,
  "JuniorController.reveal": 10,
  "JuniorController.listTotems": 30,
  "JuniorController.shareTotem": 10,
};
const script = `local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {n, redis.call('PTTL', KEYS[1])}`;

@Injectable()
export class UserRateLimitInterceptor implements NestInterceptor {
  constructor(private readonly config: ConfigService, private readonly auth: SupabaseAuthService) {}

  async intercept(context: ExecutionContext, next: CallHandler) {
    const scope = `${context.getClass().name}.${context.getHandler().name}`;
    const max = USER_RATE_LIMITS[scope];
    if (!max) return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<{ headers: { authorization?: string } }>();
    // The identity comes from Supabase verification, never from request data or
    // an unverified JWT. Controllers retain their authorization/ownership checks.
    const user = scope === "TotemOrdersController.retry"
      ? await this.auth.requireAdmin(request.headers.authorization)
      : await this.auth.requireUser(request.headers.authorization);
    const response = http.getResponse<Response>();
    let count: number;
    let ttl: number;
    try {
      const url = this.config.getOrThrow<string>("UPSTASH_REDIS_URL");
      const token = this.config.getOrThrow<string>("UPSTASH_REDIS_TOKEN");
      if (new URL(url).protocol !== "https:") throw new Error("redis_https_required");
      const identity = createHmac("sha256", token).update(user.id).digest("hex");
      const result = await fetch(url.replace(/\/$/, ""), {
        method: "POST", signal: AbortSignal.timeout(3000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(["EVAL", script, "1", `totem:rate-limit:backend:v1:${scope}:${identity}`, "60000"]),
      });
      if (!result.ok) throw new Error("redis_unavailable");
      const data = await result.json();
      if (data?.error || !Array.isArray(data?.result) || data.result.length !== 2) throw new Error("redis_invalid_response");
      [count, ttl] = data.result;
      if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(ttl) || ttl < 0) throw new Error("redis_invalid_counter");
    } catch {
      response.setHeader("Retry-After", "30");
      response.setHeader("Cache-Control", "private, no-store");
      throw new HttpException({ statusCode: 503, message: "rate_limit_unavailable", retryAfter: 30 }, 503);
    }
    if (count > max) {
      const seconds = Math.max(1, Math.ceil(ttl / 1000));
      response.setHeader("Retry-After", String(seconds));
      response.setHeader("Cache-Control", "private, no-store");
      throw new HttpException({ statusCode: 429, message: "rate_limit_exceeded", retryAfter: seconds }, 429);
    }
    return next.handle();
  }
}
