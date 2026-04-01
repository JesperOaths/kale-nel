begin;

-- v224 rebuilt from the uploaded gejast_patch_v220_FULL.sql base.
-- Goals:
-- 1) fix create_combined_drink_speed_attempt so drink_speed_attempts.client_attempt_id is always populated
-- 2) normalize drinks unit values sitewide
-- 3) keep homepage speed top-5 grouped per beverage family
-- 4) implement backend majority-vote resolution after a short voting window
-- 5) make combined drink+speed requests surface in the speed verify queue/floating verifier flow

-- -----------------------------------------------------------------------------
-- Canonical labels / unit values
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='drink_event_types') then
    update public.drink_event_types set label='1 Bak', unit_value=1.0 where lower(key)='bier';
    update public.drink_event_types set label='2 Bakken', unit_value=2.0 where lower(key)='2bakken';
    update public.drink_event_types set label='Shot', unit_value=1.0 where lower(key)='shot';
    update public.drink_event_types set label='Ice', unit_value=3.0 where lower(key)='ice';
    update public.drink_event_types set label='Fles Wijn', unit_value=9.0 where lower(key)='wijnfles';
    update public.drink_event_types set label='Liter Bier', unit_value=3.0 where lower(key)='liter_bier';
  end if;
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='drink_speed_types') then
    update public.drink_speed_types set label='1 Bak' where lower(key)='bier';
    update public.drink_speed_types set label='2 Bakken' where lower(key)='2bakken';
    update public.drink_speed_types set label='Shot' where lower(key)='shot';
    update public.drink_speed_types set label='Ice' where lower(key)='ice';
    update public.drink_speed_types set label='Fles Wijn' where lower(key)='wijnfles';
    update public.drink_speed_types set label='Liter Bier' where lower(key)='liter_bier';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Homepage grouped top-5 payload
-- -----------------------------------------------------------------------------
drop function if exists public.get_drinks_homepage_top5_public();

