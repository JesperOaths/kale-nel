-- GEJAST v755i - targeted web-push test guard
-- Scope: SQL-only guard functions for one explicit-subscription push proof.
-- Does not send notifications. Does not change Ice or gameplay data.

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
  v_job_id bigint;
begin
  if to_regprocedure('public.admin_check_session(text)') is null then
    raise exception 'admin_session_checker_missing';
  end if;

  select to_jsonb(public.admin_check_session(admin_session_token)) into v_admin_state;
  if coalesce((v_admin_state->>'ok')::boolean, false) is not true then
    raise exception 'admin_session_invalid';
  end if;

  if target_subscription_id_input is null then
    raise exception 'TARGET_SUBSCRIPTION_REQUIRED';
  end if;

  select * into v_sub
    from public.web_push_subscriptions
   where id = target_subscription_id_input
   for update;

  if not found then
    raise exception 'TARGET_SUBSCRIPTION_NOT_FOUND';
  end if;

  if v_sub.disabled_at is not null then
    raise exception 'TARGET_SUBSCRIPTION_DISABLED';
  end if;

  select p.permission_state, p.last_seen_at
    into v_presence_permission, v_presence_last_seen
    from public.web_push_active_presence p
   where p.subscription_id = v_sub.id
     and coalesce(p.site_scope, v_sub.site_scope, v_scope) = v_scope
   order by p.last_seen_at desc nulls last
   limit 1;

  if coalesce(v_presence_permission, v_sub.permission_state, '') <> 'granted' then
    raise exception 'TARGET_SUBSCRIPTION_NOT_GRANTED';
  end if;

  if v_presence_last_seen is null or v_presence_last_seen < now() - interval '2 hours' then
    raise exception 'TARGET_PRESENCE_NOT_CURRENT';
  end if;

  if coalesce(v_sub.site_scope, v_scope) <> v_scope then
    raise exception 'TARGET_SCOPE_MISMATCH';
  end if;

  if dry_run then
    return jsonb_build_object(
      'ok', true,
      'dry_run', true,
      'would_queue', true,
      'queued_count', 0,
      'target_subscription_id', v_sub.id,
      'site_scope', v_scope,
      'permission_state', coalesce(v_presence_permission, v_sub.permission_state),
      'presence_last_seen_at', v_presence_last_seen,
      'disabled', false
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
    'dry_run', false,
    'queued_count', 1,
    'job_id', v_job_id,
    'target_subscription_id', v_sub.id,
    'site_scope', v_scope
  );
end
$fn$;

create or replace function public.claim_web_push_jobs_targeted_v763(
  target_subscription_id_input bigint,
  max_jobs_input integer default 1,
  worker_id_input text default 'dispatcher',
  claim_token_input uuid default gen_random_uuid()
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_items jsonb := '[]'::jsonb;
begin
  if target_subscription_id_input is null then
    raise exception 'TARGET_SUBSCRIPTION_REQUIRED';
  end if;

  with picked as (
    select j.id
      from public.web_push_jobs j
      join public.web_push_subscriptions s on s.id = j.target_subscription_id
     where j.status = 'queued'
       and j.target_subscription_id = target_subscription_id_input
       and s.disabled_at is null
     order by j.created_at asc, j.id asc
     limit greatest(coalesce(max_jobs_input, 1), 1)
     for update of j skip locked
  ), claimed as (
    update public.web_push_jobs j
       set status = 'claimed',
           claimed_at = now(),
           updated_at = now(),
           claim_token = claim_token_input,
           claimed_by = worker_id_input,
           claim_expires_at = now() + interval '15 minutes',
           attempt_count = coalesce(j.attempt_count, 0) + 1
     where j.id in (select id from picked)
     returning j.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'job_id', c.id,
    'claim_token', claim_token_input,
    'target_subscription_id', c.target_subscription_id,
    'target_player_id', c.target_player_id,
    'title', c.title,
    'body', c.body,
    'target_url', c.target_url,
    'endpoint', s.endpoint,
    'p256dh_key', s.p256dh_key,
    'auth_key', s.auth_key,
    'site_scope', c.site_scope,
    'trigger_kind', c.trigger_kind,
    'request_kind', c.request_kind,
    'request_id', c.request_id,
    'notification_tag', c.notification_tag,
    'require_interaction', c.require_interaction,
    'vibrate_pattern', c.vibrate_pattern,
    'trace_id', c.trace_id
  ) order by c.created_at asc, c.id asc), '[]'::jsonb)
    into v_items
    from claimed c
    join public.web_push_subscriptions s on s.id = c.target_subscription_id;

  insert into public.web_push_job_attempts(job_id, worker_id, claim_token, stage, status)
  select c.id, worker_id_input, claim_token_input, 'claim_targeted_v763', 'ok'
    from public.web_push_jobs c
   where c.claim_token = claim_token_input;

  return jsonb_build_object('ok', true, 'claim_token', claim_token_input, 'target_subscription_id', target_subscription_id_input, 'items', v_items);
