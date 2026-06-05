-- GEJAST v745: drinks live-write contract repair.
-- The beta live-write harness found that the deployed drinks contract can fall
-- into an older ON CONFLICT path without a matching unique constraint. Keep the
-- public contract names, but route create/verify writes through schema-tolerant
-- helpers that do not depend on that legacy conflict target.

begin;

alter table if exists public.drink_events
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists accuracy double precision,
  add column if not exists site_scope text not null default 'friends',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.players
  add column if not exists slug text,
  add column if not exists chosen_username text,
  add column if not exists site_scope text not null default 'friends',
  add column if not exists session_token text,
  add column if not exists last_login_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.web_push_jobs
  add column if not exists dedupe_key text;

do $$
begin
  if to_regclass('public.web_push_jobs') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'web_push_jobs' and column_name = 'dedupe_key') then
    delete from public.web_push_jobs a
      using public.web_push_jobs b
     where a.ctid < b.ctid
       and a.dedupe_key is not null
       and b.dedupe_key is not null
       and a.dedupe_key = b.dedupe_key;

    drop index if exists public.web_push_jobs_dedupe_key_uidx;
    drop index if exists public.web_push_jobs_dedupe_uidx;

    create unique index if not exists web_push_jobs_dedupe_key_uidx
      on public.web_push_jobs(dedupe_key);
  end if;
end $$;

do $$
begin
  if to_regclass('public.web_push_subscriptions') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'web_push_subscriptions' and column_name = 'endpoint') then
    delete from public.web_push_subscriptions a
      using public.web_push_subscriptions b
     where a.ctid < b.ctid
       and a.endpoint is not null
       and b.endpoint is not null
       and a.endpoint = b.endpoint;

    create unique index if not exists web_push_subscriptions_endpoint_uidx
      on public.web_push_subscriptions(endpoint);
  end if;

  if to_regclass('public.web_push_active_presence') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'web_push_active_presence' and column_name = 'player_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'web_push_active_presence' and column_name = 'endpoint') then
    delete from public.web_push_active_presence a
      using public.web_push_active_presence b
     where a.ctid < b.ctid
       and a.player_id = b.player_id
       and a.endpoint is not null
       and b.endpoint is not null
       and a.endpoint = b.endpoint;

    create unique index if not exists web_push_active_presence_player_endpoint_uidx
      on public.web_push_active_presence(player_id, endpoint);
  end if;

  if to_regclass('public.drink_verified_records') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_verified_records' and column_name = 'source_kind')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_verified_records' and column_name = 'source_request_id') then
    delete from public.drink_verified_records a
      using public.drink_verified_records b
     where a.ctid < b.ctid
       and a.source_kind = b.source_kind
       and a.source_request_id = b.source_request_id;

    create unique index if not exists drink_verified_records_unique_source_idx
      on public.drink_verified_records(source_kind, source_request_id);
  end if;

  if to_regclass('public.drink_type_aliases') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_type_aliases' and column_name = 'alias_key') then
    delete from public.drink_type_aliases a
      using public.drink_type_aliases b
     where a.ctid < b.ctid
       and a.alias_key is not null
       and b.alias_key is not null
       and a.alias_key = b.alias_key;

    create unique index if not exists drink_type_aliases_alias_key_uidx
      on public.drink_type_aliases(alias_key);
  end if;
end $$;

