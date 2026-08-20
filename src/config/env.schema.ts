import { z } from "zod";
import { TOTEM_PRICES_CENTS } from "../totem/prices";

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const optionalEmail = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().email().optional(),
);

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_ASSET_BASE_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  UPSTASH_REDIS_URL: z.string().url(),
  UPSTASH_REDIS_TOKEN: z.string().min(1),
  TOTEM_WORKER_CONCURRENCY: z.coerce.number().int().positive().max(50).default(2),
  TOTEM_STORY_PAGE_COUNT: z.coerce.number().int().min(5).max(5).default(5),
  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-opus-4-5"),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_IMAGE_MODEL: z.string().min(1).default("gpt-image-2"),
  OPENAI_TTS_MODEL: z.string().min(1).default("gpt-4o-mini-tts"),
  OPENAI_TTS_VOICE: z.string().min(1).default("onyx"),
  CHECKOUT_SUCCESS_URL: z.string().url(),
  CHECKOUT_CANCEL_URL: z.string().url(),
  TOTEM_PRICE_ORIGINE_CENTS: z.coerce.number().int().positive().default(TOTEM_PRICES_CENTS.origine),
  TOTEM_PRICE_ANCESTRAL_CENTS: z.coerce.number().int().positive().default(TOTEM_PRICES_CENTS.ancestral),
  TOTEM_PRICE_FAMILLE_CENTS: z.coerce.number().int().positive().default(TOTEM_PRICES_CENTS.famille),
  TOTEM_PRICE_JUNIOR_CENTS: z.coerce.number().int().positive().default(TOTEM_PRICES_CENTS.junior),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_STORAGE_BUCKET: z.string().min(1),
  DELIVERY_SIGNING_SECRET: z.string().min(32),
  RESEND_API_KEY: z.string().min(1),
  RESEND_FROM_EMAIL: z.string().email(),
  RESEND_FROM_NAME: z.string().min(1).default("Totem Ancestral"),
  CONTACT_EMAIL: optionalEmail,
  ALERT_EMAIL: optionalEmail,
  CORS_ORIGIN: z.string().optional(),
});
