-- GEJAST v730: live Paardenrace/drinks/push RPC compatibility repair.
-- Run in Supabase SQL editor after v729 if live probes show PostgREST overloads.

begin;

-- Remove the one-argument Paardenrace stats overload so the current two-argument
-- function with default limit_input is the single PostgREST candidate.
drop function if exists public.get_paardenrace_stats_fast_v687(text);

-- Remove older fallback create_drink_event signatures that make the browser's
-- JSON quantity ambiguous against the real numeric implementation.
drop function if exists public.create_drink_event(text, text, integer, double precision, double precision, double precision);

-- Remove token-shaped nearby-push v3 wrappers. The current frontend and v714
-- contract use request_kind/request_id/scope/cooldown.
drop function if exists public.queue_nearby_verification_pushes_v3(text, text, bigint, text);
drop function if exists public.queue_nearby_verification_pushes_v3(text, text, bigint, text, integer);

create or replace function public.get_drinks_pending_verification_summary_v661(
  limit_input integer default 50,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
begin
  if to_regprocedure('public.get_drinks_pending_verification_summary_v660(integer,text)') is not null then
    return public.get_drinks_pending_verification_summary_v660(limit_input, site_scope_input);
  end if;
  return jsonb_build_object(
    'ok', true,
    'source', 'v730_empty_pending_compat',
    'site_scope', case when lower(coalesce(site_scope_input, 'friends')) in ('family','familie') then 'family' else 'friends' end,
    'limit', greatest(1, least(coalesce(limit_input, 50), 200)),
    'items', '[]'::jsonb,
    'pending', '[]'::jsonb,
    'summary', jsonb_build_object('pending', 0)
  );
end
$fn$;

create or replace function public.get_drinks_push_eligibility_summary_v661(
  limit_input integer default 50,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
begin
  if to_regprocedure('public.get_drinks_push_eligibility_summary_v660(integer,text)') is not null then
    return public.get_drinks_push_eligibility_summary_v660(limit_input, site_scope_input);
  end if;
  return jsonb_build_object(
    'ok', true,
    'source', 'v730_empty_eligibility_compat',
    'site_scope', case when lower(coalesce(site_scope_input, 'friends')) in ('family','familie') then 'family' else 'friends' end,
    'limit', greatest(1, least(coalesce(limit_input, 50), 200)),
    'items', '[]'::jsonb,
    'eligible', '[]'::jsonb,
    'summary', jsonb_build_object('eligible', 0)
  );
end
$fn$;

create or replace function public.queue_nearby_verification_pushes_v3(
  request_kind_input text default null,
  request_id_input bigint default null,
  site_scope_input text default 'friends',
  cooldown_seconds_input integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_kind text := lower(trim(coalesce(request_kind_input, '')));
  v_scope text := case when lower(coalesce(site_scope_input, 'friends')) in ('family','familie') then 'family' else 'friends' end;
  v_creator_id bigint := null;
  v_lat double precision := null;
  v_lng double precision := null;
  v_accuracy double precision := null;
  v_target_url text := './drinks_pending.html';
  v_count integer := 0;
begin
  if request_id_input is null or request_id_input <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request_id', 'queued_count', 0);
  end if;

  if v_kind = 'drink' then
    if to_regclass('public.drink_events') is null then
      return jsonb_build_object('ok', false, 'reason', 'drink_events_missing', 'queued_count', 0);
    end if;

    select
      nullif(to_jsonb(de)->>'player_id', '')::bigint,
      coalesce(nullif(to_jsonb(de)->>'site_scope', ''), v_scope),
      nullif(to_jsonb(de)->>'lat', '')::double precision,
      nullif(to_jsonb(de)->>'lng', '')::double precision,
      nullif(to_jsonb(de)->>'accuracy', '')::double precision,
      './drinks_pending.html'
    into v_creator_id, v_scope, v_lat, v_lng, v_accuracy, v_target_url
    from public.drink_events de
    where de.id = request_id_input
      and coalesce(to_jsonb(de)->>'status', 'pending') = 'pending'
    limit 1;
  elsif v_kind = 'speed' then
    if to_regclass('public.drink_speed_attempts') is null then
      return jsonb_build_object('ok', false, 'reason', 'drink_speed_attempts_missing', 'queued_count', 0);
    end if;

    select
      nullif(to_jsonb(ds)->>'player_id', '')::bigint,
      coalesce(nullif(to_jsonb(ds)->>'site_scope', ''), v_scope),
      nullif(to_jsonb(ds)->>'lat', '')::double precision,
      nullif(to_jsonb(ds)->>'lng', '')::double precision,
      nullif(to_jsonb(ds)->>'accuracy', '')::double precision,
      './drinks_speed.html'
    into v_creator_id, v_scope, v_lat, v_lng, v_accuracy, v_target_url
    from public.drink_speed_attempts ds
    where ds.id = request_id_input
      and coalesce(to_jsonb(ds)->>'status', 'pending') = 'pending'
    limit 1;
  else
    return jsonb_build_object('ok', false, 'reason', 'invalid_kind', 'queued_count', 0);
  end if;

  if v_creator_id is null then
    return jsonb_build_object('ok', false, 'reason', 'request_not_pending', 'queued_count', 0);
  end if;

  if v_lat is null or v_lng is null then
    return jsonb_build_object('ok', true, 'reason', 'request_has_no_coordinates', 'queued_count', 0, 'request_kind', v_kind, 'request_id', request_id_input, 'site_scope', v_scope);
  end if;

  if to_regclass('public.web_push_subscriptions') is null or to_regclass('public.web_push_jobs') is null then
    return jsonb_build_object('ok', false, 'reason', 'push_tables_missing', 'queued_count', 0);
  end if;

  insert into public.web_push_jobs(
    status, target_player_id, target_subscription_id, title, body, target_url, payload, site_scope,
    trigger_kind, request_kind, request_id, created_by_player_id, target_player_name, dedupe_key, notification_tag
  )
  select
    'queued',
    s.player_id,
    s.id,
    case when v_kind = 'speed' then 'Nieuwe snelheidspoging in de buurt' else 'Nieuw drankje verifiëren' end,
    case when v_kind = 'speed' then 'Er staat een snelheidspoging in jouw buurt klaar voor verificatie.' else 'Er staat een drankverificatie in jouw buurt klaar.' end,
    v_target_url,
    jsonb_build_object('kind','nearby_verification','request_kind',v_kind,'request_id',request_id_input),
    v_scope,
    'nearby_verification',
    v_kind,
    request_id_input,
    v_creator_id,
    coalesce(nullif(to_jsonb(s)->>'player_name', ''), 'Speler'),
    'nearby:' || v_kind || ':' || request_id_input || ':' || s.id,
    'nearby-' || v_kind || '-' || request_id_input
  from public.web_push_subscriptions s
  where coalesce(to_jsonb(s)->>'disabled_at', '') = ''
    and coalesce(to_jsonb(s)->>'permission_state', '') = 'granted'
    and coalesce(to_jsonb(s)->>'site_scope', v_scope) = v_scope
    and s.player_id <> v_creator_id
  on conflict (dedupe_key) do nothing;

  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'queued_count', v_count, 'request_kind', v_kind, 'request_id', request_id_input, 'site_scope', v_scope);
end
$fn$;

grant execute on function public.get_drinks_pending_verification_summary_v661(integer, text) to anon, authenticated;
grant execute on function public.get_drinks_push_eligibility_summary_v661(integer, text) to anon, authenticated;
grant execute on function public.queue_nearby_verification_pushes_v3(text, bigint, text, integer) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