do $$
begin
  if to_regclass('public.beerpong_matches') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'beerpong_matches' and column_name = 'client_match_id') then
    delete from public.beerpong_matches a
      using public.beerpong_matches b
     where a.ctid < b.ctid
       and a.client_match_id is not null
       and b.client_match_id is not null
       and a.client_match_id = b.client_match_id;

    create unique index if not exists beerpong_matches_client_match_id_uidx
      on public.beerpong_matches(client_match_id);
  end if;

  if to_regclass('public.boerenbridge_matches') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'boerenbridge_matches' and column_name = 'client_match_id') then
    delete from public.boerenbridge_matches a
      using public.boerenbridge_matches b
     where a.ctid < b.ctid
       and a.client_match_id is not null
       and b.client_match_id is not null
       and a.client_match_id = b.client_match_id;

    create unique index if not exists boerenbridge_matches_client_match_id_uidx
      on public.boerenbridge_matches(client_match_id);
  end if;

  if to_regclass('public.beerpong_player_ratings') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'beerpong_player_ratings' and column_name = 'player_name') then
    delete from public.beerpong_player_ratings a
      using public.beerpong_player_ratings b
     where a.ctid < b.ctid
       and a.player_name is not null
       and b.player_name is not null
       and a.player_name = b.player_name;

    create unique index if not exists beerpong_player_ratings_player_name_uidx
      on public.beerpong_player_ratings(player_name);
  end if;

  if to_regclass('public.beerpong_player_ratings') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'beerpong_player_ratings' and column_name = 'player_id') then
    delete from public.beerpong_player_ratings a
      using public.beerpong_player_ratings b
     where a.ctid < b.ctid
       and a.player_id is not null
       and b.player_id is not null
       and a.player_id = b.player_id;

    create unique index if not exists beerpong_player_ratings_player_id_uidx
      on public.beerpong_player_ratings(player_id);
  end if;

  if to_regclass('public.boerenbridge_player_stats') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'boerenbridge_player_stats' and column_name = 'player_name') then
    delete from public.boerenbridge_player_stats a
      using public.boerenbridge_player_stats b
     where a.ctid < b.ctid
       and a.player_name is not null
       and b.player_name is not null
       and a.player_name = b.player_name;

    create unique index if not exists boerenbridge_player_stats_player_name_uidx
      on public.boerenbridge_player_stats(player_name);
  end if;

  if to_regclass('public.boerenbridge_player_ratings') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'boerenbridge_player_ratings' and column_name = 'player_name') then
    delete from public.boerenbridge_player_ratings a
      using public.boerenbridge_player_ratings b
     where a.ctid < b.ctid
       and a.player_name is not null
       and b.player_name is not null
       and a.player_name = b.player_name;

    create unique index if not exists boerenbridge_player_ratings_player_name_uidx
      on public.boerenbridge_player_ratings(player_name);
  end if;

  if to_regclass('public.klaverjas_player_ratings') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'klaverjas_player_ratings' and column_name = 'player_name') then
    delete from public.klaverjas_player_ratings a
      using public.klaverjas_player_ratings b
     where a.ctid < b.ctid
       and a.player_name is not null
       and b.player_name is not null
       and a.player_name = b.player_name;

    create unique index if not exists klaverjas_player_ratings_player_name_uidx
      on public.klaverjas_player_ratings(player_name);
  end if;
end $$;

do $$
begin
  if to_regclass('public.klaverjas_active_match_presence') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'klaverjas_active_match_presence' and column_name = 'session_token')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'klaverjas_active_match_presence' and column_name = 'match_id') then
    delete from public.klaverjas_active_match_presence a
      using public.klaverjas_active_match_presence b
     where a.ctid < b.ctid
       and a.session_token is not null
       and b.session_token is not null
       and a.match_id is not null
       and b.match_id is not null
       and a.session_token = b.session_token
       and a.match_id = b.match_id;

    create unique index if not exists klaverjas_active_presence_session_match_uidx
      on public.klaverjas_active_match_presence(session_token, match_id);
  end if;

  if to_regclass('public.pikken_match_archive_v709') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pikken_match_archive_v709' and column_name = 'game_id') then
    delete from public.pikken_match_archive_v709 a
      using public.pikken_match_archive_v709 b
     where a.ctid < b.ctid
       and a.game_id = b.game_id;

    create unique index if not exists pikken_match_archive_v709_game_id_uidx
      on public.pikken_match_archive_v709(game_id);
  end if;

  if to_regclass('public.pikken_player_stats_v709') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pikken_player_stats_v709' and column_name = 'site_scope')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pikken_player_stats_v709' and column_name = 'player_id') then
    delete from public.pikken_player_stats_v709 a
      using public.pikken_player_stats_v709 b
     where a.ctid < b.ctid
       and a.site_scope = b.site_scope
       and a.player_id is not null
       and b.player_id is not null
       and a.player_id = b.player_id;

    create unique index if not exists pikken_player_stats_v709_scope_player_uidx
      on public.pikken_player_stats_v709(site_scope, player_id);
  end if;
end $$;

update public.drink_events de
   set status = 'cancelled',
       updated_at = now()
 where coalesce(de.status, 'pending') = 'pending'
   and coalesce(de.metadata->>'source', '') = 'tier3-repair-v745'
   and exists (
     select 1
       from public.players p
      where p.id = de.player_id
        and lower(coalesce(p.display_name, '')) in ('beta1', 'beta2', 'beta3', 'beta4')
   );

update public.players
   set chosen_username = coalesce(nullif(trim(chosen_username), ''), nullif(trim(display_name), ''), nullif(trim(slug), ''))
 where chosen_username is null or trim(chosen_username) = '';

