-- Read-only: no names, emails, answers, or content; review counts before migration.
SELECT 'generation_histories' AS category, "userId", count(*) AS total
FROM public."TotemOrder"
WHERE "queuedAt" IS NOT NULL OR status::text IN ('processing','done')
GROUP BY "userId" HAVING count(*) > 1;

SELECT 'junior_histories' AS category, "userId", count(*) AS total
FROM public."JuniorTotem" GROUP BY "userId" HAVING count(*) > 1;

SELECT 'junior_and_adult' AS category, j."userId", count(*) AS total
FROM public."JuniorTotem" j JOIN public."TotemOrder" o ON o."userId"=j."userId"
WHERE o.offer::text <> 'junior' AND (o."queuedAt" IS NOT NULL OR o.status::text IN ('processing','done'))
GROUP BY j."userId";

-- A PaymentIntent alone does not prove payment. These counts require Stripe reconciliation.
SELECT 'orders_to_reconcile_with_stripe' AS category, "userId", count(*) AS total
FROM public."TotemOrder" GROUP BY "userId" HAVING count(*) > 1;
