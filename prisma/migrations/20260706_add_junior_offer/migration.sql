-- Add 'junior' to TotemOffer enum
ALTER TYPE "TotemOffer" ADD VALUE 'junior';

-- Add juniorPayload column to TotemOrder
ALTER TABLE "TotemOrder" ADD COLUMN IF NOT EXISTS "juniorPayload" JSONB;
