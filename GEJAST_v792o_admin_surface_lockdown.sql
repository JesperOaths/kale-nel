-- GEJAST v792o — lock remaining legacy admin surfaces found by final certification
--
-- v792m repaired the broadest fail-open patterns. A second catalog pass then
-- found several older admin helpers that still accepted any non-empty token,
-- one trusted-device action that trusted a caller-supplied admin name even when
-- admin_check_session returned {ok:false}, and maintenance/bootstrap functions
-- with no possible admin-session argument that were still executable by browser
-- roles. This migration closes those remaining proven gaps without changing any
-- public gameplay contract.

BEGIN;

-- v792m's first state helper used admin_check_session(), whose near-expiry token
-- rotation is useful to the UI but inappropriate inside a pure authorization
-- predicate because downstream legacy functions may validate the old token a
-- second time. Use the non-rotating canonical DB validator instead.
CREATE OR REPLACE FUNCTION public._gejast_admin_session_state_v792m(
  admin_session_token_input text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_token text := nullif(btrim(coalesce(admin_session_token_input, '')), '');
  v_row record;
BEGIN
  IF v_token IS NULL OR to_regprocedure('public._require_valid_admin_session(text)') IS NULL THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  BEGIN
    SELECT * INTO v_row FROM public._require_valid_admin_session(v_token);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'admin_session_validation_failed');
  END;
  IF NOT FOUND OR coalesce(v_row.ok, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'admin_id', v_row.admin_id,
    'username', v_row.username,
    'expires_at', v_row.expires_at
  );
END;
$$;

