-- GEJAST v792m — fail closed proven admin-session guard weaknesses
--
-- Production final certification found legacy SECURITY DEFINER admin surfaces
-- that treated admin_check_session() success as "the function returned" rather
-- than requiring its JSON result to contain {ok:true}. Canonical
-- admin_check_session(text) deliberately returns {ok:false} for invalid tokens,
-- so those legacy patterns were fail-open.
--
-- This migration preserves public/admin RPC signatures and business logic. It
-- centralizes canonical validation, rewires legacy guard helpers, and prepends
-- the strict guard to the explicitly audited top-level admin RPCs that formerly
-- only PERFORMed/SELECTed admin_check_session without checking ok=true.

BEGIN;

CREATE OR REPLACE FUNCTION public._gejast_admin_session_state_v792m(
  admin_session_token_input text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_token text := nullif(btrim(coalesce(admin_session_token_input, '')), '');
  v_state jsonb := '{}'::jsonb;
BEGIN
  IF v_token IS NULL THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  IF to_regprocedure('public.admin_check_session(text)') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'admin_check_session_missing');
  END IF;
  BEGIN
    v_state := to_jsonb(public.admin_check_session(v_token));
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'admin_check_session_failed');
  END;
  IF coalesce((v_state->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN coalesce(v_state, '{}'::jsonb) || jsonb_build_object('ok', false);
  END IF;
  RETURN v_state;
END;
$$;

CREATE OR REPLACE FUNCTION public._gejast_admin_session_ok_v792m(
  admin_session_token_input text
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce((public._gejast_admin_session_state_v792m(admin_session_token_input)->>'ok')::boolean, false) IS TRUE;
$$;

CREATE OR REPLACE FUNCTION public._gejast_require_admin_session_v792m(
  admin_session_token_input text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_state jsonb := public._gejast_admin_session_state_v792m(admin_session_token_input);
BEGIN
  IF coalesce((v_state->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'admin_session_invalid';
  END IF;
  RETURN v_state;
END;
$$;

REVOKE ALL ON FUNCTION public._gejast_admin_session_state_v792m(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._gejast_admin_session_ok_v792m(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._gejast_require_admin_session_v792m(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._gejast_admin_session_state_v792m(text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public._gejast_admin_session_ok_v792m(text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public._gejast_require_admin_session_v792m(text) TO postgres, service_role;

-- Central legacy helpers: same signatures, strict canonical semantics.
CREATE OR REPLACE FUNCTION public._admin_require_session_v356(
  admin_session_token text,
  domain_input text DEFAULT NULL::text,
  action_input text DEFAULT NULL::text,
  payload_input jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN public._gejast_require_admin_session_v792m(admin_session_token);
END;
$$;

CREATE OR REPLACE FUNCTION public._admin_session_valid(
  admin_session_token text
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._gejast_admin_session_ok_v792m(admin_session_token);
$$;

CREATE OR REPLACE FUNCTION public._game_admin_require_session(
  admin_session_token text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN public._gejast_require_admin_session_v792m(admin_session_token);
END;
$$;

CREATE OR REPLACE FUNCTION public._despimarkt_require_admin(
  admin_session_token text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN public._gejast_require_admin_session_v792m(admin_session_token);
END;
$$;

CREATE OR REPLACE FUNCTION public._gejast_v671_is_admin_session(
  admin_session_token_input text DEFAULT NULL::text
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._gejast_admin_session_ok_v792m(admin_session_token_input);
$$;

CREATE OR REPLACE FUNCTION public._gejast_v672_admin_ok(
  admin_session_token_input text
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._gejast_admin_session_ok_v792m(admin_session_token_input);
$$;

CREATE OR REPLACE FUNCTION public._gejast_v676_assert_admin(
  admin_session_token_input text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._gejast_require_admin_session_v792m(admin_session_token_input);
END;
$$;

CREATE OR REPLACE FUNCTION public._implementation_matrix_admin_guard(
  admin_session_token text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN public._gejast_require_admin_session_v792m(admin_session_token);
END;
$$;

CREATE OR REPLACE FUNCTION public._web_push_is_admin_session(
  admin_session_token_input text
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._gejast_admin_session_ok_v792m(admin_session_token_input);
$$;

-- Prefix a strict guard onto audited top-level admin-only surfaces while
-- preserving their exact current bodies, signatures, settings and ACLs.
DO $patch$
DECLARE
  r record;
  v_oid oid;
  v_def text;
  v_new text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.admin_batch_update_drink_event_entries(text,bigint[],text)', 'admin_session_token'),
      ('public.admin_batch_update_drink_speed_attempt_entries(text,bigint[],text)', 'admin_session_token'),
      ('public.admin_forget_device_action(text,text)', 'p_admin_session_token'),
      ('public.admin_get_beerpong_shared_stats_audit_v642(text,text)', 'admin_session_token'),
      ('public.admin_get_make_email_pipeline(text,integer,integer)', 'admin_session_token'),
      ('public.admin_get_web_push_diagnostics_v2(text,integer,text)', 'admin_session_token'),
      ('public.admin_get_web_push_runtime_diagnostics(text,text)', 'admin_session_token'),
      ('public.admin_hide_boerenbridge_match_action(text,bigint,boolean)', 'admin_session_token'),
      ('public.admin_issue_trusted_device_action(text,text,text,text,text)', 'admin_session_token'),
      ('public.admin_queue_active_web_push_v2(text,text,text,text,integer,text)', 'admin_session_token'),
      ('public.admin_refresh_beerpong_shared_stats_v642(text,text)', 'admin_session_token'),
      ('public.admin_remove_site_poll_vote(text,text,text)', 'admin_session_token'),
      ('public.admin_remove_vote_action(text,bigint,text)', 'admin_session_token'),
      ('public.admin_revoke_trusted_device_action(text,bigint)', 'admin_session_token'),
      ('public.admin_set_player_ghost_status(text,bigint,text,boolean,text)', 'admin_session_token'),
      ('public.admin_undo_drinks_action(text,bigint)', 'admin_session_token'),
      ('public.admin_update_drink_event_entry(text,bigint,text,numeric,text)', 'admin_session_token'),
      ('public.admin_update_drink_event_status(text,bigint,text)', 'admin_session_token'),
      ('public.admin_update_drink_speed_attempt_entry(text,bigint,text,numeric,text)', 'admin_session_token'),
      ('public.get_boerenbridge_profile_state(text,text,boolean)', 'admin_session_token'),
      ('public.get_boerenbridge_vault_state(text,boolean)', 'admin_session_token'),
      ('public.get_drinks_admin_audit(text)', 'admin_session_token'),
      ('public.get_drinks_admin_console(text)', 'admin_session_token'),
      ('public.get_drinks_admin_console_light(text,integer)', 'admin_session_token'),
      ('public.admin_get_allowed_usernames(text)', 'admin_session_token'),
      ('public.admin_check_session_with_device(text,text,text,text)', 'admin_session_token'),
      ('public.admin_check_session_with_device(text,text)', 'p_admin_session_token'),
      ('public.admin_get_home_profile_runtime_audit_v670(text,text)', 'admin_session_token'),
      ('public.admin_get_active_player_metadata_audit_v680(text,text)', 'admin_session_token_input'),
      ('public.admin_get_active_player_metadata_audit_v681(text,text)', 'admin_session_token_input')
    ) AS x(signature, token_expr)
  LOOP
    v_oid := to_regprocedure(r.signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'v792m required function missing: %', r.signature;
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
      RAISE EXCEPTION 'v792m could not inject strict guard into %', r.signature;
    END IF;
    EXECUTE v_new;
  END LOOP;
END
$patch$;

-- Mixed player/admin match-control surfaces cannot require admin globally;
-- only their optional admin path is hardened.
DO $match_patch$
DECLARE
  v_oid oid;
  v_def text;
  v_new text;
BEGIN
  FOREACH v_oid IN ARRAY ARRAY[
    to_regprocedure('public.get_match_control_detail_action(text,text,text,text)')::oid,
    to_regprocedure('public.get_match_control_list_action(text,text,text,integer)')::oid
  ]
  LOOP
    IF v_oid IS NULL THEN RAISE EXCEPTION 'v792m match-control function missing'; END IF;
    v_def := pg_get_functiondef(v_oid);
    v_new := replace(
      v_def,
      'v_admin := to_jsonb(public.admin_check_session(admin_session_token));',
      'v_admin := to_jsonb(public.admin_check_session(admin_session_token)); if coalesce((v_admin->>''ok'')::boolean, false) is not true then v_admin := null; end if;'
    );
    IF v_new = v_def THEN
      RAISE EXCEPTION 'v792m could not harden mixed match-control reader oid %', v_oid;
    END IF;
    EXECUTE v_new;
  END LOOP;

  v_oid := to_regprocedure('public.save_match_control_edit(text,text,jsonb,boolean,text,text)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'v792m save_match_control_edit missing'; END IF;
  v_def := pg_get_functiondef(v_oid);
  v_new := replace(v_def,
    'v_is_admin := coalesce((v_admin->>''ok'')::boolean, true);',
    'v_is_admin := coalesce((v_admin->>''ok'')::boolean, false);');
  v_new := replace(v_new,
    'exception when others then\n      v_is_admin := true;',
    'exception when others then\n      v_is_admin := false;');
  v_new := replace(v_new,
    E'exception when others then\r\n      v_is_admin := true;',
    E'exception when others then\r\n      v_is_admin := false;');
  IF v_new = v_def OR v_new LIKE '%v_is_admin := coalesce((v_admin->>''ok'')::boolean, true)%' OR v_new LIKE '%v_is_admin := true;%' THEN
    RAISE EXCEPTION 'v792m could not fully harden save_match_control_edit';
  END IF;
  EXECUTE v_new;
END
$match_patch$;

-- Fail-closed machine postconditions using a guaranteed-invalid token.
DO $verify$
DECLARE
  v_fake text := 'v792m-invalid-admin-session-token';
  v_count integer;
  v_guarded integer;
BEGIN
  IF public._gejast_admin_session_ok_v792m(v_fake) IS TRUE THEN
    RAISE EXCEPTION 'v792m canonical invalid-token boolean guard failed open';
  END IF;
  IF public._admin_session_valid(v_fake) IS TRUE THEN
    RAISE EXCEPTION 'v792m _admin_session_valid failed open';
  END IF;
  IF public._gejast_v671_is_admin_session(v_fake) IS TRUE THEN
    RAISE EXCEPTION 'v792m v671 admin helper failed open';
  END IF;
  IF public._gejast_v672_admin_ok(v_fake) IS TRUE THEN
    RAISE EXCEPTION 'v792m v672 admin helper failed open';
  END IF;
  IF public._web_push_is_admin_session(v_fake) IS TRUE THEN
    RAISE EXCEPTION 'v792m web-push admin helper failed open';
  END IF;

  BEGIN
    PERFORM public._gejast_require_admin_session_v792m(v_fake);
    RAISE EXCEPTION 'v792m strict require helper accepted invalid token';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'v792m strict require helper accepted invalid token' THEN RAISE; END IF;
  END;

  -- Every dynamically patched target must contain the strict guard.
  SELECT count(*) INTO v_guarded
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname = ANY (ARRAY[
      'admin_batch_update_drink_event_entries','admin_batch_update_drink_speed_attempt_entries',
      'admin_forget_device_action','admin_get_beerpong_shared_stats_audit_v642','admin_get_make_email_pipeline',
      'admin_get_web_push_diagnostics_v2','admin_get_web_push_runtime_diagnostics','admin_hide_boerenbridge_match_action',
      'admin_issue_trusted_device_action','admin_queue_active_web_push_v2','admin_refresh_beerpong_shared_stats_v642',
      'admin_remove_site_poll_vote','admin_remove_vote_action','admin_revoke_trusted_device_action','admin_set_player_ghost_status',
      'admin_undo_drinks_action','admin_update_drink_event_entry','admin_update_drink_event_status','admin_update_drink_speed_attempt_entry',
      'get_boerenbridge_profile_state','get_boerenbridge_vault_state','get_drinks_admin_audit','get_drinks_admin_console',
      'get_drinks_admin_console_light','admin_get_allowed_usernames','admin_check_session_with_device',
      'admin_get_home_profile_runtime_audit_v670','admin_get_active_player_metadata_audit_v680','admin_get_active_player_metadata_audit_v681'
    ])
    AND p.prosrc LIKE '%_gejast_require_admin_session_v792m(%';
  IF v_guarded < 30 THEN
    RAISE EXCEPTION 'v792m strict-guard coverage too low: %', v_guarded;
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN ('_gejast_v671_is_admin_session','_gejast_v672_admin_ok')
    AND (p.prosrc ILIKE '%return length(%' OR p.prosrc ILIKE '%v_ok := true%');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'v792m legacy boolean helpers still contain fail-open fallbacks';
  END IF;

  IF (SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='save_match_control_edit' LIMIT 1)
     ILIKE '%v_is_admin := true%' THEN
    RAISE EXCEPTION 'v792m save_match_control_edit still contains fail-open admin exception path';
  END IF;
END
$verify$;

COMMIT;
