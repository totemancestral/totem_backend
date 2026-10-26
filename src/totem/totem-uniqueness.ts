import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

export async function hasTotem(db: Pick<PrismaClient, "$queryRaw">, userId: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ userId: string }[]>`SELECT "userId" FROM public."TotemIdentity" WHERE "userId" = ${userId}`;
  return rows.length > 0;
}

export async function claimTotem(db: Pick<PrismaClient, "$executeRaw" | "$queryRaw">, userId: string, orderId: string) {
  await db.$executeRaw`INSERT INTO public."TotemIdentity" ("userId", "orderId") VALUES (${userId}, ${orderId}) ON CONFLICT ("userId") DO NOTHING`;
  const [owner] = await db.$queryRaw<{ orderId: string }[]>`SELECT "orderId" FROM public."TotemIdentity" WHERE "userId" = ${userId}`;
  if (owner?.orderId !== orderId) throw new ConflictException("totem_already_exists");
}

/** Serialize checkout creation per beneficiary, including across server instances.
 * Stripe's confirmed state is required before an abandoned reservation is released. */
export async function uniqueCheckout<T>(input: {
  db: PrismaClient;
  userId: string;
  offer: string;
  externalCommandId?: string;
  stripe: Stripe;
  create: (tx: Prisma.TransactionClient) => Promise<T>;
  reuse: (session: Stripe.Checkout.Session) => Promise<T>;
}): Promise<T> {
  return input.db.$transaction(async tx => {
    const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${input.userId}, 20261025)) AS locked`;
    if (!lock?.locked) throw new ConflictException("totem_checkout_in_progress");
    if (await hasTotem(tx, input.userId)) throw new ConflictException("totem_already_exists");
    const orders = await tx.$queryRaw<{
      id: string; offer: string; status: string; queuedAt: Date | null;
      textPayload: unknown; juniorPayload: unknown; checkoutSessionId: string;
    }[]>`SELECT id, offer, status, "queuedAt", "textPayload", "juniorPayload", "checkoutSessionId"
      FROM public."TotemOrder" WHERE "userId" = ${input.userId} AND "checkoutExpiredAt" IS NULL ORDER BY "createdAt" DESC`;
    let reusable: Stripe.Checkout.Session | undefined;
    for (const order of orders) {
      if (order.status === "done" || order.status === "processing" || order.queuedAt || order.textPayload || order.juniorPayload) {
        throw new ConflictException(order.status === "done" ? "totem_already_exists" : "totem_order_in_progress");
      }
      let session: Stripe.Checkout.Session;
      try { session = await input.stripe.checkout.sessions.retrieve(order.checkoutSessionId); }
      catch { throw new ServiceUnavailableException("payment_verification_unavailable"); }
      if (session.payment_status === "paid" || session.payment_status === "no_payment_required" || session.status === "complete") {
        throw new ConflictException("totem_order_in_progress");
      }
      if (session.status === "expired" && session.payment_status === "unpaid") {
        await tx.$executeRaw`UPDATE public."TotemOrder" SET "checkoutExpiredAt" = CURRENT_TIMESTAMP WHERE id = ${order.id}`;
        continue;
      }
      if (session.status !== "open" || session.payment_status !== "unpaid") throw new ServiceUnavailableException("payment_verification_unavailable");
      if (!reusable && order.offer === input.offer && session.metadata?.externalCommandId === input.externalCommandId && session.url) {
        reusable = session;
        continue;
      }
      try {
        const expired = await input.stripe.checkout.sessions.expire(session.id);
        if (expired.status !== "expired" || expired.payment_status !== "unpaid") throw new Error("not_expired");
        await tx.$executeRaw`UPDATE public."TotemOrder" SET "checkoutExpiredAt" = CURRENT_TIMESTAMP WHERE id = ${order.id}`;
      } catch { throw new ServiceUnavailableException("payment_verification_unavailable"); }
    }
    return reusable ? input.reuse(reusable) : input.create(tx);
  }, { maxWait: 3000, timeout: 45000 });
}
