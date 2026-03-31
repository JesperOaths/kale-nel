-- Gejast v188
-- Homepage drinks ladders + speed ladder + seed/test data + Smirnoff Ice unit fix.
-- Note: this script uses existing project RPCs where possible so seeded data follows the real flow.

begin;

-- 1) Correct Smirnoff Ice units (275ml * 4% = 11ml pure alcohol = 1.1 UK units)
update public.drink_event_types
set unit_value = 1.1,
    label = coalesce(label, 'Ice')
where lower(coalesce(key, '')) = 'ice';

-- 2) Homepage Top 5 JSON now includes speed_top5 too.
create or replace function public.get_drinks_homepage_top5_public()
returns jsonb
language sql
security definer
set search_path = public
as $$
with verified_events as (
  select
    de.id,
    coalesce(nullif(trim(de.player_name), ''), nullif(trim(p.display_name), ''), 'Onbekend') as player_name,
    coalesce(nullif(trim(p.display_name), ''), nullif(trim(de.player_name), ''), 'Onbekend') as display_name,
    coalesce(de.total_units, 0)::numeric as total_units,
    coalesce(de.verified_at, de.created_at) as event_ts
  from public.drink_events de
  left join public.players p on p.id = de.player_id
  where de.status = 'verified'
),
session_window as (
  select public._drink_session_start(now()) as session_start
),
session_top as (
  select
    ve.player_name,
    max(ve.display_name) as display_name,
    round(sum(ve.total_units)::numeric, 1) as total_units
  from verified_events ve
  cross join session_window sw
  where ve.event_ts >= sw.session_start
  group by ve.player_name
  order by sum(ve.total_units) desc, ve.player_name asc
  limit 5
),
all_time_top as (
  select
    ve.player_name,
    max(ve.display_name) as display_name,
    round(sum(ve.total_units)::numeric, 1) as total_units
  from verified_events ve
  group by ve.player_name
  order by sum(ve.total_units) desc, ve.player_name asc
  limit 5
),
speed_top as (
  select
    coalesce(nullif(trim(dsa.player_name), ''), nullif(trim(p.display_name), ''), 'Onbekend') as player_name,
    coalesce(nullif(trim(p.display_name), ''), nullif(trim(dsa.player_name), ''), 'Onbekend') as display_name,
    round(min(coalesce(dsa.duration_seconds, 0))::numeric, 1) as duration_seconds
  from public.drink_speed_attempts dsa
  left join public.players p on p.id = dsa.player_id
  where coalesce(dsa.status, '') = 'verified'
  group by coalesce(nullif(trim(dsa.player_name), ''), nullif(trim(p.display_name), ''), 'Onbekend')
  order by min(coalesce(dsa.duration_seconds, 0)) asc, coalesce(nullif(trim(dsa.player_name), ''), nullif(trim(p.display_name), ''), 'Onbekend') asc
  limit 5
)
select jsonb_build_object(
  'session_top5', coalesce((select jsonb_agg(to_jsonb(session_top) order by total_units desc, player_name asc) from session_top), '[]'::jsonb),
  'all_time_top5', coalesce((select jsonb_agg(to_jsonb(all_time_top) order by total_units desc, player_name asc) from all_time_top), '[]'::jsonb),
  'speed_top5', coalesce((select jsonb_agg(to_jsonb(speed_top) order by duration_seconds asc, player_name asc) from speed_top), '[]'::jsonb)
);
$$;

grant execute on function public.get_drinks_homepage_top5_public() to anon, authenticated;

-- 3) Seed a test login user plus dummy players and realistic verified drinks/speed data.
-- This avoids direct raw inserts into drinks tables as much as possible and uses the project's own RPCs.
do $seed$
declare
  v_names text[] := array['Test Verifier','Drinks Dummy 1','Drinks Dummy 2','Drinks Dummy 3','Drinks Dummy 4','Drinks Dummy 5'];
  v_name text;
  v_player_id bigint;
  v_sql text;
  v_has_active boolean;
  v_has_pin_hash boolean;
  v_has_created_at boolean;
  v_has_updated_at boolean;
  v_pin_hash_expr text;
  v_login jsonb;
  v_tokens jsonb := '{}'::jsonb;
  v_event jsonb;
  v_event_id bigint;
  v_speed jsonb;
  v_speed_id bigint;
  v_lat numeric := 52.0110;
  v_lng numeric := 4.3570;
  v_type_keys text[] := array['bier','bier','bier','ice','shot','liter_bier'];
  v_submitter text;
  v_verifier text;
  v_type text;
  v_idx int;
  v_speed_key text;
  function_exists boolean;
