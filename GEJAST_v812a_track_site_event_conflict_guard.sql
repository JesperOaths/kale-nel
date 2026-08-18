-- GEJAST v812a — track_site_event PL/pgSQL conflict-target guard
-- Narrow SQL-only repair: preserve the deployed 21-argument analytics contract,
-- but bind UPSERT conflict targets to named primary-key constraints so PL/pgSQL
-- parameters visitor_id/session_id cannot collide with table-column names.

begin;

create or replace function public.track_site_event(
  event_name text default 'page_view'::text,
  event_category text default null::text,
  event_label text default null::text,
  page_path text default null::text,
  page_url text default null::text,
  page_title text default null::text,
  referrer_url text default null::text,
  visitor_id text default null::text,
  session_id text default null::text,
  device_type text default null::text,
  browser_name text default null::text,
  os_name text default null::text,
  viewport_width integer default null::integer,
  viewport_height integer default null::integer,
  language_code text default null::text,
  time_zone text default null::text,
  user_agent text default null::text,
  is_logged_in boolean default false,
  player_name text default null::text,
  is_admin boolean default false,
  extra jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_page_path text := nullif(trim(coalesce(track_site_event.page_path, '')), '');
  v_page_url text := nullif(trim(coalesce(track_site_event.page_url, '')), '');
  v_visitor_id text := nullif(trim(coalesce(track_site_event.visitor_id, '')), '');
  v_session_id text := nullif(trim(coalesce(track_site_event.session_id, '')), '');
  v_event_name text := nullif(trim(coalesce(track_site_event.event_name, '')), '');
  v_event_category text := nullif(trim(coalesce(track_site_event.event_category, '')), '');
  v_event_label text := nullif(trim(coalesce(track_site_event.event_label, '')), '');
  v_player_name text := nullif(trim(coalesce(track_site_event.player_name, '')), '');
  v_is_logged_in boolean := coalesce(track_site_event.is_logged_in, false);
  v_is_admin boolean := coalesce(track_site_event.is_admin, false);
  v_visitor_exists boolean := false;
  v_session_exists boolean := false;
  v_is_new_visitor boolean := false;
  v_is_new_session boolean := false;
  v_is_returning_visitor boolean := false;
  v_pageview_increment integer := 0;
begin
  if v_page_path is null then raise exception 'page_path ontbreekt'; end if;
  if v_visitor_id is null then raise exception 'visitor_id ontbreekt'; end if;
  if v_session_id is null then raise exception 'session_id ontbreekt'; end if;
  if v_event_name is null then v_event_name := 'page_view'; end if;
  if v_event_category is null then
    v_event_category := case when v_event_name = 'page_view' then 'navigatie' else 'algemeen' end;
  end if;
  if v_event_name = 'page_view' then v_pageview_increment := 1; end if;

  select exists(select 1 from public.site_visitors v where v.visitor_id = v_visitor_id) into v_visitor_exists;
  select exists(select 1 from public.site_visit_sessions s where s.session_id = v_session_id) into v_session_exists;

  v_is_new_visitor := not v_visitor_exists;
  v_is_new_session := not v_session_exists;
  v_is_returning_visitor := v_visitor_exists and v_is_new_session;

  insert into public.site_visitors (
    visitor_id, first_seen_at, last_seen_at, first_page_path, last_page_path,
    visit_count, total_sessions, total_events, last_device_type, last_browser_name,
    last_os_name, last_referrer_url, player_name, is_known_player, is_admin, extra
  ) values (
    v_visitor_id, now(), now(), v_page_path, v_page_path,
    1, 1, 1,
    nullif(trim(coalesce(track_site_event.device_type, '')), ''),
    nullif(trim(coalesce(track_site_event.browser_name, '')), ''),
    nullif(trim(coalesce(track_site_event.os_name, '')), ''),
    nullif(trim(coalesce(track_site_event.referrer_url, '')), ''),
    v_player_name, v_is_logged_in, v_is_admin, coalesce(track_site_event.extra, '{}'::jsonb)
  )
  on conflict on constraint site_visitors_pkey
  do update set
    last_seen_at = now(),
    last_page_path = excluded.last_page_path,
    visit_count = public.site_visitors.visit_count + case when v_is_new_session then 1 else 0 end,
    total_sessions = public.site_visitors.total_sessions + case when v_is_new_session then 1 else 0 end,
    total_events = public.site_visitors.total_events + 1,
    last_device_type = coalesce(excluded.last_device_type, public.site_visitors.last_device_type),
    last_browser_name = coalesce(excluded.last_browser_name, public.site_visitors.last_browser_name),
    last_os_name = coalesce(excluded.last_os_name, public.site_visitors.last_os_name),
    last_referrer_url = coalesce(excluded.last_referrer_url, public.site_visitors.last_referrer_url),
    player_name = coalesce(excluded.player_name, public.site_visitors.player_name),
    is_known_player = public.site_visitors.is_known_player or excluded.is_known_player,
    is_admin = public.site_visitors.is_admin or excluded.is_admin,
    extra = coalesce(excluded.extra, public.site_visitors.extra);

  insert into public.site_visit_sessions (
    session_id, visitor_id, started_at, last_seen_at, entry_page_path, exit_page_path,
    referrer_url, device_type, browser_name, os_name, player_name, is_logged_in,
    is_admin, pageviews, event_count, extra
  ) values (
    v_session_id, v_visitor_id, now(), now(), v_page_path, v_page_path,
    nullif(trim(coalesce(track_site_event.referrer_url, '')), ''),
    nullif(trim(coalesce(track_site_event.device_type, '')), ''),
    nullif(trim(coalesce(track_site_event.browser_name, '')), ''),
    nullif(trim(coalesce(track_site_event.os_name, '')), ''),
    v_player_name, v_is_logged_in, v_is_admin, v_pageview_increment, 1,
    coalesce(track_site_event.extra, '{}'::jsonb)
  )
  on conflict on constraint site_visit_sessions_pkey
  do update set
    last_seen_at = now(),
    exit_page_path = excluded.exit_page_path,
    referrer_url = coalesce(public.site_visit_sessions.referrer_url, excluded.referrer_url),
    device_type = coalesce(excluded.device_type, public.site_visit_sessions.device_type),
    browser_name = coalesce(excluded.browser_name, public.site_visit_sessions.browser_name),
    os_name = coalesce(excluded.os_name, public.site_visit_sessions.os_name),
    player_name = coalesce(excluded.player_name, public.site_visit_sessions.player_name),
    is_logged_in = public.site_visit_sessions.is_logged_in or excluded.is_logged_in,
    is_admin = public.site_visit_sessions.is_admin or excluded.is_admin,
    pageviews = public.site_visit_sessions.pageviews + v_pageview_increment,
    event_count = public.site_visit_sessions.event_count + 1,
    extra = coalesce(excluded.extra, public.site_visit_sessions.extra);

  insert into public.site_visitor_events (
    event_name, event_category, event_label, page_path, page_url, page_title,
    referrer_url, visitor_id, session_id, device_type, browser_name, os_name,
    viewport_width, viewport_height, language_code, time_zone, user_agent,
    is_logged_in, player_name, is_admin, is_new_visitor, is_returning_visitor,
    is_new_session, extra
  ) values (
    v_event_name, v_event_category, v_event_label, v_page_path, v_page_url,
    nullif(trim(coalesce(track_site_event.page_title, '')), ''),
    nullif(trim(coalesce(track_site_event.referrer_url, '')), ''),
    v_visitor_id, v_session_id,
    nullif(trim(coalesce(track_site_event.device_type, '')), ''),
    nullif(trim(coalesce(track_site_event.browser_name, '')), ''),
    nullif(trim(coalesce(track_site_event.os_name, '')), ''),
    track_site_event.viewport_width, track_site_event.viewport_height,
    nullif(trim(coalesce(track_site_event.language_code, '')), ''),
    nullif(trim(coalesce(track_site_event.time_zone, '')), ''),
    nullif(trim(coalesce(track_site_event.user_agent, '')), ''),
    v_is_logged_in, v_player_name, v_is_admin,
    v_is_new_visitor, v_is_returning_visitor, v_is_new_session,
    coalesce(track_site_event.extra, '{}'::jsonb)
  );

  return jsonb_build_object(
    'ok', true,
    'is_new_visitor', v_is_new_visitor,
    'is_returning_visitor', v_is_returning_visitor,
    'is_new_session', v_is_new_session
  );
end;
$function$;

comment on function public.track_site_event(text,text,text,text,text,text,text,text,text,text,text,text,integer,integer,text,text,text,boolean,text,boolean,jsonb)
  is 'v812a: binds visitor/session UPSERTs to named PK constraints, eliminating PL/pgSQL input-column ambiguity without changing the public analytics contract.';

commit;
