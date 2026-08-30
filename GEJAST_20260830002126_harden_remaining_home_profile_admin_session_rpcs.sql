-- Production provenance for Supabase migration 20260830002126
-- Name: harden_remaining_home_profile_admin_session_rpcs
-- Applied after the frozen v813 product certification.
-- Scope: enforce the already-declared admin_session_token_input contract on three remaining legacy home/profile SECURITY DEFINER diagnostics.
-- No frontend contract, execute ACL, search_path, result shape, or statement timeout changes.

CREATE OR REPLACE FUNCTION public.admin_get_home_profile_runtime_audit_v685(
  admin_session_token_input text DEFAULT NULL::text,
  site_scope_input text DEFAULT 'friends'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._gejast_require_admin_session_v792m(admin_session_token_input);
  RETURN jsonb_build_object(
    'ok', true,
    'version', 'v685',
    'site_scope', public._gejast_v685_scope_norm(site_scope_input),
    'profiles', public.get_profiles_fast_v685(site_scope_input, 20)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_home_profile_runtime_audit_v686(
  admin_session_token_input text DEFAULT NULL::text,
  site_scope_input text DEFAULT 'friends'::text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH _guard AS MATERIALIZED (
    SELECT public._gejast_require_admin_session_v792m(admin_session_token_input) AS admin_state
  )
  SELECT jsonb_build_object(
    'ok', true,
    'version', 'v686',
    'profiles', public.get_profiles_fast_v686(site_scope_input, 40)
  )
  FROM _guard;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_home_profile_runtime_audit_v687(
  admin_session_token_input text DEFAULT NULL::text,
  site_scope_input text DEFAULT 'friends'::text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH _guard AS MATERIALIZED (
    SELECT public._gejast_require_admin_session_v792m(admin_session_token_input) AS admin_state
  )
  SELECT jsonb_build_object(
    'ok', true,
    'version', 'v687',
    'profiles', public.get_profiles_fast_v687(site_scope_input, 50)
  )
  FROM _guard;
$function$;
