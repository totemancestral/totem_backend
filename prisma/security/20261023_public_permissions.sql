-- Apply explicitly after review: not an automatic Prisma migration.
-- Supabase mirror tables are managed outside the Prisma schema.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Fail atomically if the reviewed Supabase schema is not present.
DO $$
DECLARE
  target text;
  columns_sql text;
  targets text[] := ARRAY[
    'ConsultationReading','JuniorTotem','TotemOrder','TotemPipelineError',
    'UserProfile','_prisma_migrations','admin_audit_log','commandes',
    'erreurs_pipeline','oeuvre_versions','oeuvres','profiles',
    'reponses_parcours','user_roles'
  ];
BEGIN
  FOREACH target IN ARRAY targets LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=target
        AND c.relkind IN ('r','p') AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'Expected RLS-protected public table missing: %', target;
    END IF;
    IF NOT has_table_privilege('service_role', format('public.%I',target), 'SELECT')
       OR NOT has_table_privilege('service_role', format('public.%I',target), 'INSERT')
       OR NOT has_table_privilege('service_role', format('public.%I',target), 'UPDATE')
       OR NOT has_table_privilege('service_role', format('public.%I',target), 'DELETE') THEN
      RAISE EXCEPTION 'Review service_role privileges before applying: %', target;
    END IF;

    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon, authenticated, PUBLIC', target);
    -- Explicitly clear column ACLs as well before granting personal reads.
    SELECT string_agg(format('%I',a.attname), ', ' ORDER BY a.attnum)
      INTO columns_sql FROM pg_attribute a
      WHERE a.attrelid=format('public.%I',target)::regclass
        AND a.attnum>0 AND NOT a.attisdropped;
    EXECUTE format('REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM anon, authenticated, PUBLIC', columns_sql,target);
  END LOOP;
END $$;

-- Retain personal reads; all writes use authenticated server routes/triggers.
GRANT SELECT ON TABLE public.commandes, public.oeuvres, public.oeuvre_versions,
  public.profiles, public.reponses_parcours, public.user_roles TO authenticated;

ALTER POLICY "Admins see all commandes" ON public.commandes
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
    AND (SELECT auth.jwt()->>'aal') = 'aal2');
ALTER POLICY "Admins see all oeuvres" ON public.oeuvres
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
    AND (SELECT auth.jwt()->>'aal') = 'aal2');
ALTER POLICY "Admins see all oeuvre versions" ON public.oeuvre_versions
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
    AND (SELECT auth.jwt()->>'aal') = 'aal2');
ALTER POLICY "Admins read all parcours" ON public.reponses_parcours
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
    AND (SELECT auth.jwt()->>'aal') = 'aal2');
ALTER POLICY "Admins see all roles" ON public.user_roles
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
    AND (SELECT auth.jwt()->>'aal') = 'aal2');

-- "Users see own roles" remains available at AAL1 for MFA enrolment.
-- Existing owner policies remain in place. No storage/managed schema changes.
COMMIT;
