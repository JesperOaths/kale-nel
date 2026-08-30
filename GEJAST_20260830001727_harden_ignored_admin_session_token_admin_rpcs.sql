-- Production provenance for Supabase migration 20260830001727
-- Name: harden_ignored_admin_session_token_admin_rpcs
-- Applied after the frozen v813 product certification.
-- Scope: enforce the already-declared admin_session_token contract on six legacy SECURITY DEFINER admin diagnostics.
-- No frontend contract, execute ACL, search_path, result shape, or statement timeout changes.

CREATE OR REPLACE FUNCTION public.admin_get_home_profile_runtime_audit_v682(
  admin_session_token text DEFAULT NULL::text,
  site_scope_input text DEFAULT 'friends'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._gejast_require_admin_session_v792m(admin_session_token);
  RETURN jsonb_build_object('ok',true,'version','v682','home',public.get_homepage_runtime_bundle_v682(NULL, site_scope_input),'generated_at',now());
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_home_profile_runtime_audit_v683(
  admin_session_token text DEFAULT NULL::text,
  site_scope_input text DEFAULT 'friends'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._gejast_require_admin_session_v792m(admin_session_token);
  RETURN jsonb_build_object('ok',true,'version','v683','site_scope',public._gejast_v683_scope_norm(site_scope_input),'note','fast diagnostic only');
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_klaverjassen_alignment_audit_v644(
  admin_session_token text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb;
  v_cache_rows integer := 0;
  v_players integer := 0;
BEGIN
  PERFORM public._gejast_require_admin_session_v792m(admin_session_token);
  SELECT count(*), count(distinct player_name) FILTER (WHERE player_name <> '_system')
    INTO v_cache_rows, v_players
  FROM public.klaverjassen_alignment_cache_v644;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.updated_at DESC, x.player_name, x.metric_key), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT site_scope, player_name, metric_key, metric_value, metric_label, source_key, source_confidence, updated_at
    FROM public.klaverjassen_alignment_cache_v644
    ORDER BY updated_at DESC, player_name, metric_key
    LIMIT 200
  ) x;
  RETURN jsonb_build_object(
    'ok', true,
    'phase', 'v644_phase12_klaverjassen_alignment',
    'cache_rows', v_cache_rows,
    'players', v_players,
    'has_shared_stats_cache', to_regclass('public.shared_stats_cache') IS NOT NULL OR to_regclass('public.gejast_shared_stats_cache') IS NOT NULL,
    'has_ladder_cache', to_regclass('public.klaverjassen_ladder_alignment_cache_v644') IS NOT NULL,
    'rows', v_rows
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_phase_completion_audit_v647(
  admin_session_token text DEFAULT NULL::text,
  requested_version text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb;
  v_missing jsonb;
BEGIN
  PERFORM public._gejast_require_admin_session_v792m(admin_session_token);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'phase_key', r.phase_key,
    'phase', r.phase_label,
    'version', r.version_tag,
    'frontend_packaged', r.frontend_packaged,
    'db_applied', r.db_applied,
    'runtime_verified', r.runtime_verified,
    'needs_runtime_proof', r.needs_runtime_proof,
    'frontend_owner', r.frontend_owner,
    'sql_owner', r.sql_owner,
    'runtime_note', r.runtime_note,
    'notes', r.notes,
    'updated_at', r.updated_at
  ) ORDER BY r.phase_key), '[]'::jsonb)
    INTO v_rows
  FROM public.gejast_phase_completion_registry r;
  SELECT coalesce(jsonb_agg(required_name ORDER BY required_name), '[]'::jsonb)
    INTO v_missing
  FROM (
    VALUES
      ('admin_get_phase_completion_registry_v647'),
      ('admin_get_phase_completion_audit_v647'),
      ('admin_get_phase_runtime_smoke_v647')
  ) AS req(required_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = req.required_name
  );
  RETURN jsonb_build_object(
    'requested_version', requested_version,
    'generated_at', now(),
    'rows', v_rows,
    'missing_v647_rpcs', v_missing,
    'runtime_boundary', 'SQL success and registry visibility do not prove deployed browser/device behavior. Use page tests for runtime verification.'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_phase_completion_registry_v647(
  admin_session_token text DEFAULT NULL::text,
  requested_version text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH _guard AS MATERIALIZED (
    SELECT public._gejast_require_admin_session_v792m(admin_session_token) AS admin_state
  )
  SELECT jsonb_build_object(
    'requested_version', requested_version,
    'generated_at', now(),
    'phases', coalesce(jsonb_agg(jsonb_build_object(
      'phase_key', r.phase_key,
      'phase', r.phase_label,
      'version', r.version_tag,
      'frontend_packaged', r.frontend_packaged,
      'db_applied', r.db_applied,
      'runtime_verified', r.runtime_verified,
      'needs_runtime_proof', r.needs_runtime_proof,
      'frontend_owner', r.frontend_owner,
      'sql_owner', r.sql_owner,
      'runtime_note', r.runtime_note,
      'notes', r.notes,
      'updated_at', r.updated_at
    ) ORDER BY r.phase_key), '[]'::jsonb)
  )
  FROM public.gejast_phase_completion_registry r
  CROSS JOIN _guard;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_phase_runtime_smoke_v647(
  admin_session_token text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH _guard AS MATERIALIZED (
    SELECT public._gejast_require_admin_session_v792m(admin_session_token) AS admin_state
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'registered_phase_count', (SELECT count(*) FROM public.gejast_phase_completion_registry),
    'db_applied_count', (SELECT count(*) FROM public.gejast_phase_completion_registry WHERE db_applied),
    'frontend_packaged_count', (SELECT count(*) FROM public.gejast_phase_completion_registry WHERE frontend_packaged),
    'runtime_verified_count', (SELECT count(*) FROM public.gejast_phase_completion_registry WHERE runtime_verified),
    'needs_runtime_proof_count', (SELECT count(*) FROM public.gejast_phase_completion_registry WHERE needs_runtime_proof AND NOT runtime_verified),
    'phase4_needs_confirmation', EXISTS(SELECT 1 FROM public.gejast_phase_completion_registry WHERE phase_key='phase4' AND runtime_note ILIKE '%not explicitly recorded%'),
    'note', 'Use this as a database-side smoke summary only; it does not test deployed pages.'
  )
  FROM _guard;
$function$;
