-- GEJAST v792i — production schema hygiene
--
-- Safe cleanup after v792 production finalization:
--   * refuse to remove scratch/backup tables if they gained rows after audit
--   * remove only structurally redundant physical indexes, preserving a PK/UNIQUE
--     constraint-backed index where one exists and one canonical copy otherwise
--   * make the targeted web-push admin RPC honor its explicit subscription parameter
--     instead of the stale historical hard-code to subscription 357
--
-- No CASCADE is used anywhere in this migration.

DO $$
DECLARE
  v_rows bigint;
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    '_scratch_pikken_history_work',
    '_scratch_paardenrace_history_work',
    '_beerpong_player_ratings_backup_before_backfill'
  ]
  LOOP
    IF to_regclass('public.' || v_name) IS NOT NULL THEN
      EXECUTE format('select count(*) from public.%I', v_name) INTO v_rows;
      IF v_rows <> 0 THEN
        RAISE EXCEPTION 'Refusing v792i cleanup: %.% contains % row(s)', 'public', v_name, v_rows;
      END IF;
    END IF;
  END LOOP;
END
$$;

DROP TABLE IF EXISTS public._scratch_pikken_history_work;
DROP TABLE IF EXISTS public._scratch_paardenrace_history_work;
DROP TABLE IF EXISTS public._beerpong_player_ratings_backup_before_backfill;

-- Exact duplicate indexes where a constraint-backed copy remains.
DROP INDEX IF EXISTS public.admin_accounts_username_idx;
DROP INDEX IF EXISTS public.admin_users_username_idx;
DROP INDEX IF EXISTS public.beerpong_matches_client_match_id_uidx;
DROP INDEX IF EXISTS public.beerpong_player_ratings_player_name_uidx;
DROP INDEX IF EXISTS public.boerenbridge_matches_client_match_id_uidx;
DROP INDEX IF EXISTS public.boerenbridge_player_ratings_player_name_uidx;
DROP INDEX IF EXISTS public.boerenbridge_player_stats_player_name_uidx;
DROP INDEX IF EXISTS public.drink_type_aliases_alias_key_uidx;
DROP INDEX IF EXISTS public.drink_verified_records_unique_source_idx;
DROP INDEX IF EXISTS public.klaverjas_active_presence_session_match_uidx;
DROP INDEX IF EXISTS public.klaverjas_player_ratings_player_name_uidx;
DROP INDEX IF EXISTS public.pikken_match_archive_v709_game_id_uidx;
DROP INDEX IF EXISTS public.pikken_player_stats_v709_scope_player_uidx;
DROP INDEX IF EXISTS public.idx_pikken_votes_unique_v666;
DROP INDEX IF EXISTS public.players_display_name_uq;
DROP INDEX IF EXISTS public.players_slug_uq;
DROP INDEX IF EXISTS public.web_push_active_presence_player_endpoint_key;
DROP INDEX IF EXISTS public.web_push_active_presence_player_endpoint_uidx;
DROP INDEX IF EXISTS public.web_push_subscriptions_endpoint_uidx;

-- Exact duplicate standalone indexes; retain one canonical physical copy.
DROP INDEX IF EXISTS public.drink_events_status_idx; -- keep idx_drink_events_status_created
DROP INDEX IF EXISTS public.drink_speed_attempts_status_idx; -- keep idx_drink_speed_attempts_status_created
DROP INDEX IF EXISTS public.idx_outbound_email_jobs_v671_status; -- keep outbound_email_jobs_status_created_at_idx
DROP INDEX IF EXISTS public.web_push_action_tokens_player_idx; -- keep web_push_action_tokens_target_idx
DROP INDEX IF EXISTS public.web_push_active_presence_scope_idx;
DROP INDEX IF EXISTS public.web_push_active_presence_scope_seen_idx; -- keep web_push_presence_scope_seen_idx