end
$fn$;

create or replace function public.mark_web_push_job_sent_v763(
  job_id_input bigint,
  claim_token_input uuid,
  worker_id_input text,
  provider_message_id_input text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_updated integer := 0;
begin
  update public.web_push_jobs
     set status = 'sent',
         sent_at = now(),
         marked_at = now(),
         updated_at = now(),
         error_stage = null,
         error_code = null,
         error_text = null,
         provider_message_id = provider_message_id_input
   where id = job_id_input
     and claim_token = claim_token_input
     and claimed_by = worker_id_input;

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'CLAIM_MISMATCH';
  end if;

  insert into public.web_push_job_attempts(job_id, worker_id, claim_token, stage, status)
  values (job_id_input, worker_id_input, claim_token_input, 'mark_sent_v763', 'ok');

  return jsonb_build_object('ok', true, 'job_id', job_id_input);
end
$fn$;

create or replace function public.mark_web_push_job_failed_v763(
  job_id_input bigint,
  claim_token_input uuid,
  worker_id_input text,
  error_stage_input text,
  error_code_input text,
  error_text_input text,
  disable_subscription_input boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_sub_id bigint;
begin
  update public.web_push_jobs
     set status = 'failed',
         failed_at = now(),
         marked_at = now(),
         updated_at = now(),
         error_stage = left(coalesce(error_stage_input, ''), 80),
         error_code = left(coalesce(error_code_input, ''), 80),
         error_text = left(coalesce(error_text_input, ''), 1000)
   where id = job_id_input
     and claim_token = claim_token_input
     and claimed_by = worker_id_input
   returning target_subscription_id into v_sub_id;

  if v_sub_id is null then
    raise exception 'CLAIM_MISMATCH';
  end if;

  insert into public.web_push_job_attempts(job_id, worker_id, claim_token, stage, status, error_code, error_text)
  values (job_id_input, worker_id_input, claim_token_input, coalesce(error_stage_input, 'send'), 'failed', left(coalesce(error_code_input, ''), 80), left(coalesce(error_text_input, ''), 1000));

  update public.web_push_subscriptions
     set updated_at = now(),
         last_error = left(coalesce(error_text_input, ''), 500),
         failure_count = coalesce(failure_count, 0) + 1,
         disabled_at = case when disable_subscription_input then now() else disabled_at end
   where id = v_sub_id;

  return jsonb_build_object('ok', true, 'job_id', job_id_input, 'disabled_subscription', disable_subscription_input);
end
$fn$;

create or replace function public.requeue_web_push_job_dry_run_v763(
  job_id_input bigint,
  claim_token_input uuid,
  worker_id_input text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_updated integer := 0;
begin
  update public.web_push_jobs
     set status = 'queued',
         updated_at = now(),
         claim_token = null,
         claimed_by = null,
         claim_expires_at = null,
         error_stage = null,
         error_code = null,
         error_text = null
   where id = job_id_input
     and claim_token = claim_token_input
     and claimed_by = worker_id_input;

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'CLAIM_MISMATCH';
  end if;

  insert into public.web_push_job_attempts(job_id, worker_id, claim_token, stage, status)
  values (job_id_input, worker_id_input, claim_token_input, 'dry_run_v763', 'ok');

  return jsonb_build_object('ok', true, 'job_id', job_id_input, 'requeued', true);
end
$fn$;

grant execute on function public.admin_queue_targeted_web_push_test_v763(text, bigint, text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.claim_web_push_jobs_targeted_v763(bigint, integer, text, uuid) to anon, authenticated;
grant execute on function public.mark_web_push_job_sent_v763(bigint, uuid, text, text) to anon, authenticated;
grant execute on function public.mark_web_push_job_failed_v763(bigint, uuid, text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.requeue_web_push_job_dry_run_v763(bigint, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
