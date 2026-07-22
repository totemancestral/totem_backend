-- =====================================================================
--  TOTEM ANCESTRAL — Tables backend (Prisma) en SQL direct
--  À coller dans Supabase → SQL Editor → Run SI /health/ready reste 503
--  parce que `prisma migrate deploy` n'a pas créé les tables.
--  Idempotent : peut coexister avec un futur `migrate deploy` (|| true).
-- =====================================================================

-- ENUMS (idempotents)
DO $$ BEGIN CREATE TYPE "TotemOrderStatus" AS ENUM ('pending','processing','done','error'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "TotemOffer" AS ENUM ('origine','ancestral','famille','junior'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "TotemPipelineStep" AS ENUM ('texte','image','audio','pdf','upload','email','pipeline'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "UserRole" AS ENUM ('adulte','junior'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- TotemOrder (état final après toutes les migrations)
CREATE TABLE IF NOT EXISTS "TotemOrder" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "customerEmail" TEXT,
  "customerName" TEXT,
  "checkoutSessionId" TEXT NOT NULL,
  "paymentIntentId" TEXT,
  "status" "TotemOrderStatus" NOT NULL DEFAULT 'pending',
  "offer" "TotemOffer" NOT NULL DEFAULT 'ancestral',
  "locale" TEXT,
  "answers" JSONB NOT NULL,
  "textPayload" JSONB,
  "juniorPayload" JSONB,
  "archetypeId" TEXT,
  "ancestralName" TEXT,
  "amountCents" INTEGER,
  "currency" TEXT,
  "country" TEXT,
  "imageKey" TEXT, "audioKey" TEXT, "pdfKey" TEXT, "parchmentKey" TEXT, "certificateKey" TEXT,
  "imageUrl" TEXT, "audioUrl" TEXT, "pdfUrl" TEXT, "parchmentUrl" TEXT, "certificateUrl" TEXT,
  "errorMessage" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "queuedAt" TIMESTAMP(3), "processingAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "deliveryEmailSentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TotemOrder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TotemOrder_checkoutSessionId_key" ON "TotemOrder"("checkoutSessionId");
CREATE UNIQUE INDEX IF NOT EXISTS "TotemOrder_paymentIntentId_key" ON "TotemOrder"("paymentIntentId");
CREATE INDEX IF NOT EXISTS "TotemOrder_userId_status_idx" ON "TotemOrder"("userId","status");
CREATE INDEX IF NOT EXISTS "TotemOrder_status_createdAt_idx" ON "TotemOrder"("status","createdAt");
CREATE INDEX IF NOT EXISTS "TotemOrder_offer_createdAt_idx" ON "TotemOrder"("offer","createdAt");
CREATE INDEX IF NOT EXISTS "TotemOrder_country_idx" ON "TotemOrder"("country");

-- TotemPipelineError
CREATE TABLE IF NOT EXISTS "TotemPipelineError" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "step" "TotemPipelineStep" NOT NULL DEFAULT 'pipeline',
  "code" TEXT,
  "message" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL,
  "resolved" BOOLEAN NOT NULL DEFAULT false,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TotemPipelineError_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TotemPipelineError_orderId_idx" ON "TotemPipelineError"("orderId");
CREATE INDEX IF NOT EXISTS "TotemPipelineError_resolved_createdAt_idx" ON "TotemPipelineError"("resolved","createdAt");
DO $$ BEGIN
  ALTER TABLE "TotemPipelineError" ADD CONSTRAINT "TotemPipelineError_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "TotemOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- UserProfile + JuniorTotem
CREATE TABLE IF NOT EXISTS "UserProfile" (
  "id" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'adulte',
  "firstName" TEXT,
  "locale" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "JuniorTotem" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "answers" JSONB NOT NULL,
  "scores" JSONB NOT NULL,
  "dominant" TEXT NOT NULL,
  "secondary" TEXT NOT NULL,
  "totemName" TEXT NOT NULL,
  "quality" TEXT NOT NULL,
  "phrase" TEXT NOT NULL,
  "orderNumber" INTEGER NOT NULL,
  "shareCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JuniorTotem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "JuniorTotem_userId_createdAt_idx" ON "JuniorTotem"("userId","createdAt");
DO $$ BEGIN
  ALTER TABLE "JuniorTotem" ADD CONSTRAINT "JuniorTotem_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "UserProfile"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
