-- GEJAST v755k - targeted web-push readiness gate
-- Scope: SQL-only refinement for the v763 one-device targeted push proof.
-- Does not send notifications. Does not change Ice, gameplay, public frontend version, or Worker code.

begin;

create or replace function public.admin_queue_targeted_web_push_test_v763(
  admin_session_token text,
  target_subscription_id_input bigint,
  title_input text default 'GEJAST gerichte testmelding',
  body_input text default 'Gerichte web-push test voor een expliciet abonnement.',
  target_url_input text default './push_beta_test.html?push_test=targeted',
  site_scope_input text default 'friends',
  dry_run boolean default true
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := case when lower(trim(coalesce(site_scope_input, 'friends'))) in ('family','familie') then 'family' else 'friends' end;
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
begin
  if to_regprocedure('public.admin_check_session(text)') is null then
    raise exception 'admin_session_checker_missing';
  end if;

  v_admin_state := to_jsonb(public.admin_check_session(admin_session_token));
  if coalesce((v_admin_state->>'ok')::boolean, false) is not true then
    raise exception 'admin_session_invalid';
  end if;

  if target_subscription_id_input is null or target_subscription_id_input <> 357 then
    return jsonb_build_object('ok', false, 'eligible', false, 'blocker', 'TARGET_SUBSCRIPTION_NOT_ALLOWED', 'queued_count', 0, 'target_subscription_id', target_subscription_id_input, 'site_scope', v_scope);
  end if;

  select * into v_sub
    from public.web_push_subscriptions
   where id = target_subscription_id_input
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'eligible', false, 'blocker', 'TARGET_SUBSCRIPTION_NOT_FOUND', 'queued_count', 0, 'target_subscription_id', target_subscription_id_input, 'site_scope', v_scope, 'subscription_state', v_subscription_state, 'presence_state', v_presence_state);
  end if;

  v_subscription_state := case when v_sub.disabled_at is not null then 'disabled_subscription' when coalesce(v_sub.permission_state, '') <> 'granted' then 'subscription_not_granted' else 'subscription_ok' end;

  select p.permission_state, p.last_seen_at
    into v_presence_permission, v_presence_last_seen
    from public.web_push_active_presence p
   where p.subscription_id = v_sub.id
     and coalesce(p.site_scope, v_sub.site_scope, v_scope) = v_scope
   order by p.last_seen_at desc nulls last
   limit 1;

  if v_presence_last_seen is not null then
    v_presence_age_seconds := greatest(0, floor(extract(epoch from (now() - v_presence_last_seen)))::integer);
  end if;

  v_presence_state := case
    when v_presence_last_seen is null then 'missing_presence'
    when v_presence_last_seen < now() - interval '2 hours' then 'stale_presence'
    when coalesce(v_presence_permission, v_sub.permission_state, '') <> 'granted' then 'presence_not_granted'
    else 'presence_ok'
  end;

  select count(*) into v_open_count
    from public.web_push_jobs
   where target_subscription_id = v_sub.id
     and trigger_kind = 'admin_targeted_test'
     and status in ('queued', 'claimed');

  v_blocker := case
    when v_sub.disabled_at is not null then 'TARGET_SUBSCRIPTION_DISABLED'
    when coalesce(v_sub.site_scope, v_scope) <> v_scope then 'TARGET_SCOPE_MISMATCH'
    when coalesce(v_presence_permission, v_sub.permission_state, '') <> 'granted' then 'TARGET_SUBSCRIPTION_NOT_GRANTED'
    when v_presence_last_seen is null or v_presence_last_seen < now() - interval '2 hours' then 'TARGET_PRESENCE_NOT_CURRENT'
    when v_open_count > 0 then 'ADMIN_TARGETED_TEST_ALREADY_OPEN'
    else null
  end;

  if v_blocker is not null then
    return jsonb_build_object(
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
  end if;

  if dry_run then
    return jsonb_build_object(
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
  end if;

  insert into public.web_push_jobs(
    status, target_player_id, target_subscription_id, title, body, target_url, payload,
    site_scope, trigger_kind, target_player_name, dedupe_key, notification_tag, require_interaction
  ) values (
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
  ) returning id into v_job_id;

  return jsonb_build_object(
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
end
$fn$;

revoke all on function public.admin_queue_targeted_web_push_test_v763(text, bigint, text, text, text, text, boolean) from public;
grant execute on function public.admin_queue_targeted_web_push_test_v763(text, bigint, text, text, text, text, boolean) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