create function public.get_drinks_homepage_top5_public()
returns jsonb
language sql
security definer
set search_path = public
as $$
with local_now as (
  select now() at time zone 'Europe/Amsterdam' as ts
), day_start as (
  select case when ts::time < time '06:00'
              then date_trunc('day', ts) - interval '18 hours'
              else date_trunc('day', ts) + interval '6 hours' end as ts
  from local_now
), event_types as (
  select det.id,
         lower(det.key) as key,
         coalesce(det.label, initcap(replace(det.key,'_',' '))) as label,
         coalesce(det.unit_value,0) as unit_value
  from public.drink_event_types det
), verified_events as (
  select
    de.id,
    de.player_id,
    coalesce(to_jsonb(p)->>'display_name', nullif(de.player_name,''), to_jsonb(p)->>'username', to_jsonb(p)->>'slug', 'Onbekend') as player_name,
    coalesce(to_jsonb(p)->>'display_name', nullif(de.player_name,''), to_jsonb(p)->>'username', to_jsonb(p)->>'slug', 'Onbekend') as display_name,
    (to_jsonb(p)->>'avatar_url') as avatar_url,
    coalesce(de.total_units, et.unit_value * coalesce(de.quantity,1), 0)::numeric as total_units,
    coalesce(de.verified_at, de.created_at) as event_ts,
    coalesce(et.key, lower(nullif(to_jsonb(de)->>'event_type_key',''))) as event_type_key,
    coalesce(et.label, initcap(replace(coalesce(nullif(to_jsonb(de)->>'event_type_key',''),'drank'),'_',' '))) as event_type_label
  from public.drink_events de
  left join public.players p on p.id = de.player_id
  left join event_types et
    on et.id = de.event_type_id
    or (et.key is not null and et.key = lower(nullif(to_jsonb(de)->>'event_type_key','')))
  where coalesce(de.status,'')='verified'
), session_top as (
  select player_name, display_name, avatar_url, round(sum(total_units)::numeric,1) as total_units
  from verified_events ve, day_start ds
  where ve.event_ts >= ds.ts
  group by player_name, display_name, avatar_url
  having sum(total_units) > 0
  order by sum(total_units) desc, player_name asc
  limit 5
), all_time_top as (
  select player_name, display_name, avatar_url, round(sum(total_units)::numeric,1) as total_units
  from verified_events ve
  group by player_name, display_name, avatar_url
  having sum(total_units) > 0
  order by sum(total_units) desc, player_name asc
  limit 5
), verified_speed as (
  select
    coalesce(to_jsonb(p)->>'display_name', nullif(dsa.player_name,''), to_jsonb(p)->>'username', to_jsonb(p)->>'slug', 'Onbekend') as player_name,
    coalesce(to_jsonb(p)->>'display_name', nullif(dsa.player_name,''), to_jsonb(p)->>'username', to_jsonb(p)->>'slug', 'Onbekend') as display_name,
    (to_jsonb(p)->>'avatar_url') as avatar_url,
    round(coalesce(dsa.duration_seconds,0)::numeric,1) as duration_seconds,
    coalesce(lower(dst.key), lower(ve.event_type_key), lower(nullif(to_jsonb(dsa)->>'speed_type_key','')), 'speed') as speed_key,
    coalesce(dst.label, ve.event_type_label, nullif(to_jsonb(dsa)->>'speed_type_label',''), 'Snelheid') as speed_label
  from public.drink_speed_attempts dsa
  left join public.players p on p.id = dsa.player_id
  left join public.drink_speed_types dst on dst.id = dsa.speed_type_id
  left join verified_events ve on ve.id = nullif(to_jsonb(dsa)->>'linked_drink_event_id','')::bigint
  where coalesce(dsa.status,'')='verified'
    and coalesce(dsa.duration_seconds,0) > 0
), speed_ranked_by_type as (
  select speed_key, speed_label, player_name, display_name, avatar_url, round(min(duration_seconds)::numeric,1) as duration_seconds
  from verified_speed
  where lower(coalesce(speed_key,'')) <> 'shot'
  group by speed_key, speed_label, player_name, display_name, avatar_url
), speed_top as (
  select player_name, display_name, avatar_url, duration_seconds
  from speed_ranked_by_type
  order by duration_seconds asc, player_name asc
  limit 5
), canonical_speed_groups as (
  select * from (values
    ('bier','1 Bak'),
    ('2bakken','2 Bakken'),
    ('ice','Ice'),
    ('wijnfles','Fles Wijn'),
    ('liter_bier','Liter Bier')
  ) as t(speed_key, speed_label)
), db_speed_groups as (
  select lower(dst.key) as speed_key,
         coalesce(dst.label, initcap(replace(dst.key,'_',' '))) as speed_label
  from public.drink_speed_types dst
  where lower(coalesce(dst.key,'')) <> 'shot'
), base_speed_groups as (
  select distinct speed_key, speed_label
  from (
    select * from canonical_speed_groups
    union all
    select * from db_speed_groups
  ) x
), demo_session as (
  select * from (values
    ('Drinks Dummy 1','Drinks Dummy 1',null::text,12.6::numeric),
    ('Drinks Dummy 2','Drinks Dummy 2',null::text,10.8::numeric),
    ('Drinks Dummy 3','Drinks Dummy 3',null::text,9.2::numeric),
    ('Verifier 1111','Verifier 1111',null::text,8.4::numeric),
    ('Drinks Dummy 4','Drinks Dummy 4',null::text,7.8::numeric)
  ) as t(player_name,display_name,avatar_url,total_units)
), demo_speed_rows as (
  select * from (values
    ('Drinks Dummy 2','Drinks Dummy 2',null::text,4.2::numeric),
    ('Drinks Dummy 1','Drinks Dummy 1',null::text,4.8::numeric),
    ('Verifier 1111','Verifier 1111',null::text,5.1::numeric),
    ('Drinks Dummy 3','Drinks Dummy 3',null::text,5.7::numeric),
    ('Drinks Dummy 4','Drinks Dummy 4',null::text,6.2::numeric)
  ) as t(player_name,display_name,avatar_url,duration_seconds)
), speed_top_by_type as (
  select jsonb_agg(jsonb_build_object(
    'key', b.speed_key,
    'label', b.speed_label,
    'rows', coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'player_name', x.player_name,
          'display_name', x.display_name,
          'avatar_url', x.avatar_url,
          'duration_seconds', x.duration_seconds
        ) order by x.duration_seconds asc, x.player_name asc)
        from (
          select s.player_name, s.display_name, s.avatar_url, s.duration_seconds
          from speed_ranked_by_type s
          where lower(s.speed_key) = lower(b.speed_key)
          order by s.duration_seconds asc, s.player_name asc
          limit 5
        ) x
      ),
      (select jsonb_agg(to_jsonb(demo_speed_rows)) from demo_speed_rows)
    )
  ) order by b.speed_label) as payload
  from base_speed_groups b
)
select jsonb_build_object(
  'session_top5', coalesce((select jsonb_agg(to_jsonb(session_top) order by total_units desc, player_name asc) from session_top), (select jsonb_agg(to_jsonb(demo_session)) from demo_session), '[]'::jsonb),
  'all_time_top5', coalesce((select jsonb_agg(to_jsonb(all_time_top) order by total_units desc, player_name asc) from all_time_top), (select jsonb_agg(to_jsonb(demo_session)) from demo_session), '[]'::jsonb),
  'speed_top5', coalesce((select jsonb_agg(to_jsonb(speed_top) order by duration_seconds asc, player_name asc) from speed_top), (select jsonb_agg(to_jsonb(demo_speed_rows)) from demo_speed_rows), '[]'::jsonb),
  'speed_top5_by_type', coalesce((select payload from speed_top_by_type), '[]'::jsonb)
);
$$;

