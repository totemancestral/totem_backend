BEGIN;
SET LOCAL lock_timeout = '3s';
CREATE TABLE public."JuniorParentalConsent" (
  id UUID PRIMARY KEY,
  "childUserId" UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "externalCommandId" UUID NOT NULL REFERENCES public.commandes(id) ON DELETE CASCADE,
  "parentEmail" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  locale TEXT NOT NULL,
  answers JSONB NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL UNIQUE,
  "consentVersion" TEXT NOT NULL,
  "consentedAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "JuniorParentalConsent_childUserId_createdAt_idx" ON public."JuniorParentalConsent"("childUserId", "createdAt");
ALTER TABLE public."JuniorParentalConsent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."JuniorParentalConsent" FROM PUBLIC, anon, authenticated;
GRANT ALL ON public."JuniorParentalConsent" TO service_role;
ALTER TABLE public."TotemOrder" ADD COLUMN "parentConsentId" UUID REFERENCES public."JuniorParentalConsent"(id) ON DELETE SET NULL;
COMMIT;
