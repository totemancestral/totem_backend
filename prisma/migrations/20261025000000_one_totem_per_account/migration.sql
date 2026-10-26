BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public."TotemOrder", public."JuniorTotem" IN SHARE ROW EXCLUSIVE MODE;
-- Grandfather all historical deliveries without updating or removing any of them.
-- One control record marks the account as used; it does not choose which files
-- remain accessible. All historical completed orders remain readable/updatable.

CREATE TABLE public."TotemIdentity" (
  "userId" TEXT PRIMARY KEY,
  "orderId" TEXT NOT NULL UNIQUE,
  "juniorId" TEXT UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE public."TotemOrder" ADD COLUMN "checkoutExpiredAt" TIMESTAMP(3);
ALTER TABLE public."TotemIdentity" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."TotemIdentity" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public."TotemIdentity" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public."TotemIdentity" FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT ALL ON public."TotemIdentity" TO service_role; END IF;
END $$;

INSERT INTO public."TotemIdentity" ("userId", "orderId")
SELECT DISTINCT ON ("userId") "userId", id FROM public."TotemOrder"
WHERE "queuedAt" IS NOT NULL OR status::text IN ('processing','done')
ORDER BY "userId", CASE WHEN status::text='done' THEN 0 ELSE 1 END, "createdAt", id;
INSERT INTO public."TotemIdentity" ("userId", "orderId")
SELECT DISTINCT ON ("userId") "userId", 'junior:' || id FROM public."JuniorTotem" ORDER BY "userId", id
ON CONFLICT ("userId") DO NOTHING;
UPDATE public."TotemIdentity" i SET "juniorId" = (
  SELECT min(j.id) FROM public."JuniorTotem" j WHERE j."userId"=i."userId"
) WHERE EXISTS (SELECT 1 FROM public."JuniorTotem" j WHERE j."userId"=i."userId");
-- Also cover historical deliveries made before the current backend existed.
DO $$ BEGIN
  IF to_regclass('public.oeuvres') IS NOT NULL THEN
    EXECUTE 'INSERT INTO public."TotemIdentity" ("userId", "orderId")
      SELECT DISTINCT user_id::text, ''legacy:'' || user_id::text FROM public.oeuvres
      WHERE statut::text = ''livree'' AND user_id IS NOT NULL
      ON CONFLICT ("userId") DO NOTHING';
  END IF;
END $$;

CREATE FUNCTION public.enforce_one_totem() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE owner_order text;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."userId" <> OLD."userId" OR NEW.id <> OLD.id) THEN
    RAISE EXCEPTION 'totem_owner_immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP='INSERT' AND EXISTS (
    SELECT 1 FROM public."TotemIdentity" WHERE "userId"=NEW."userId" AND "orderId"<>NEW.id
  ) THEN
    RAISE EXCEPTION 'totem_already_exists' USING ERRCODE='23505';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status::text='done' THEN
    IF NEW.status::text='done' THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'totem_already_exists' USING ERRCODE = '23505';
  END IF;
  IF NEW."queuedAt" IS NULL AND NEW.status::text NOT IN ('processing','done') THEN RETURN NEW; END IF;
  INSERT INTO public."TotemIdentity" ("userId", "orderId") VALUES (NEW."userId", NEW.id)
    ON CONFLICT ("userId") DO NOTHING;
  SELECT "orderId" INTO owner_order FROM public."TotemIdentity" WHERE "userId" = NEW."userId";
  IF owner_order <> NEW.id THEN
    RAISE EXCEPTION 'totem_already_exists' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_one_totem() FROM PUBLIC;
CREATE TRIGGER "TotemOrder_one_per_account" BEFORE INSERT OR UPDATE ON public."TotemOrder"
FOR EACH ROW EXECUTE FUNCTION public.enforce_one_totem();

CREATE FUNCTION public.enforce_one_junior_totem() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE owner_order text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."userId" <> OLD."userId" OR NEW.id <> OLD.id THEN
      RAISE EXCEPTION 'totem_owner_immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  INSERT INTO public."TotemIdentity" ("userId", "orderId") VALUES (NEW."userId", 'junior:' || NEW.id)
    ON CONFLICT ("userId") DO NOTHING;
  SELECT "orderId" INTO owner_order FROM public."TotemIdentity" WHERE "userId" = NEW."userId";
  IF owner_order = 'junior:' || NEW.id OR EXISTS (
    SELECT 1 FROM public."TotemOrder" WHERE id=owner_order AND "userId"=NEW."userId" AND offer::text='junior'
  ) THEN
    UPDATE public."TotemIdentity" SET "juniorId"=NEW.id
      WHERE "userId"=NEW."userId" AND ("juniorId" IS NULL OR "juniorId"=NEW.id);
    IF FOUND THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'totem_already_exists' USING ERRCODE = '23505';
END $$;
REVOKE ALL ON FUNCTION public.enforce_one_junior_totem() FROM PUBLIC;
CREATE TRIGGER "JuniorTotem_one_per_account" BEFORE INSERT OR UPDATE ON public."JuniorTotem"
FOR EACH ROW EXECUTE FUNCTION public.enforce_one_junior_totem();
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON FUNCTION public.enforce_one_totem(), public.enforce_one_junior_totem() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON FUNCTION public.enforce_one_totem(), public.enforce_one_junior_totem() FROM authenticated;
  END IF;
END $$;
COMMIT;
