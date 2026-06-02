-- GEJAST v731: live web-push delivery repair.
-- Repairs the live V3 push registration/test wrappers after v730 diagnostics
-- showed browser subscriptions syncing but self-test jobs queueing zero rows.

begin;

drop function if exists public.register_web_push_subscription_v3(text,text,text,text,text,text,text,text);

create or replace function public.register_web_push_subscription_v3(
  session_token_input text default null,
  endpoint_input text default null,
  p256dh_input text default null,
  auth_input text default null,
  user_agent_input text default null,
  permission_input text default null,
  standalone_input boolean default null,
  site_scope_input text default 'friends',
  page_path_input text default null,
  platform_input text default null,
  installation_mode_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_player_id bigint := public._gejast_player_id_from_session(session_token_input);
  v_name text := public._gejast_player_name_from_session(session_token_input);
  v_scope text := case when lower(coalesce(site_scope_input,'friends')) in ('family','familie') then 'family' else 'friends' end;
  v_endpoint text := nullif(trim(coalesce(endpoint_input,'')), '');
  v_row public.web_push_subscriptions%rowtype;
begin
  if v_player_id is null or v_name is null then raise exception 'MISSING_SESSION'; end if;
  if v_endpoint is null then raise exception 'MISSING_ENDPOINT'; end if;

  insert into public.web_push_subscriptions(
    player_id, display_name, endpoint, p256dh_key, auth_key, user_agent, permission_state, platform,
    site_scope, standalone, installation_mode, page_path, created_at, updated_at, last_seen_at,
    last_sync_at, last_success_at, disabled_at, last_error, failure_count
  ) values (
    v_player_id, v_name, v_endpoint, nullif(trim(coalesce(p256dh_input,'')), ''), nullif(trim(coalesce(auth_input,'')), ''),
    nullif(trim(coalesce(user_agent_input,'')), ''), nullif(trim(coalesce(permission_input,'')), ''),
    nullif(trim(coalesce(platform_input,'')), ''), v_scope, standalone_input,
    nullif(trim(coalesce(installation_mode_input,'')), ''), nullif(trim(coalesce(page_path_input,'')), ''),
    now(), now(), now(), now(), now(), null, null, 0
  )
  on conflict (endpoint) do update set
    player_id = excluded.player_id,
    display_name = excluded.display_name,
    p256dh_key = excluded.p256dh_key,
    auth_key = excluded.auth_key,
    user_agent = excluded.user_agent,
    permission_state = excluded.permission_state,
    platform = excluded.platform,
    site_scope = excluded.site_scope,
    standalone = excluded.standalone,
    installation_mode = excluded.installation_mode,
    page_path = excluded.page_path,
    updated_at = now(),
    last_seen_at = now(),
    last_sync_at = now(),
    last_success_at = now(),
    disabled_at = null,
    last_error = null,
    failure_count = 0
  returning * into v_row;

  return jsonb_build_object('ok', true, 'subscription_id', v_row.id, 'player_name', v_name, 'site_scope', v_scope);
end
$fn$;

create or replace function public.queue_test_web_push(
  session_token_input text default null,
  session_token text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_token text := coalesce(nullif(trim(coalesce(session_token_input,'')), ''), nullif(trim(coalesce(session_token,'')), ''));
  v_player_id bigint := public._gejast_player_id_from_session(v_token);
  v_name text := public._gejast_player_name_from_session(v_token);
  v_scope text := case when lower(coalesce(site_scope_input,'friends')) in ('family','familie') then 'family' else 'friends' end;
  v_count integer := 0;
begin
  if v_player_id is null or v_name is null then raise exception 'MISSING_SESSION'; end if;

  insert into public.web_push_jobs(
    status, target_player_id, target_subscription_id, title, body, target_url, payload, site_scope, trigger_kind,
    created_by_player_id, target_player_name, dedupe_key, notification_tag, require_interaction
  )
  select
    'queued', s.player_id, s.id,
    'GEJAST testmelding',
    'Je toestel is gekoppeld en klaar voor web-push.',
    './index.html',
    jsonb_build_object('kind','test','display_name',v_name),
    v_scope, 'self_test',
    v_player_id, v_name,
    'self-test:' || s.id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
    'self-test',
    false
  from public.web_push_subscriptions s
  where s.player_id = v_player_id
    and s.disabled_at is null
    and coalesce(s.site_scope, v_scope) = v_scope;

  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'queued_count', v_count, 'player_name', v_name, 'site_scope', v_scope);
end
$fn$;

grant execute on function public.register_web_push_subscription_v3(text,text,text,text,text,text,boolean,text,text,text,text) to anon, authenticated;
grant execute on function public.queue_test_web_push(text,text,text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