do $$
declare
  r record;
begin
  for r in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('create_drink_event', 'cancel_my_pending_drink_event', 'verify_drink_event_public', 'contract_drinks_write_v664', 'contract_drinks_write_v663')
     order by case p.proname
       when 'contract_drinks_write_v664' then 1
       when 'contract_drinks_write_v663' then 2
       when 'verify_drink_event_public' then 3
       when 'cancel_my_pending_drink_event' then 4
       when 'create_drink_event' then 5
       else 9
     end
  loop
    execute format('drop function if exists %I.%I(%s)', r.nspname, r.proname, r.args);
  end loop;
end $$;

create or replace function public.create_drink_event(
  session_token text default null,
  event_type_key text default null,
  quantity integer default 1,
  lat double precision default null,
  lng double precision default null,
  accuracy double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  p public.players%rowtype;
  v_cols text[] := array[]::text[];
  v_vals text[] := array[]::text[];
  v_sql text;
  v_id bigint;
  v_key text := lower(nullif(trim(coalesce(event_type_key, 'bier')), ''));
  v_qty integer := greatest(1, coalesce(quantity, 1));
  v_type_id bigint;
  v_type_label text := coalesce(nullif(trim(event_type_key), ''), 'bier');
  v_unit numeric := 1;
  v_player_name text;
begin
  p := public._tier3_player_from_any_session_v740(session_token);
  v_player_name := coalesce(nullif(trim(p.chosen_username), ''), nullif(trim(p.display_name), ''));
  if p.id is null then
    raise exception 'Niet ingelogd.';
  end if;

  begin
    select id, coalesce(label, key, v_type_label), coalesce(unit_value, 1)
      into v_type_id, v_type_label, v_unit
      from public.drink_event_types
     where lower(key) in (v_key, 'bier', 'beer', 'bak')
     order by case lower(key) when v_key then 0 when 'bier' then 1 when 'beer' then 2 when 'bak' then 3 else 4 end
     limit 1;
  exception when others then
    null;
  end;

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'player_id') then
    v_cols := array_append(v_cols, 'player_id');
    v_vals := array_append(v_vals, p.id::text);
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'player_name') then
    v_cols := array_append(v_cols, 'player_name');
    v_vals := array_append(v_vals, quote_literal(v_player_name));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'event_type_id') and v_type_id is not null then
    v_cols := array_append(v_cols, 'event_type_id');
    v_vals := array_append(v_vals, v_type_id::text);
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'event_type_key') then
    v_cols := array_append(v_cols, 'event_type_key');
    v_vals := array_append(v_vals, quote_literal(v_key));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'event_type_label') then
    v_cols := array_append(v_cols, 'event_type_label');
    v_vals := array_append(v_vals, quote_literal(v_type_label));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'quantity') then
    v_cols := array_append(v_cols, 'quantity');
    v_vals := array_append(v_vals, v_qty::text);
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'total_units') then
    v_cols := array_append(v_cols, 'total_units');
    v_vals := array_append(v_vals, (v_qty * v_unit)::text);
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'lat') then
    v_cols := array_append(v_cols, 'lat');
    v_vals := array_append(v_vals, coalesce(lat::text, 'null'));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'lng') then
    v_cols := array_append(v_cols, 'lng');
    v_vals := array_append(v_vals, coalesce(lng::text, 'null'));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'accuracy') then
    v_cols := array_append(v_cols, 'accuracy');
    v_vals := array_append(v_vals, coalesce(accuracy::text, 'null'));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'status') then
    v_cols := array_append(v_cols, 'status');
    v_vals := array_append(v_vals, quote_literal('pending'));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'site_scope') then
    v_cols := array_append(v_cols, 'site_scope');
    v_vals := array_append(v_vals, quote_literal(coalesce(p.site_scope, 'friends')));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'metadata') then
    v_cols := array_append(v_cols, 'metadata');
    v_vals := array_append(v_vals, quote_literal(jsonb_build_object('source', 'tier3-repair-v745', 'beta', true)::text) || '::jsonb');
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drink_events' and column_name = 'created_at') then
    v_cols := array_append(v_cols, 'created_at');
    v_vals := array_append(v_vals, 'now()');
  end if;

  v_sql := format('insert into public.drink_events (%s) values (%s) returning id', array_to_string(v_cols, ', '), array_to_string(v_vals, ', '));
  execute v_sql into v_id;

  return jsonb_build_object('ok', true, 'drink_event_id', v_id, 'event_id', v_id, 'id', v_id, 'status', 'pending');
