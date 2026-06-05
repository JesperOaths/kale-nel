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
  add column if not exists created_at timestamptz not null default now();

alter table if exists public.players
  add column if not exists slug text,
  add column if not exists chosen_username text,
  add column if not exists site_scope text not null default 'friends',
  add column if not exists session_token text,
  add column if not exists last_login_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

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
       and p.proname in ('create_drink_event', 'verify_drink_event_public', 'contract_drinks_write_v664', 'contract_drinks_write_v663')
     order by case p.proname
       when 'contract_drinks_write_v664' then 1
       when 'contract_drinks_write_v663' then 2
       when 'verify_drink_event_public' then 3
       when 'create_drink_event' then 4
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
