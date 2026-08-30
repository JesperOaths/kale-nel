-- Production provenance for Supabase migration 20260830100535
-- Name: harden_presence_only_admin_diagnostics
-- Applied after the frozen v813 product certification.
-- Scope: enforce the canonical admin-session validator on seven SECURITY DEFINER diagnostics that previously accepted token presence/non-emptiness without validating the session.
-- No frontend contract, execute ACL, successful result shape, or statement timeout changes.

CREATE OR REPLACE FUNCTION public.admin_get_boot_bundle_perf_audit_v656(admin_session_token text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_tables text[] := array['allowed_usernames','player_sessions','admin_sessions','drink_events','web_push_subscriptions','web_push_jobs'];
  v_rows jsonb;
BEGIN
  PERFORM public._gejast_require_admin_session_v792m(admin_session_token);
  SELECT coalesce(jsonb_agg(jsonb_build_object('relation', r, 'exists', public._gejast_v656_relation_exists(r)) ORDER BY r), '[]'::jsonb)
    INTO v_rows FROM unnest(v_tables) AS r;
  RETURN jsonb_build_object('ok', true, 'target_version', 'v656', 'admin_session_token_present', coalesce(admin_session_token,'') <> '', 'relations', v_rows, 'note', 'Catalog presence only. Browser performance is measured by gejast-perf-guards.js.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_deployment_verification_audit_v650(admin_session_token text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_token text := nullif(btrim(coalesce(admin_session_token,'')), '');
  v_checks jsonb;
BEGIN
  PERFORM public._gejast_require_admin_session_v792m(admin_session_token);
  IF v_token IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_admin_session_token', 'checks', '[]'::jsonb);
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'check_key', check_key,
    'check_group', check_group,
    'status', status,
    'detail', detail,
    'expected_version', expected_version,
    'last_checked_at', last_checked_at
  ) ORDER BY check_group, check_key), '[]'::jsonb)
  INTO v_checks
  FROM public.gejast_deployment_verification_checks;
  RETURN jsonb_build_object('ok', true, 'version', 'v650', 'checks', v_checks, 'generated_at', now());
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_ops_observability_audit_v656(admin_session_token text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_relations text[] := array['runtime_errors','ops_smoke_checks','release_breadcrumbs','web_push_jobs','outbound_email_jobs'];
  v_rows jsonb;
BEGIN
  PERFORM public._gejast_require_admin_session_v792m(admin_session_token);
  SELECT coalesce(jsonb_agg(jsonb_build_object('relation', r, 'exists', public._gejast_v656_relation_exists(r)) ORDER BY r), '[]'::jsonb)
    INTO v_rows FROM unnest(v_relations) AS r;
  RETURN jsonb_build_object('ok', true, 'target_version', 'v656', 'admin_session_token_present', coalesce(admin_session_token,'') <> '', 'observability_relations', v_rows, 'note', 'Catalog presence only. v656 frontend captures browser-page errors locally; sitewide telemetry is not claimed.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_player_selector_audit_v656(admin_session_token text DEFAULT NULL::text, site_scope_input text DEFAULT 'friends'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_rpcs text[] := array['get_player_selector_source_v1','admin_get_player_selector_audit_v1','get_all_site_players_public_scoped','get_profiles_page_bundle_scoped','get_login_names_scoped','get_login_names'];
  v_rows jsonb;
BEGIN
  PERFORM public._gejast_require_admin_session_v792m(admin_session_token);
  SELECT coalesce(jsonb_agg(jsonb_build_object('rpc', f, 'exists', public._gejast_v656_catalog_function_exists(f)) ORDER BY f), '[]'::jsonb)
    INTO v_rows FROM unnest(v_rpcs) AS f;
  RETURN jsonb_build_object('ok', true, 'target_version', 'v656', 'site_scope', coalesce(site_scope_input,'friends'), 'admin_session_token_present', coalesce(admin_session_token,'') <> '', 'selector_rpcs', v_rows, 'note', 'Catalog presence only. Dropdown contents/speed require live browser testing.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_profile_badge_restore_audit_v656(admin_session_token text DEFAULT NULL::text, site_scope_input text DEFAULT 'friends'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_tables text[] := array['profile_badges','badges','profiles','allowed_usernames'];
  v_rows jsonb;
BEGIN
  PERFORM public._gejast_require_admin_session_v792m(admin_session_token);
  SELECT coalesce(jsonb_agg(jsonb_build_object('relation', r, 'exists', public._gejast_v656_relation_exists(r)) ORDER BY r), '[]'::jsonb)
    INTO v_rows FROM unnest(v_tables) AS r;
  RETURN jsonb_build_object('ok', true, 'target_version', 'v656', 'site_scope', coalesce(site_scope_input,'friends'), 'admin_session_token_present', coalesce(admin_session_token,'') <> '', 'badge_relations', v_rows, 'note', 'Catalog presence only. It does not backfill or alter badges.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_profiles_bundle_alignment_v656(admin_session_token text DEFAULT NULL::text, site_scope_input text DEFAULT 'friends'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_rpcs text[] := array['get_profiles_page_bundle_scoped','get_player_profiles_public_scoped','get_drink_player_public','get_my_profile_settings'];
  v_tables text[] := array['profiles','allowed_usernames','drink_events','profile_badges','badges'];
  v_rpc_rows jsonb;
  v_table_rows jsonb;
BEGIN
  PERFORM public._gejast_require_admin_session_v792m(admin_session_token);
  SELECT coalesce(jsonb_agg(jsonb_build_object('rpc', f, 'exists', public._gejast_v656_catalog_function_exists(f)) ORDER BY f), '[]'::jsonb)
    INTO v_rpc_rows FROM unnest(v_rpcs) AS f;
  SELECT coalesce(jsonb_agg(jsonb_build_object('relation', r, 'exists', public._gejast_v656_relation_exists(r)) ORDER BY r), '[]'::jsonb)
    INTO v_table_rows FROM unnest(v_tables) AS r;
  RETURN jsonb_build_object('ok', true, 'target_version', 'v656', 'site_scope', coalesce(site_scope_input,'friends'), 'admin_session_token_present', coalesce(admin_session_token,'') <> '', 'profile_rpcs', v_rpc_rows, 'profile_relations', v_table_rows, 'note', 'Catalog presence only. Avatar/badge rendering requires page-level browser proof.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_version_alignment_audit_v656(admin_session_token text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_functions text[] := array['admin_get_version_alignment_audit_v656','admin_audit_gate_coverage_v656','admin_get_boot_bundle_perf_audit_v656','admin_get_player_selector_audit_v656','admin_refresh_player_selector_audit_cache_v656','admin_get_profiles_bundle_alignment_v656','admin_get_profile_badge_restore_audit_v656','admin_get_ops_observability_audit_v656'];
  v_rows jsonb;
BEGIN
  PERFORM public._gejast_require_admin_session_v792m(admin_session_token);
  SELECT coalesce(jsonb_agg(jsonb_build_object('function', f, 'exists', public._gejast_v656_catalog_function_exists(f)) ORDER BY f), '[]'::jsonb)
    INTO v_rows FROM unnest(v_functions) AS f;
  RETURN jsonb_build_object('ok', true, 'target_version', 'v656', 'scope', 'catalog-only diagnostic', 'admin_session_token_present', coalesce(admin_session_token,'') <> '', 'functions', v_rows, 'note', 'This verifies v656 diagnostic SQL functions exist. Browser/static version checks are performed by admin_system_health.html.');
END;
$function$;