end;
$fn$;

grant execute on function public.create_drink_event(text, text, integer, double precision, double precision, double precision) to anon, authenticated;

create or replace function public.cancel_my_pending_drink_event(
  session_token text default null,
  drink_event_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  p public.players%rowtype;
  v_id bigint := drink_event_id;
  v_status text;
begin
  if v_id is null then
    raise exception 'drink_event_id_required';
  end if;

  p := public._tier3_player_from_any_session_v740(session_token);
  if p.id is null then
    raise exception 'Niet ingelogd.';
  end if;

  update public.drink_events de
     set status = 'cancelled',
         updated_at = now()
   where de.id = v_id
     and de.player_id = p.id
     and coalesce(de.status, 'pending') = 'pending'
   returning de.status into v_status;

  if v_status is null then
    raise exception 'pending_drink_event_not_found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'drink_event_id', v_id, 'status', v_status);
end;
$fn$;

grant execute on function public.cancel_my_pending_drink_event(text, bigint) to anon, authenticated;

create or replace function public.verify_drink_event_public(
  session_token text default null,
  drink_event_id bigint default null,
  approved boolean default null,
  approve boolean default null,
  lat double precision default null,
  lng double precision default null,
  accuracy double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  return public.verify_drink_event(
    session_token => session_token,
    drink_event_id => drink_event_id,
    lat => lat::numeric,
    lng => lng::numeric,
    accuracy => accuracy::numeric,
    approve => coalesce(approved, approve, true),
    reason => 'public'
  );
end;
$fn$;

grant execute on function public.verify_drink_event_public(text, bigint, boolean, boolean, double precision, double precision, double precision) to anon, authenticated;

create or replace function public.contract_drinks_write_v664(
  session_token text,
  action text,
  payload jsonb default '{}'::jsonb,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_action text := lower(trim(coalesce(action, '')));
  v_payload jsonb := coalesce(payload, '{}'::jsonb);
  v_result jsonb;
begin
  if nullif(trim(coalesce(session_token, '')), '') is null then
    return jsonb_build_object('ok', false, 'area', 'drinks', 'mode', 'write', 'code', 'MISSING_SESSION', 'message', 'Niet ingelogd.');
  end if;

  if v_action = 'create_event' then
    v_result := public.create_drink_event(
      session_token => session_token,
      event_type_key => coalesce(v_payload->>'event_type_key', v_payload->>'speed_type_key', 'bier'),
      quantity => greatest(1, coalesce(nullif(v_payload->>'quantity', '')::integer, 1)),
      lat => nullif(v_payload->>'lat', '')::double precision,
      lng => nullif(v_payload->>'lng', '')::double precision,
      accuracy => nullif(v_payload->>'accuracy', '')::double precision
    );
  elsif v_action = 'cancel_event' then
    v_result := public.cancel_my_pending_drink_event(
      session_token => session_token,
      drink_event_id => nullif(coalesce(v_payload->>'drink_event_id', v_payload->>'event_id', v_payload->>'id'), '')::bigint
    );
  elsif v_action = 'verify_event' then
    v_result := public.verify_drink_event_public(
      session_token => session_token,
      drink_event_id => nullif(coalesce(v_payload->>'drink_event_id', v_payload->>'event_id', v_payload->>'id'), '')::bigint,
      approved => coalesce(nullif(v_payload->>'approved', '')::boolean, nullif(v_payload->>'approve', '')::boolean, true),
      approve => coalesce(nullif(v_payload->>'approve', '')::boolean, nullif(v_payload->>'approved', '')::boolean, true),
      lat => nullif(v_payload->>'lat', '')::double precision,
      lng => nullif(v_payload->>'lng', '')::double precision,
      accuracy => nullif(v_payload->>'accuracy', '')::double precision
    );
  else
    return jsonb_build_object('ok', false, 'area', 'drinks', 'mode', 'write', 'code', 'UNSUPPORTED_ACTION', 'message', v_action);
  end if;

  return jsonb_build_object('ok', true, 'data', v_result);
end;
$fn$;

create or replace function public.contract_drinks_write_v663(
  session_token text,
  action text,
  payload jsonb default '{}'::jsonb,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  return public.contract_drinks_write_v664(
    session_token => session_token,
    action => action,
    payload => payload,
    site_scope_input => site_scope_input
  );
end;
$fn$;

grant execute on function public.contract_drinks_write_v664(text, text, jsonb, text) to anon, authenticated;
grant execute on function public.contract_drinks_write_v663(text, text, jsonb, text) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