begin
  select exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='players' and column_name='active'
  ) into v_has_active;
  select exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='players' and column_name='pin_hash'
  ) into v_has_pin_hash;
  select exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='players' and column_name='created_at'
  ) into v_has_created_at;
  select exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='players' and column_name='updated_at'
  ) into v_has_updated_at;

  for v_name in array['Verifier 1111'] || v_names loop
    select id into v_player_id
    from public.players
    where lower(display_name) = lower(v_name)
    limit 1;

    if v_player_id is null then
      v_sql := 'insert into public.players (display_name';
      if v_has_pin_hash then v_sql := v_sql || ', pin_hash'; end if;
      if v_has_active then v_sql := v_sql || ', active'; end if;
      if v_has_created_at then v_sql := v_sql || ', created_at'; end if;
      if v_has_updated_at then v_sql := v_sql || ', updated_at'; end if;
      v_sql := v_sql || ') values (' || quote_literal(v_name);
      if v_has_pin_hash then v_sql := v_sql || ', extensions.crypt(''1111'', extensions.gen_salt(''bf''))'; end if;
      if v_has_active then v_sql := v_sql || ', true'; end if;
      if v_has_created_at then v_sql := v_sql || ', now()'; end if;
      if v_has_updated_at then v_sql := v_sql || ', now()'; end if;
      v_sql := v_sql || ') returning id';
      execute v_sql into v_player_id;
    else
      if v_has_pin_hash or v_has_active or v_has_updated_at then
        v_sql := 'update public.players set ';
        if v_has_pin_hash then v_sql := v_sql || 'pin_hash = extensions.crypt(''1111'', extensions.gen_salt(''bf''))'; end if;
        if v_has_active then v_sql := v_sql || case when v_has_pin_hash then ', ' else '' end || 'active = true'; end if;
        if v_has_updated_at then v_sql := v_sql || case when v_has_pin_hash or v_has_active then ', ' else '' end || 'updated_at = now()'; end if;
        v_sql := v_sql || ' where id = ' || v_player_id;
        execute v_sql;
      end if;
    end if;

    if to_regclass('public.allowed_usernames') is not null then
      begin
        insert into public.allowed_usernames (username, display_name, status, player_id)
        values (
          coalesce(public._normalize_allowed_username(v_name), lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '', 'g'))),
          v_name,
          'active',
          v_player_id
        )
        on conflict (username) do update
        set display_name = excluded.display_name,
            status = 'active',
            player_id = excluded.player_id;
      exception when others then
        null;
      end;
    end if;

    begin
      execute format('select public.login_player(%L, %L)', v_name, '1111') into v_login;
      if coalesce(v_login ? 'session_token', false) then
        v_tokens := v_tokens || jsonb_build_object(v_name, v_login->>'session_token');
      end if;
    exception when others then
      null;
    end;
  end loop;

  -- Seed verified drink events via the real RPCs when sessions are available.
  if jsonb_object_length(v_tokens) > 1 then
    for v_idx in 1..12 loop
      v_submitter := case (v_idx % 6)
        when 0 then 'Verifier 1111'
        when 1 then 'Drinks Dummy 1'
        when 2 then 'Drinks Dummy 2'
        when 3 then 'Drinks Dummy 3'
        when 4 then 'Drinks Dummy 4'
        else 'Drinks Dummy 5'
      end;
      v_verifier := case when v_submitter = 'Verifier 1111' then 'Drinks Dummy 1' else 'Verifier 1111' end;
      v_type := v_type_keys[1 + ((v_idx - 1) % array_length(v_type_keys,1))];

      begin
        execute format(
          $$select public.create_drink_event(%L, %L, %s, %s, %s, %s)$$,
          v_tokens->>v_submitter,
          v_type,
          1,
          v_lat,
          v_lng,
          8
        ) into v_event;

        v_event_id := coalesce((v_event->>'drink_event_id')::bigint, (v_event->>'id')::bigint);
        if v_event_id is not null then
          perform public.verify_drink_event(v_tokens->>v_verifier, v_event_id, v_lat, v_lng, 8, true, 'seed');
        end if;
      exception when others then
        null;
      end;
    end loop;

    -- Seed speed attempts
    begin
      select key into v_speed_key from public.drink_speed_types order by key limit 1;
    exception when others then
      v_speed_key := 'adje';
    end;

    for v_idx in 1..6 loop
      v_submitter := case v_idx
        when 1 then 'Verifier 1111'
        when 2 then 'Drinks Dummy 1'
        when 3 then 'Drinks Dummy 2'
        when 4 then 'Drinks Dummy 3'
        when 5 then 'Drinks Dummy 4'
        else 'Drinks Dummy 5'
      end;
      v_verifier := case when v_submitter = 'Verifier 1111' then 'Drinks Dummy 1' else 'Verifier 1111' end;
      begin
        execute format(
          $$select public.create_drink_speed_attempt(%L, %L, %s, %s, %s, %s)$$,
          v_tokens->>v_submitter,
          v_speed_key,
          (3.8 + v_idx),
          v_lat,
          v_lng,
          8
        ) into v_speed;
        v_speed_id := coalesce((v_speed->>'attempt_id')::bigint, (v_speed->>'id')::bigint);
        if v_speed_id is not null then
          perform public.verify_drink_speed_attempt(v_tokens->>v_verifier, v_speed_id, v_lat, v_lng, 8);
        end if;
      exception when others then
        null;
      end;
    end loop;
  end if;
end
$seed$;

commit;
