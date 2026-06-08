CREATE TYPE "TotemOrderStatus" AS ENUM ('pending', 'processing', 'done', 'error');

CREATE TABLE "TotemOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "customerEmail" TEXT,
    "checkoutSessionId" TEXT NOT NULL,
    "paymentIntentId" TEXT,
    "status" "TotemOrderStatus" NOT NULL DEFAULT 'pending',
    "locale" TEXT,
    "answers" JSONB NOT NULL,
    "textPayload" JSONB,
    "archetypeId" TEXT,
    "ancestralName" TEXT,
    "imageKey" TEXT,
    "audioKey" TEXT,
    "pdfKey" TEXT,
    "imageUrl" TEXT,
    "audioUrl" TEXT,
    "pdfUrl" TEXT,
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

CREATE UNIQUE INDEX "TotemOrder_checkoutSessionId_key" ON "TotemOrder"("checkoutSessionId");
CREATE INDEX "TotemOrder_userId_status_idx" ON "TotemOrder"("userId", "status");
CREATE INDEX "TotemOrder_status_createdAt_idx" ON "TotemOrder"("status", "createdAt");
