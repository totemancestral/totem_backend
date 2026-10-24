-- Explicit Supabase change; apply after 20261023_public_permissions.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Only application objects created by postgres. supabase_admin is managed
-- by the provider; SQL Editor cannot change that role's default privileges.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated, PUBLIC;

-- Preserve the signature used by existing policies, while disallowing lookup
-- of another user's roles. Role assignment still comes from user_roles.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND _user_id = (SELECT auth.uid())
      AND role = _role
  )
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION public.has_role(uuid, public.app_role)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role)
  TO authenticated, service_role;
-- service_role remains callable, but still gets false without a matching
-- authenticated user identity. Current backend queries user_roles directly.
COMMIT;