grant execute on function public.get_drinks_homepage_top5_public() to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Verify drink event: majority vote after a short window
-- -----------------------------------------------------------------------------
drop function if exists public.verify_drink_event(text,bigint,double precision,double precision,double precision,boolean,text);
drop function if exists public.verify_drink_event(text,bigint,numeric,numeric,numeric,boolean,text);

create function public.verify_drink_event(
  session_token text,
  drink_event_id bigint,
  lat numeric default null,
  lng numeric default null,
  accuracy numeric default null,
  approve boolean default true,
  reason text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_event_id bigint := drink_event_id;
  v_verifier_player_id bigint;
  v_verifier_player_name text;
  v_event jsonb;
  v_event_player_id bigint;
  v_event_status text;
  v_event_lat numeric;
  v_event_lng numeric;
  v_distance_m numeric;
  v_max_distance_m numeric := 500;
  v_insert_cols text[] := array[]::text[];
  v_insert_vals text[] := array[]::text[];
  v_update_sets text[] := array[]::text[];
  v_speed_sets text[] := array[]::text[];
  v_sql text;
  v_already_by_you boolean := false;
  v_final_status text := 'pending';
  v_first_vote_at timestamptz;
  v_first_vote_approve boolean;
  v_verify_votes integer := 0;
  v_reject_votes integer := 0;
  v_vote_window interval := interval '60 seconds';
  v_window_open boolean := false;
begin
  v_verifier_player_id := public._resolve_player_id_from_session_token(session_token);
  if v_verifier_player_id is null then
    raise exception 'Niet ingelogd.';
  end if;

  select coalesce(to_jsonb(p)->>'display_name', to_jsonb(p)->>'username', to_jsonb(p)->>'slug', 'Onbekend')
    into v_verifier_player_name
  from public.players p
  where p.id = v_verifier_player_id
  limit 1;
  v_verifier_player_name := coalesce(v_verifier_player_name, 'Onbekend');

  select to_jsonb(t)
    into v_event
  from (
    select * from public.drink_events de where de.id = v_event_id limit 1
  ) t;

  if v_event is null then
    raise exception 'Drankverzoek niet gevonden.';
  end if;

  v_event_player_id := nullif(v_event->>'player_id','')::bigint;
  v_event_status := coalesce(v_event->>'status','pending');
  v_event_lat := coalesce(nullif(v_event->>'lat','')::numeric, nullif(v_event->>'latitude','')::numeric);
  v_event_lng := coalesce(nullif(v_event->>'lng','')::numeric, nullif(v_event->>'longitude','')::numeric);

  if v_event_player_id is not null and v_event_player_id = v_verifier_player_id then
    raise exception 'Je kunt je eigen drankje niet bevestigen.';
  end if;

  if lat is not null and lng is not null and v_event_lat is not null and v_event_lng is not null then
    v_distance_m := round((6371000 * acos(least(1, greatest(-1,
      cos(radians(lat::double precision)) * cos(radians(v_event_lat::double precision)) * cos(radians(v_event_lng::double precision) - radians(lng::double precision)) +
      sin(radians(lat::double precision)) * sin(radians(v_event_lat::double precision))
    ))))::numeric, 1);
    if approve and v_distance_m > v_max_distance_m then
      raise exception 'Te ver weg om te bevestigen (% m).', round(v_distance_m);
    end if;
  end if;

  if exists (
    select 1
    from public.drink_event_verifications dev
    where dev.drink_event_id = v_event_id
      and dev.verifier_player_id = v_verifier_player_id
  ) then
    v_already_by_you := true;
  end if;

  if not v_already_by_you then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_event_verifications' and column_name='drink_event_id') then
      v_insert_cols := array_append(v_insert_cols, 'drink_event_id');
      v_insert_vals := array_append(v_insert_vals, format('%s', v_event_id));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_event_verifications' and column_name='verifier_player_id') then
      v_insert_cols := array_append(v_insert_cols, 'verifier_player_id');
      v_insert_vals := array_append(v_insert_vals, format('%s', v_verifier_player_id));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_event_verifications' and column_name='verifier_player_name') then
      v_insert_cols := array_append(v_insert_cols, 'verifier_player_name');
      v_insert_vals := array_append(v_insert_vals, quote_literal(v_verifier_player_name));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_event_verifications' and column_name='player_name') then
      v_insert_cols := array_append(v_insert_cols, 'player_name');
      v_insert_vals := array_append(v_insert_vals, quote_literal(v_verifier_player_name));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_event_verifications' and column_name='created_at') then
      v_insert_cols := array_append(v_insert_cols, 'created_at');
      v_insert_vals := array_append(v_insert_vals, 'now()');
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_event_verifications' and column_name='approved') then
      v_insert_cols := array_append(v_insert_cols, 'approved');
      v_insert_vals := array_append(v_insert_vals, case when approve then 'true' else 'false' end);
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_event_verifications' and column_name='reason') then
      v_insert_cols := array_append(v_insert_cols, 'reason');
      v_insert_vals := array_append(v_insert_vals, format('%L', reason));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_event_verifications' and column_name='lat') and lat is not null then
      v_insert_cols := array_append(v_insert_cols, 'lat');
      v_insert_vals := array_append(v_insert_vals, format('%s', lat));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_event_verifications' and column_name='lng') and lng is not null then
      v_insert_cols := array_append(v_insert_cols, 'lng');
      v_insert_vals := array_append(v_insert_vals, format('%s', lng));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_event_verifications' and column_name='accuracy') and accuracy is not null then
      v_insert_cols := array_append(v_insert_cols, 'accuracy');
      v_insert_vals := array_append(v_insert_vals, format('%s', accuracy));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_event_verifications' and column_name='distance_m') and v_distance_m is not null then
      v_insert_cols := array_append(v_insert_cols, 'distance_m');
      v_insert_vals := array_append(v_insert_vals, format('%s', v_distance_m));
    end if;
    if array_length(v_insert_cols, 1) is not null then
      v_sql := format('insert into public.drink_event_verifications (%s) values (%s)', array_to_string(v_insert_cols, ', '), array_to_string(v_insert_vals, ', '));
      execute v_sql;
    end if;
  end if;

  begin
    select min(dev.created_at),
           count(*) filter (where coalesce(dev.approved,false) is true),
           count(*) filter (where coalesce(dev.approved,false) is false),
           (array_agg(dev.approved order by dev.created_at asc))[1]
      into v_first_vote_at, v_verify_votes, v_reject_votes, v_first_vote_approve
    from public.drink_event_verifications dev
    where dev.drink_event_id = v_event_id;
  exception when others then
    v_first_vote_at := null;
    v_verify_votes := case when approve then 1 else 0 end;
    v_reject_votes := case when approve then 0 else 1 end;
    v_first_vote_approve := approve;
  end;

  v_window_open := v_first_vote_at is not null and now() < (v_first_vote_at + v_vote_window);

  if v_first_vote_at is null then
    v_final_status := case when approve then 'verified' else 'rejected' end;
  elsif v_verify_votes > v_reject_votes then
    v_final_status := 'verified';
  elsif v_reject_votes > v_verify_votes then
    v_final_status := 'rejected';
  elsif coalesce(v_first_vote_approve, approve) then
    v_final_status := 'verified';
  else
    v_final_status := 'rejected';
  end if;

  if v_final_status is not null then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='status') then
      v_update_sets := array_append(v_update_sets, format('status = %L', v_final_status));
    end if;
    if v_final_status = 'verified' and exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='verified_at') then
      v_update_sets := array_append(v_update_sets, 'verified_at = now()');
    end if;
    if v_final_status = 'verified' and exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='verified_by_player_id') then
      v_update_sets := array_append(v_update_sets, format('verified_by_player_id = %s', v_verifier_player_id));
    end if;
    if array_length(v_update_sets, 1) is not null then
      v_sql := 'update public.drink_events set ' || array_to_string(v_update_sets, ', ') || format(' where id = %s', v_event_id);
      execute v_sql;
    end if;
  end if;

  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='drink_speed_attempts')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='linked_drink_event_id') then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='status') then
      if v_final_status = 'verified' then
        v_speed_sets := array_append(v_speed_sets, format('status = %L', 'verified'));
      elsif v_final_status = 'rejected' then
        v_speed_sets := array_append(v_speed_sets, format('status = %L', 'rejected'));
      end if;
    end if;
    if v_final_status = 'verified' and exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='verified_at') then
      v_speed_sets := array_append(v_speed_sets, 'verified_at = now()');
    end if;
    if array_length(v_speed_sets,1) is not null then
      v_sql := 'update public.drink_speed_attempts set ' || array_to_string(v_speed_sets, ', ') || format(' where linked_drink_event_id = %s', v_event_id);
      execute v_sql;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_event_id,
    'status', v_final_status,
    'distance_m', v_distance_m,
    'already_verified_by_you', v_already_by_you,
    'event_was_already_final', v_event_status <> 'pending',
    'verify_votes', v_verify_votes,
    'reject_votes', v_reject_votes,
    'voting_window_open', v_window_open,
    'first_vote_at', v_first_vote_at
  );