-- Paardenrace migration-history duplicates; keep newest/current canonical owner.
DROP INDEX IF EXISTS public.idx_pr_players_room_active_v686;
DROP INDEX IF EXISTS public.idx_pr_players_room_v667;
DROP INDEX IF EXISTS public.idx_pr_players_room_v683; -- keep idx_pr_players_room_active_v687
DROP INDEX IF EXISTS public.idx_pr_players_room_player_active_v667; -- keep v685
DROP INDEX IF EXISTS public.idx_pr_rooms_scope_stage_v667;
DROP INDEX IF EXISTS public.idx_pr_rooms_scope_stage_v683;
DROP INDEX IF EXISTS public.idx_pr_rooms_scope_stage_v685;
DROP INDEX IF EXISTS public.idx_pr_rooms_scope_stage_v686; -- keep v687

-- Pikken migration-history duplicates; keep newest/current canonical owner.
DROP INDEX IF EXISTS public.idx_pikken_players_game_active_v685;
DROP INDEX IF EXISTS public.idx_pikken_players_game_active_v686; -- keep v687
DROP INDEX IF EXISTS public.idx_pikken_players_game_player_v666; -- keep v683
DROP INDEX IF EXISTS public.idx_pikken_players_game_seat_v666; -- keep v683
DROP INDEX IF EXISTS public.idx_pikken_games_lobby_code_scope_live_v666; -- keep v683
DROP INDEX IF EXISTS public.idx_pikken_games_scope_status_v666;
DROP INDEX IF EXISTS public.idx_pikken_games_scope_status_v683;
DROP INDEX IF EXISTS public.idx_pikken_games_scope_status_v685;
DROP INDEX IF EXISTS public.idx_pikken_games_scope_status_v686; -- keep v687

