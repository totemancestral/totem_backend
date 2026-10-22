-- Ne pas supprimer silencieusement d'anciens tirages si des doublons existent.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ConsultationReading" GROUP BY "userId", "weekKey" HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate weekly cauris readings exist. Review them before applying the unique constraint.';
  END IF;
END $$;

ALTER TABLE "ConsultationReading"
  ADD COLUMN "orderId" TEXT,
  ADD COLUMN "ancestralName" TEXT,
  ADD COLUMN "readingPayload" JSONB;

CREATE UNIQUE INDEX "ConsultationReading_userId_weekKey_key" ON "ConsultationReading"("userId", "weekKey");
DROP INDEX IF EXISTS "ConsultationReading_userId_weekKey_idx";
COMMIT;