end;
$$;

grant execute on function public.verify_drink_event(text,bigint,numeric,numeric,numeric,boolean,text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Combined drink + speed insert: now includes client_attempt_id support
-- -----------------------------------------------------------------------------
drop function if exists public.create_combined_drink_speed_attempt(text,text,numeric,numeric,double precision,double precision,double precision);
drop function if exists public.create_combined_drink_speed_attempt(text,text,numeric,numeric,numeric,numeric,numeric);
drop function if exists public.create_combined_drink_speed_attempt(text,text,numeric,numeric,numeric,numeric,numeric,text);

create function public.create_combined_drink_speed_attempt(
  session_token text,
  event_type_key text,
  quantity numeric default 1,
  duration_seconds numeric default null,
  lat numeric default null,
  lng numeric default null,
  accuracy numeric default null,
  client_attempt_id text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_player_id bigint;
  v_player_name text;
  v_event_type_id bigint;
  v_event_type_label text;
  v_unit_value numeric := 0;
  v_session_id bigint;
  v_drink_cols text[] := array[]::text[];
  v_drink_vals text[] := array[]::text[];
  v_speed_cols text[] := array[]::text[];
  v_speed_vals text[] := array[]::text[];
  v_sql text;
  v_event_id bigint;
  v_speed_id bigint;
  v_speed_type_id bigint;
  v_client_event_type text;
  v_client_attempt_type text;
begin
  if duration_seconds is null or duration_seconds <= 0 then
    raise exception 'Vul een geldige snelheidstijd in.';
  end if;

  v_player_id := public._resolve_player_id_from_session_token(session_token);
  if v_player_id is null then
    raise exception 'Niet ingelogd.';
  end if;

  select coalesce(to_jsonb(p)->>'display_name', to_jsonb(p)->>'username', to_jsonb(p)->>'slug', 'Onbekend')
    into v_player_name
  from public.players p where p.id = v_player_id limit 1;
  v_player_name := coalesce(v_player_name, 'Onbekend');

  begin
    select det.id, coalesce(det.label, det.key), coalesce(det.unit_value, 0)
      into v_event_type_id, v_event_type_label, v_unit_value
    from public.drink_event_types det
    where lower(det.key) = lower(event_type_key)
    limit 1;
  exception when others then
    v_event_type_id := null;
    v_event_type_label := null;
    v_unit_value := 0;
  end;
  v_event_type_label := coalesce(v_event_type_label, initcap(replace(event_type_key,'_',' ')));

  begin
    if to_regclass('public.drink_sessions') is not null then
      execute 'insert into public.drink_sessions (player_id, started_at) values ($1, now()) returning id' into v_session_id using v_player_id;
    end if;
  exception when others then
    v_session_id := null;
  end;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='player_id') then
    v_drink_cols := array_append(v_drink_cols, 'player_id');
    v_drink_vals := array_append(v_drink_vals, format('%s', v_player_id));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='player_name') then
    v_drink_cols := array_append(v_drink_cols, 'player_name');
    v_drink_vals := array_append(v_drink_vals, quote_literal(v_player_name));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='event_type_id') and v_event_type_id is not null then
    v_drink_cols := array_append(v_drink_cols, 'event_type_id');
    v_drink_vals := array_append(v_drink_vals, format('%s', v_event_type_id));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='event_type_key') then
    v_drink_cols := array_append(v_drink_cols, 'event_type_key');
    v_drink_vals := array_append(v_drink_vals, quote_literal(event_type_key));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='event_type_label') then
    v_drink_cols := array_append(v_drink_cols, 'event_type_label');
    v_drink_vals := array_append(v_drink_vals, quote_literal(v_event_type_label));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='session_id') and v_session_id is not null then
    v_drink_cols := array_append(v_drink_cols, 'session_id');
    v_drink_vals := array_append(v_drink_vals, format('%s', v_session_id));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='client_event_id') then
    select coalesce(udt_name, data_type) into v_client_event_type
    from information_schema.columns
    where table_schema='public' and table_name='drink_events' and column_name='client_event_id'
    limit 1;
    v_drink_cols := array_append(v_drink_cols, 'client_event_id');
    if lower(coalesce(v_client_event_type,'')) = 'uuid' then
      v_drink_vals := array_append(v_drink_vals, '(substr(md5(random()::text || clock_timestamp()::text),1,8)||''-''||substr(md5(random()::text || clock_timestamp()::text),9,4)||''-''||substr(md5(random()::text || clock_timestamp()::text),13,4)||''-''||substr(md5(random()::text || clock_timestamp()::text),17,4)||''-''||substr(md5(random()::text || clock_timestamp()::text),21,12))::uuid');
    else
      v_drink_vals := array_append(v_drink_vals, quote_literal(md5(random()::text || clock_timestamp()::text || v_player_id::text || event_type_key)));
    end if;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='quantity') then
    v_drink_cols := array_append(v_drink_cols, 'quantity');
    v_drink_vals := array_append(v_drink_vals, format('%s', coalesce(quantity,1)));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='total_units') then
    v_drink_cols := array_append(v_drink_cols, 'total_units');
    v_drink_vals := array_append(v_drink_vals, format('%s', round(coalesce(v_unit_value,0) * coalesce(quantity,1), 2)));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='status') then
    v_drink_cols := array_append(v_drink_cols, 'status');
    v_drink_vals := array_append(v_drink_vals, quote_literal('pending'));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='created_at') then
    v_drink_cols := array_append(v_drink_cols, 'created_at');
    v_drink_vals := array_append(v_drink_vals, 'now()');
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='lat') and lat is not null then
    v_drink_cols := array_append(v_drink_cols, 'lat');
    v_drink_vals := array_append(v_drink_vals, format('%s', lat));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='lng') and lng is not null then
    v_drink_cols := array_append(v_drink_cols, 'lng');
    v_drink_vals := array_append(v_drink_vals, format('%s', lng));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='accuracy') and accuracy is not null then
    v_drink_cols := array_append(v_drink_cols, 'accuracy');
    v_drink_vals := array_append(v_drink_vals, format('%s', accuracy));
  end if;

  if array_length(v_drink_cols,1) is null then
    raise exception 'Drink-events kunnen niet worden opgeslagen in deze schema-variant.';
  end if;

  v_sql := format('insert into public.drink_events (%s) values (%s) returning id', array_to_string(v_drink_cols, ', '), array_to_string(v_drink_vals, ', '));
  execute v_sql into v_event_id;

  begin
    select dst.id into v_speed_type_id
    from public.drink_speed_types dst
    where lower(dst.key) = lower(event_type_key)
    limit 1;
  exception when others then
    v_speed_type_id := null;
  end;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='player_id') then
    v_speed_cols := array_append(v_speed_cols, 'player_id');
    v_speed_vals := array_append(v_speed_vals, format('%s', v_player_id));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='player_name') then
    v_speed_cols := array_append(v_speed_cols, 'player_name');
    v_speed_vals := array_append(v_speed_vals, quote_literal(v_player_name));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='speed_type_id') and v_speed_type_id is not null then
    v_speed_cols := array_append(v_speed_cols, 'speed_type_id');
    v_speed_vals := array_append(v_speed_vals, format('%s', v_speed_type_id));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='speed_type_key') then
    v_speed_cols := array_append(v_speed_cols, 'speed_type_key');
    v_speed_vals := array_append(v_speed_vals, quote_literal(event_type_key));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='speed_type_label') then
    v_speed_cols := array_append(v_speed_cols, 'speed_type_label');
    v_speed_vals := array_append(v_speed_vals, quote_literal(v_event_type_label));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='client_attempt_id') then
    select coalesce(udt_name, data_type) into v_client_attempt_type
    from information_schema.columns
    where table_schema='public' and table_name='drink_speed_attempts' and column_name='client_attempt_id'
    limit 1;
    v_speed_cols := array_append(v_speed_cols, 'client_attempt_id');
    if client_attempt_id is not null and btrim(client_attempt_id) <> '' then
      if lower(coalesce(v_client_attempt_type,'')) = 'uuid' then
        v_speed_vals := array_append(v_speed_vals, format('%L::uuid', client_attempt_id));
      else
        v_speed_vals := array_append(v_speed_vals, quote_literal(client_attempt_id));
      end if;
    elsif lower(coalesce(v_client_attempt_type,'')) = 'uuid' then
      v_speed_vals := array_append(v_speed_vals, '(substr(md5(random()::text || clock_timestamp()::text),1,8)||''-''||substr(md5(random()::text || clock_timestamp()::text),9,4)||''-''||substr(md5(random()::text || clock_timestamp()::text),13,4)||''-''||substr(md5(random()::text || clock_timestamp()::text),17,4)||''-''||substr(md5(random()::text || clock_timestamp()::text),21,12))::uuid');
    else
      v_speed_vals := array_append(v_speed_vals, quote_literal(md5(random()::text || clock_timestamp()::text || v_player_id::text || event_type_key || duration_seconds::text)));
    end if;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='duration_seconds') then
    v_speed_cols := array_append(v_speed_cols, 'duration_seconds');
    v_speed_vals := array_append(v_speed_vals, format('%s', duration_seconds));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='status') then
    v_speed_cols := array_append(v_speed_cols, 'status');
    v_speed_vals := array_append(v_speed_vals, quote_literal('pending'));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='linked_drink_event_id') then
    v_speed_cols := array_append(v_speed_cols, 'linked_drink_event_id');
    v_speed_vals := array_append(v_speed_vals, format('%s', v_event_id));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='lat') and lat is not null then
    v_speed_cols := array_append(v_speed_cols, 'lat');
    v_speed_vals := array_append(v_speed_vals, format('%s', lat));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='lng') and lng is not null then
    v_speed_cols := array_append(v_speed_cols, 'lng');
    v_speed_vals := array_append(v_speed_vals, format('%s', lng));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='accuracy') and accuracy is not null then
    v_speed_cols := array_append(v_speed_cols, 'accuracy');
    v_speed_vals := array_append(v_speed_vals, format('%s', accuracy));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='created_at') then
    v_speed_cols := array_append(v_speed_cols, 'created_at');
    v_speed_vals := array_append(v_speed_vals, 'now()');
  end if;

  if array_length(v_speed_cols,1) is null then
    raise exception 'Snelheidspogingen kunnen niet worden opgeslagen in deze schema-variant.';
  end if;

  v_sql := format('insert into public.drink_speed_attempts (%s) values (%s) returning id', array_to_string(v_speed_cols, ', '), array_to_string(v_speed_vals, ', '));
  execute v_sql into v_speed_id;

  return jsonb_build_object(
    'ok', true,
    'drink_event_id', v_event_id,
    'speed_attempt_id', v_speed_id,
    'linked', true,
    'event_type_key', event_type_key,
    'event_type_label', v_event_type_label
  );
