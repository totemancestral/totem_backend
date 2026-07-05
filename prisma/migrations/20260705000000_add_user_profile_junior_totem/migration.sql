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

-- CreateIndex
CREATE INDEX IF NOT EXISTS "JuniorTotem_userId_createdAt_idx" ON "JuniorTotem" ("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "JuniorTotem" ADD CONSTRAINT "JuniorTotem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile"("id") ON DELETE CASCADE;
