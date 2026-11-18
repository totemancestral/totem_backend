import { createHash } from "node:crypto";
import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

export const PARENT_CONSENT_VERSION = "2026-11-17";
export const PARENT_LINK_LIFETIME_MS = 24 * 60 * 60 * 1000;

export function parentTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function requireParentConsent(db: Pick<Prisma.TransactionClient, "juniorParentalConsent">, id: string | undefined, childUserId: string) {
  if (!id) throw new ForbiddenException("parent_confirmation_required");
  const consent = await db.juniorParentalConsent.findUnique({ where: { id } });
  if (!consent || consent.childUserId !== childUserId || !consent.confirmedAt
    || consent.revokedAt || consent.expiresAt.getTime() <= Date.now()
    || consent.consentVersion !== PARENT_CONSENT_VERSION) {
    throw new ForbiddenException("parent_confirmation_required");
  }
  return consent;
}