CREATE OR REPLACE FUNCTION public.admin_queue_targeted_web_push_test_v763(
  admin_session_token text,
  target_subscription_id_input bigint,
  title_input text DEFAULT 'GEJAST gerichte testmelding'::text,
  body_input text DEFAULT 'Gerichte web-push test voor een expliciet abonnement.'::text,
  target_url_input text DEFAULT './push_beta_test.html?push_test=targeted'::text,
  site_scope_input text DEFAULT 'friends'::text,
  dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_scope text := CASE
    WHEN lower(trim(coalesce(site_scope_input, 'friends'))) IN ('family','familie') THEN 'family'
    ELSE 'friends'
  END;
  v_admin_state jsonb;
  v_sub public.web_push_subscriptions%rowtype;
  v_presence_permission text;
  v_presence_last_seen timestamptz;
  v_presence_age_seconds integer;
  v_presence_state text := 'missing_presence';
  v_subscription_state text := 'missing_subscription';
  v_blocker text := null;
  v_job_id bigint;
  v_open_count integer := 0;
BEGIN
  IF to_regprocedure('public.admin_check_session(text)') IS NULL THEN
    RAISE EXCEPTION 'admin_session_checker_missing';
  END IF;

  v_admin_state := to_jsonb(public.admin_check_session(admin_session_token));
  IF coalesce((v_admin_state->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'admin_session_invalid';
  END IF;

  IF target_subscription_id_input IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'eligible', false,
      'blocker', 'TARGET_SUBSCRIPTION_REQUIRED',
      'queued_count', 0,
      'target_subscription_id', null,
      'site_scope', v_scope
    );
  END IF;

  SELECT * INTO v_sub
    FROM public.web_push_subscriptions
   WHERE id = target_subscription_id_input
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'eligible', false,
      'blocker', 'TARGET_SUBSCRIPTION_NOT_FOUND',
      'queued_count', 0,
      'target_subscription_id', target_subscription_id_input,
      'site_scope', v_scope,
      'subscription_state', v_subscription_state,
      'presence_state', v_presence_state
    );
  END IF;

  v_subscription_state := CASE
    WHEN v_sub.disabled_at IS NOT NULL THEN 'disabled_subscription'
    WHEN coalesce(v_sub.permission_state, '') <> 'granted' THEN 'subscription_not_granted'
    ELSE 'subscription_ok'
  END;

  SELECT p.permission_state, p.last_seen_at
    INTO v_presence_permission, v_presence_last_seen
    FROM public.web_push_active_presence p
   WHERE p.subscription_id = v_sub.id
     AND coalesce(p.site_scope, v_sub.site_scope, v_scope) = v_scope
   ORDER BY p.last_seen_at DESC NULLS LAST
   LIMIT 1;

  IF v_presence_last_seen IS NOT NULL THEN
    v_presence_age_seconds := greatest(0, floor(extract(epoch from (now() - v_presence_last_seen)))::integer);
  END IF;

  v_presence_state := CASE
    WHEN v_presence_last_seen IS NULL THEN 'missing_presence'
    WHEN v_presence_last_seen < now() - interval '2 hours' THEN 'stale_presence'
    WHEN coalesce(v_presence_permission, v_sub.permission_state, '') <> 'granted' THEN 'presence_not_granted'
    ELSE 'presence_ok'
  END;

  SELECT count(*) INTO v_open_count
    FROM public.web_push_jobs
   WHERE target_subscription_id = v_sub.id
     AND trigger_kind = 'admin_targeted_test'
     AND status IN ('queued', 'claimed');

  v_blocker := CASE
    WHEN v_sub.disabled_at IS NOT NULL THEN 'TARGET_SUBSCRIPTION_DISABLED'
    WHEN coalesce(v_sub.site_scope, v_scope) <> v_scope THEN 'TARGET_SCOPE_MISMATCH'
    WHEN coalesce(v_presence_permission, v_sub.permission_state, '') <> 'granted' THEN 'TARGET_SUBSCRIPTION_NOT_GRANTED'
    WHEN v_presence_last_seen IS NULL OR v_presence_last_seen < now() - interval '2 hours' THEN 'TARGET_PRESENCE_NOT_CURRENT'
    WHEN v_open_count > 0 THEN 'ADMIN_TARGETED_TEST_ALREADY_OPEN'
    ELSE null
  END;

  IF v_blocker IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'eligible', false,
      'blocker', v_blocker,
      'queued_count', 0,
      'target_subscription_id', v_sub.id,
      'site_scope', v_scope,
      'subscription_state', v_subscription_state,
      'presence_state', v_presence_state,
      'presence_age_seconds', v_presence_age_seconds,
      'duplicate_open_count', v_open_count
    );
  END IF;

  IF dry_run THEN
    RETURN jsonb_build_object(
      'ok', true,
      'eligible', true,
      'dry_run', true,
      'would_queue', true,
      'queued_count', 0,
      'target_subscription_id', v_sub.id,
      'site_scope', v_scope,
      'subscription_state', v_subscription_state,
      'presence_state', v_presence_state,
      'presence_age_seconds', v_presence_age_seconds,
      'duplicate_open_count', v_open_count
    );
  END IF;

  INSERT INTO public.web_push_jobs(
    status, target_player_id, target_subscription_id, title, body, target_url, payload,
    site_scope, trigger_kind, target_player_name, dedupe_key, notification_tag, require_interaction
  ) VALUES (
    'queued',
    v_sub.player_id,
    v_sub.id,
    nullif(trim(coalesce(title_input, '')), ''),
    nullif(trim(coalesce(body_input, '')), ''),
    nullif(trim(coalesce(target_url_input, '')), ''),
    jsonb_build_object('kind','admin_targeted_test','target_subscription_id',v_sub.id),
    v_scope,
    'admin_targeted_test',
    public._web_push_player_name(v_sub.player_id),
    'admin-targeted-test:' || v_sub.id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
    'admin-targeted-test-' || v_sub.id,
    false
  ) RETURNING id INTO v_job_id;

  RETURN jsonb_build_object(
    'ok', true,
    'eligible', true,
    'dry_run', false,
    'queued_count', 1,
    'job_id', v_job_id,
    'target_subscription_id', v_sub.id,
    'site_scope', v_scope,
    'trigger_kind', 'admin_targeted_test',
    'status', 'queued',
    'subscription_state', v_subscription_state,
    'presence_state', v_presence_state,
    'presence_age_seconds', v_presence_age_seconds,
    'duplicate_open_count', 0
  );
END
$function$;

COMMENT ON FUNCTION public.admin_queue_targeted_web_push_test_v763(text,bigint,text,text,text,text,boolean)
IS 'Admin-only explicit-subscription web-push test queue with scope, permission, presence and duplicate-open guards. v792i removes obsolete subscription-id 357 hard-code.';
