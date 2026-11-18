import { randomBytes } from "node:crypto";
import { BadRequestException, ConflictException, GoneException, HttpException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { juniorAnswersSchema } from "./junior-answers";
import { CheckoutService } from "./checkout.service";
import { SupabaseMirrorService } from "./supabase-mirror.service";
import { ResendMailerService } from "./resend-mailer.service";
import { hasTotem } from "./totem-uniqueness";
import { PARENT_CONSENT_VERSION, PARENT_LINK_LIFETIME_MS, parentTokenHash } from "./parent-consent";

const requestSchema = z.object({
  parentEmail: z.string().trim().toLowerCase().email().max(255),
  firstName: z.string().trim().min(1).max(80),
  externalCommandId: z.string().uuid(),
  answers: juniorAnswersSchema,
  locale: z.enum(["fr", "en"]),
  parentConsent: z.literal(true),
  immediateDelivery: z.literal(true),
  consentVersion: z.literal(PARENT_CONSENT_VERSION),
});
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

@Injectable()
export class ParentConsentService {
  private readonly siteOrigin: string;

  constructor(private readonly prisma: PrismaService, private readonly checkout: CheckoutService,
    private readonly mirror: SupabaseMirrorService, private readonly mailer: ResendMailerService, config: ConfigService) {
    this.siteOrigin = new URL(config.getOrThrow<string>("CHECKOUT_SUCCESS_URL")).origin;
  }

  async request(body: unknown, childUserId: string) {
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("parent_request_invalid");
    const input = parsed.data;
    await this.mirror.requireOwnedCommand(input.externalCommandId, childUserId);
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const consent = await this.prisma.$transaction(async tx => {
      const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${childUserId}, 20261025)) AS locked`;
      if (!lock?.locked) throw new ConflictException("totem_checkout_in_progress");
      if (await hasTotem(tx, childUserId)) throw new ConflictException("totem_already_exists");
      const recent = await tx.juniorParentalConsent.findFirst({
        where: { childUserId, createdAt: { gt: new Date(now.getTime() - 60_000) } }, select: { id: true },
      });
      if (recent) throw new HttpException({ code: "parent_email_recently_sent", retryAfter: 60 }, 429);
      return tx.juniorParentalConsent.create({ data: {
        childUserId, externalCommandId: input.externalCommandId, parentEmail: input.parentEmail,
        firstName: input.firstName, locale: input.locale, answers: input.answers,
        tokenHash: parentTokenHash(token), consentVersion: PARENT_CONSENT_VERSION,
        consentedAt: now, expiresAt: new Date(now.getTime() + PARENT_LINK_LIFETIME_MS),
      } });
    });
    try {
      await this.mailer.sendParentConfirmation({
        email: consent.parentEmail, firstName: consent.firstName, locale: input.locale,
        link: `${this.siteOrigin}/${input.locale}/autorisation-parentale#token=${token}`,
      });
    } catch {
      await this.prisma.juniorParentalConsent.deleteMany({ where: { id: consent.id, confirmedAt: null } });
      throw new HttpException("parent_email_unavailable", 503);
    }
    // Keep the previous link usable if sending the replacement email fails.
    await this.prisma.juniorParentalConsent.updateMany({
      where: { childUserId, id: { not: consent.id }, confirmedAt: null, revokedAt: null, createdAt: { lte: consent.createdAt } },
      data: { revokedAt: now },
    });
    return { request: this.childView(consent) };
  }

  async latest(childUserId: string) {
    const consent = await this.prisma.juniorParentalConsent.findFirst({ where: { childUserId, revokedAt: null }, orderBy: { createdAt: "desc" } });
    return { request: consent ? this.childView(consent) : null };
  }

  async status(token: unknown) {
    const consent = await this.readToken(token);
    return { requestId: consent.id, firstName: consent.firstName, parentEmail: consent.parentEmail, locale: consent.locale,
      confirmed: Boolean(consent.confirmedAt), paid: Boolean(consent.paidAt), expiresAt: consent.expiresAt.toISOString() };
  }

  async confirm(token: unknown, requestId: unknown) {
    const consent = await this.readToken(token);
    if (consent.id !== requestId) throw new ConflictException("parent_session_changed");
    const now = new Date();
    const result = await this.prisma.juniorParentalConsent.updateMany({
      where: { id: consent.id, confirmedAt: null, revokedAt: null, expiresAt: { gt: now } }, data: { confirmedAt: now },
    });
    if (!result.count && !consent.confirmedAt) throw new GoneException("parent_link_expired");
    return this.status(token);
  }

  async pay(token: unknown, requestId: unknown) {
    const consent = await this.readToken(token);
    if (consent.id !== requestId) throw new ConflictException("parent_session_changed");
    if (!consent.confirmedAt) throw new ConflictException("parent_confirmation_required");
    if (consent.paidAt) return { paid: true };
    const parentPage = `${this.siteOrigin}/${consent.locale}/autorisation-parentale`;
    const session = await this.checkout.createSession({
      userId: consent.childUserId, email: consent.parentEmail,
      body: { offer: "junior", parentConsentId: consent.id, externalCommandId: consent.externalCommandId,
        firstName: consent.firstName, answers: consent.answers, locale: consent.locale,
        successUrl: `${parentPage}?demande=${consent.id}&retour=paiement`, cancelUrl: `${parentPage}?demande=${consent.id}&retour=annulation` },
    });
    return { checkoutUrl: session.url };
  }

  private async readToken(value: unknown) {
    const parsed = tokenSchema.safeParse(value);
    if (!parsed.success) throw new GoneException("parent_link_expired");
    const consent = await this.prisma.juniorParentalConsent.findUnique({ where: { tokenHash: parentTokenHash(parsed.data) } });
    if (!consent || consent.revokedAt || consent.expiresAt.getTime() <= Date.now()) throw new GoneException("parent_link_expired");
    return consent;
  }

  private childView(consent: { id: string; parentEmail: string; answers: unknown; confirmedAt: Date | null; paidAt: Date | null; expiresAt: Date }) {
    return { id: consent.id, parentEmail: consent.parentEmail, answers: consent.answers,
      confirmed: Boolean(consent.confirmedAt), paid: Boolean(consent.paidAt), expiresAt: consent.expiresAt.toISOString() };
  }
}
