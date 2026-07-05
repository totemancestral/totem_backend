-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TotemOrderStatus" AS ENUM ('pending', 'processing', 'done', 'error');

-- CreateEnum
CREATE TYPE "TotemOffer" AS ENUM ('origine', 'ancestral', 'famille');

-- CreateEnum
CREATE TYPE "TotemPipelineStep" AS ENUM ('texte', 'image', 'audio', 'pdf', 'upload', 'email', 'pipeline');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('adulte', 'junior');

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'adulte',
    "firstName" TEXT,
    "locale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JuniorTotem" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JuniorTotem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TotemOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "customerEmail" TEXT,
    "customerName" TEXT,
    "checkoutSessionId" TEXT NOT NULL,
    "paymentIntentId" TEXT,
    "status" "TotemOrderStatus" NOT NULL DEFAULT 'pending',
    "locale" TEXT,
    "offer" "TotemOffer" NOT NULL DEFAULT 'ancestral',
    "amountCents" INTEGER,
    "currency" TEXT,
    "country" TEXT,
    "answers" JSONB NOT NULL,
    "textPayload" JSONB,
    "archetypeId" TEXT,
    "ancestralName" TEXT,
    "imageKey" TEXT,
    "audioKey" TEXT,
    "pdfKey" TEXT,
    "parchmentKey" TEXT,
    "certificateKey" TEXT,
    "imageUrl" TEXT,
    "audioUrl" TEXT,
    "pdfUrl" TEXT,
    "parchmentUrl" TEXT,
    "certificateUrl" TEXT,
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "queuedAt" TIMESTAMP(3),
    "processingAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "deliveryEmailSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TotemOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateIndex
CREATE INDEX "JuniorTotem_userId_createdAt_idx" ON "JuniorTotem"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TotemOrder_checkoutSessionId_key" ON "TotemOrder"("checkoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "TotemOrder_paymentIntentId_key" ON "TotemOrder"("paymentIntentId");

-- CreateIndex
CREATE INDEX "TotemOrder_userId_status_idx" ON "TotemOrder"("userId", "status");

-- CreateIndex
CREATE INDEX "TotemOrder_status_createdAt_idx" ON "TotemOrder"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TotemOrder_offer_createdAt_idx" ON "TotemOrder"("offer", "createdAt");

-- CreateIndex
CREATE INDEX "TotemOrder_country_idx" ON "TotemOrder"("country");

-- CreateIndex
CREATE INDEX "TotemPipelineError_orderId_idx" ON "TotemPipelineError"("orderId");

-- CreateIndex
CREATE INDEX "TotemPipelineError_resolved_createdAt_idx" ON "TotemPipelineError"("resolved", "createdAt");

-- AddForeignKey
ALTER TABLE "JuniorTotem" ADD CONSTRAINT "JuniorTotem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemPipelineError" ADD CONSTRAINT "TotemPipelineError_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "TotemOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