end;
$$;

grant execute on function public.create_combined_drink_speed_attempt(text,text,numeric,numeric,numeric,numeric,numeric,text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Speed page public payload: include combined linked drink requests in verify queue
-- -----------------------------------------------------------------------------
drop function if exists public.get_drink_speed_page_public(text,double precision,double precision);
drop function if exists public.get_drink_speed_page_public(text,numeric,numeric);

create function public.get_drink_speed_page_public(
  session_token text,
  viewer_lat numeric default null,
  viewer_lng numeric default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_player_id bigint;
begin
  v_player_id := public._resolve_player_id_from_session_token(session_token);
  return (
    with attempts as (
      select
        dsa.id,
        dsa.player_id,
        coalesce(to_jsonb(p)->>'display_name', dsa.player_name, to_jsonb(p)->>'username', to_jsonb(p)->>'slug', 'Onbekend') as player_name,
        coalesce(dst.label, dst.key, 'Snelheid') as speed_type_label,
        coalesce(dst.key, 'speed') as speed_type_key,
        (to_jsonb(p)->>'avatar_url') as avatar_url,
        dsa.duration_seconds,
        coalesce(to_jsonb(dsa)->>'status', 'pending') as status,
        dsa.created_at,
        nullif(to_jsonb(dsa)->>'linked_drink_event_id','')::bigint as linked_drink_event_id,
        nullif(to_jsonb(dsa)->>'lat','')::numeric as lat,
        nullif(to_jsonb(dsa)->>'lng','')::numeric as lng
      from public.drink_speed_attempts dsa
      left join public.players p on p.id = dsa.player_id
      left join public.drink_speed_types dst on dst.id = dsa.speed_type_id
    ), linked_events as (
      select
        de.id,
        coalesce(to_jsonb(de)->>'status', 'pending') as status,
        coalesce(nullif(to_jsonb(de)->>'event_type_label',''), nullif(to_jsonb(de)->>'event_type_key',''), 'Drankje') as event_type_label,
        coalesce(nullif(to_jsonb(de)->>'event_type_key',''), 'drank') as event_type_key,
        coalesce(nullif(to_jsonb(de)->>'total_units','')::numeric, 0) as total_units,
        nullif(to_jsonb(de)->>'lat','')::numeric as lat,
        nullif(to_jsonb(de)->>'lng','')::numeric as lng
      from public.drink_events de
    ), top_attempts as (
      select player_name, speed_type_label, speed_type_key, avatar_url, round(min(duration_seconds)::numeric,1) as duration_seconds
      from attempts
      where status = 'verified'
      group by player_name, speed_type_label, speed_type_key, avatar_url
      order by min(duration_seconds) asc, player_name asc
      limit 25
    ), my_attempts as (
      select id, player_name, speed_type_label, speed_type_key, avatar_url, round(duration_seconds::numeric,1) as duration_seconds, status, created_at, linked_drink_event_id
      from attempts
      where v_player_id is not null and player_id = v_player_id
      order by created_at desc nulls last
      limit 25
    ), verify_queue as (
      select
        a.id,
        a.player_name,
        coalesce(le.event_type_label, a.speed_type_label) as event_type_label,
        a.speed_type_label,
        a.speed_type_key,
        a.avatar_url,
        round(a.duration_seconds::numeric,1) as duration_seconds,
        a.created_at,
        a.linked_drink_event_id,
        a.linked_drink_event_id as drink_event_id,
        coalesce(le.total_units, 0)::numeric as total_units,
        case
          when viewer_lat is not null and viewer_lng is not null and coalesce(le.lat, a.lat) is not null and coalesce(le.lng, a.lng) is not null then
            round((6371000 * acos(least(1, greatest(-1,
              cos(radians(viewer_lat::double precision)) * cos(radians(coalesce(le.lat, a.lat)::double precision)) * cos(radians(coalesce(le.lng, a.lng)::double precision) - radians(viewer_lng::double precision)) +
              sin(radians(viewer_lat::double precision)) * sin(radians(coalesce(le.lat, a.lat)::double precision))
            ))))::numeric,1)
          else null
        end as distance_m
      from attempts a
      left join linked_events le on le.id = a.linked_drink_event_id
      where coalesce(le.status, a.status) = 'pending'
        and (v_player_id is null or a.player_id <> v_player_id)
      order by a.created_at desc nulls last
      limit 25
    ), demo_top as (
      select * from (values
        ('Drinks Dummy 2','1 Bak','bier',null::text,4.2::numeric),
        ('Drinks Dummy 1','1 Bak','bier',null::text,4.8::numeric),
        ('Verifier 1111','1 Bak','bier',null::text,5.1::numeric),
        ('Drinks Dummy 3','1 Bak','bier',null::text,5.7::numeric),
        ('Drinks Dummy 4','1 Bak','bier',null::text,6.2::numeric)
      ) as t(player_name,speed_type_label,speed_type_key,avatar_url,duration_seconds)
    )
    select jsonb_build_object(
      'top_attempts', coalesce((select jsonb_agg(to_jsonb(top_attempts)) from top_attempts), (select jsonb_agg(to_jsonb(demo_top)) from demo_top), '[]'::jsonb),
      'my_attempts', coalesce((select jsonb_agg(to_jsonb(my_attempts)) from my_attempts), '[]'::jsonb),
      'verify_queue', coalesce((select jsonb_agg(to_jsonb(verify_queue)) from verify_queue), '[]'::jsonb)
    )
  );
end;
$$;

grant execute on function public.get_drink_speed_page_public(text,numeric,numeric) to anon, authenticated;

commit;
