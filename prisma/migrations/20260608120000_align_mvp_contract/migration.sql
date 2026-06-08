CREATE TYPE "TotemOffer" AS ENUM ('origine', 'ancestral', 'famille');
CREATE TYPE "TotemPipelineStep" AS ENUM ('texte', 'image', 'audio', 'pdf', 'upload', 'email', 'pipeline');

ALTER TABLE "TotemOrder"
  ADD COLUMN "customerName" TEXT,
  ADD COLUMN "offer" "TotemOffer" NOT NULL DEFAULT 'ancestral',
  ADD COLUMN "amountCents" INTEGER,
  ADD COLUMN "currency" TEXT,
  ADD COLUMN "country" TEXT,
  ADD COLUMN "parchmentKey" TEXT,
  ADD COLUMN "certificateKey" TEXT,
  ADD COLUMN "parchmentUrl" TEXT,
  ADD COLUMN "certificateUrl" TEXT;

CREATE UNIQUE INDEX "TotemOrder_paymentIntentId_key" ON "TotemOrder"("paymentIntentId");
CREATE INDEX "TotemOrder_offer_createdAt_idx" ON "TotemOrder"("offer", "createdAt");
CREATE INDEX "TotemOrder_country_idx" ON "TotemOrder"("country");

CREATE TABLE "TotemPipelineError" (
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

CREATE INDEX "TotemPipelineError_orderId_idx" ON "TotemPipelineError"("orderId");
CREATE INDEX "TotemPipelineError_resolved_createdAt_idx" ON "TotemPipelineError"("resolved", "createdAt");

ALTER TABLE "TotemPipelineError"
  ADD CONSTRAINT "TotemPipelineError_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "TotemOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