-- Replace legacy token-presence / undefined-column fallbacks with the canonical
-- non-rotating predicate.
CREATE OR REPLACE FUNCTION public._gejast_admin_session_required(admin_session_token text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._gejast_require_admin_session_v792m(admin_session_token);
END;
$$;

CREATE OR REPLACE FUNCTION public._gejast_admin_session_valid_v648(admin_session_token text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._gejast_admin_session_ok_v792m(admin_session_token);
$$;

CREATE OR REPLACE FUNCTION public._gga_v668_is_admin_session(admin_session_token_input text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._gejast_admin_session_ok_v792m(admin_session_token_input);
$$;

CREATE OR REPLACE FUNCTION public._klaverjas_v673_assert_admin(admin_session_token_input text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._gejast_require_admin_session_v792m(admin_session_token_input);
END;
$$;

-- Harden named legacy admin functions whose current bodies either ignore the
-- supplied token or merely check that some text was supplied. The original body
-- remains intact after one strict entry guard.
DO $guard_patch$
DECLARE
  r record;
  v_oid oid;
  v_def text;
  v_new text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.admin_trust_device_action(text,text,text,jsonb,text)', 'p_admin_session_token'),
      ('public.admin_refresh_boerenbridge_shared_stats_v643(text)', 'admin_session_token'),
      ('public.admin_refresh_klaverjassen_alignment_v644(text,text)', 'admin_session_token'),
      ('public.admin_install_despimarkt_auto_market_triggers_v646(text)', 'admin_session_token'),
      ('public.admin_mark_deployment_verification_check_v650(text,text,text,text)', 'admin_session_token'),
      ('public.admin_record_deployment_rollback_checkpoint_v650(text,text,jsonb)', 'admin_session_token'),
      ('public.admin_audit_gate_coverage_v656(text)', 'admin_session_token')
    ) AS x(signature, token_expr)
  LOOP
    v_oid := to_regprocedure(r.signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'v792o required admin function missing: %', r.signature;
    END IF;
    v_def := pg_get_functiondef(v_oid);
    IF position('_gejast_require_admin_session_v792m(' IN v_def) > 0 THEN
      CONTINUE;
    END IF;
    v_new := regexp_replace(
      v_def,
      E'\\nbegin\\r?\\n',
      E'\nbegin\n  PERFORM public._gejast_require_admin_session_v792m(' || r.token_expr || E');\n',
      'i'
    );
    IF v_new = v_def THEN
      RAISE EXCEPTION 'v792o could not inject strict guard into %', r.signature;
    END IF;
    EXECUTE v_new;
  END LOOP;
END
$guard_patch$;

-- v649 referenced a helper that no longer exists. Restore the intended behavior
-- with the canonical validator rather than a token-presence check.
DO $upload_patch$
DECLARE
  v_oid oid := to_regprocedure('public.admin_get_upload_checklist_v649(text)');
  v_def text;
  v_new text;
BEGIN
  IF v_oid IS NULL THEN RAISE EXCEPTION 'v792o admin_get_upload_checklist_v649 missing'; END IF;
  v_def := pg_get_functiondef(v_oid);
  v_new := replace(
    v_def,
    'if not public._gejast_admin_token_present(admin_session_token) then raise exception ''Admin session required''; end if;',
    'if not public._gejast_admin_session_ok_v792m(admin_session_token) then raise exception ''Admin session required''; end if;'
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'v792o could not repair v649 upload checklist guard'; END IF;
  EXECUTE v_new;
END
$upload_patch$;

-- These legacy/bootstrap/cleanup routines have no usable inner-admin credential
-- boundary (or deliberately allow NULL for trusted internal recomputation). They
-- must therefore not be directly callable through PostgREST browser roles.
DO $revoke_legacy$
DECLARE
  v_sig text;
  v_oid oid;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.admin_create_or_replace_account(text,text,text)',
    'public.admin_close_paardenrace_room_v667(text,text,text,text)',
    'public.admin_delete_dummy_klaverjas_cluster_matches()',
    'public.admin_prelaunch_wipe_klaverjas_only()',
    'public.admin_purge_legacy_dummy_klaverjas_rows()',
    'public.admin_seed_drinks_dummy_data()',
    'public.admin_soft_delete_dummy_klaverjas_history_rows()',
    'public.admin_soft_delete_dummy_klaverjas_matches()',
    'public.admin_soft_delete_remaining_dummy_klaverjas_history()',
    'public.admin_rebuild_klaverjas_ratings_v673(text,text)',
    'public.admin_trust_device(text,text,text)'
  ]
  LOOP
    v_oid := to_regprocedure(v_sig);
    IF v_oid IS NULL THEN RAISE EXCEPTION 'v792o legacy routine missing: %', v_sig; END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO postgres, service_role', v_sig);
  END LOOP;
END
$revoke_legacy$;

-- The account/bootstrap helper and no-token maintenance routines are service
-- maintenance APIs now; the normal admin browser continues through guarded
-- token-bearing actions.

DO $verify$
DECLARE
  v_fake text := 'v792o-invalid-admin-session-token';
  v_sig text;
  v_oid oid;
  v_src text;
BEGIN
  IF public._gejast_admin_session_ok_v792m(v_fake)
     OR public._gejast_admin_session_valid_v648(v_fake)
     OR public._gga_v668_is_admin_session(v_fake) THEN
    RAISE EXCEPTION 'v792o boolean admin helper failed open';
  END IF;

  BEGIN
    PERFORM public._gejast_admin_session_required(v_fake);
    RAISE EXCEPTION 'v792o _gejast_admin_session_required accepted fake token';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='v792o _gejast_admin_session_required accepted fake token' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public._klaverjas_v673_assert_admin(v_fake);
    RAISE EXCEPTION 'v792o klaverjas admin helper accepted fake token';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='v792o klaverjas admin helper accepted fake token' THEN RAISE; END IF;
  END;

  FOREACH v_sig IN ARRAY ARRAY[
    'public.admin_trust_device_action(text,text,text,jsonb,text)',
    'public.admin_refresh_boerenbridge_shared_stats_v643(text)',
    'public.admin_refresh_klaverjassen_alignment_v644(text,text)',
    'public.admin_install_despimarkt_auto_market_triggers_v646(text)',
    'public.admin_mark_deployment_verification_check_v650(text,text,text,text)',
    'public.admin_record_deployment_rollback_checkpoint_v650(text,text,jsonb)',
    'public.admin_audit_gate_coverage_v656(text)'
  ]
  LOOP
    v_oid := to_regprocedure(v_sig);
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid=v_oid;
    IF v_src NOT LIKE '%_gejast_require_admin_session_v792m(%' THEN
      RAISE EXCEPTION 'v792o strict guard missing from %', v_sig;
    END IF;
  END LOOP;

  SELECT p.prosrc INTO v_src
  FROM pg_proc p
  WHERE p.oid=to_regprocedure('public.admin_get_upload_checklist_v649(text)');
  IF v_src NOT LIKE '%_gejast_admin_session_ok_v792m(%'
     OR v_src LIKE '%_gejast_admin_token_present(%' THEN
    RAISE EXCEPTION 'v792o v649 upload guard is not canonical';
  END IF;

  FOREACH v_sig IN ARRAY ARRAY[
    'public.admin_create_or_replace_account(text,text,text)',
    'public.admin_close_paardenrace_room_v667(text,text,text,text)',
    'public.admin_delete_dummy_klaverjas_cluster_matches()',
    'public.admin_prelaunch_wipe_klaverjas_only()',
    'public.admin_purge_legacy_dummy_klaverjas_rows()',
    'public.admin_seed_drinks_dummy_data()',
    'public.admin_soft_delete_dummy_klaverjas_history_rows()',
    'public.admin_soft_delete_dummy_klaverjas_matches()',
    'public.admin_soft_delete_remaining_dummy_klaverjas_history()',
    'public.admin_rebuild_klaverjas_ratings_v673(text,text)',
    'public.admin_trust_device(text,text,text)'
  ]
  LOOP
    v_oid := to_regprocedure(v_sig);
    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'v792o browser role still executes service-only routine %', v_sig;
    END IF;
  END LOOP;
END
$verify$;

COMMIT;
