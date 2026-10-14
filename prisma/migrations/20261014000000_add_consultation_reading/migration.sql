-- CreateEnum
CREATE TYPE "CaurisSerie" AS ENUM ('D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8');

-- CreateEnum
CREATE TYPE "CaurisMood" AS ENUM ('apaise', 'en_doute', 'en_combat');

-- CreateTable
CREATE TABLE "ConsultationReading" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "archetypeId" TEXT NOT NULL,
    "serie" "CaurisSerie" NOT NULL,
    "imageCode" TEXT NOT NULL,
    "paroleCode" TEXT NOT NULL,
    "gesteCode" TEXT NOT NULL,
    "mood" "CaurisMood",
    "weekKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConsultationReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ConsultationReading_userId_createdAt_idx" ON "ConsultationReading" ("userId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ConsultationReading_userId_weekKey_idx" ON "ConsultationReading" ("userId", "weekKey");

-- AddForeignKey
ALTER TABLE "ConsultationReading" ADD CONSTRAINT "ConsultationReading_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile"("id") ON DELETE CASCADE;
