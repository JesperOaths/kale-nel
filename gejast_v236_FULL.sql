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
      '[]'::jsonb
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

begin;

-- v226 safety wrapper for any remaining speed-verification path that still hits
-- verify_drink_speed_attempt(...). Uses unambiguous local variable names and delegates
-- combined linked requests to verify_drink_event(...).

drop function if exists public.verify_drink_speed_attempt(text,bigint,double precision,double precision,double precision);
drop function if exists public.verify_drink_speed_attempt(text,bigint,numeric,numeric,numeric);
drop function if exists public.verify_drink_speed_attempt(text,bigint,numeric,numeric,numeric,boolean,text);

create function public.verify_drink_speed_attempt(
  session_token text,
  attempt_id bigint,
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
  v_attempt_id bigint := attempt_id;
  v_player_id bigint;
  v_attempt jsonb;
  v_attempt_player_id bigint;
  v_linked_drink_event_id bigint;
  v_status text;
  v_insert_cols text[] := array[]::text[];
  v_insert_vals text[] := array[]::text[];
  v_sql text;
begin
  v_player_id := public._resolve_player_id_from_session_token(session_token);
  if v_player_id is null then
    raise exception 'Niet ingelogd.';
  end if;

  select to_jsonb(t)
    into v_attempt
  from (
    select *
    from public.drink_speed_attempts dsa
    where dsa.id = v_attempt_id
    limit 1
  ) t;

  if v_attempt is null then
    raise exception 'Snelheidspoging niet gevonden.';
  end if;

  v_attempt_player_id := nullif(v_attempt->>'player_id','')::bigint;
  v_linked_drink_event_id := nullif(v_attempt->>'linked_drink_event_id','')::bigint;
  v_status := coalesce(v_attempt->>'status','pending');

  if v_attempt_player_id is not null and v_attempt_player_id = v_player_id then
    raise exception 'Je kunt je eigen snelheidspoging niet bevestigen.';
  end if;

  if v_linked_drink_event_id is not null then
    return public.verify_drink_event(
      session_token := session_token,
      drink_event_id := v_linked_drink_event_id,
      lat := lat,
      lng := lng,
      accuracy := accuracy,
      approve := approve,
      reason := reason
    );
  end if;

  if v_status <> 'pending' then
    return jsonb_build_object('ok', true, 'id', v_attempt_id, 'status', v_status, 'already', true);
  end if;

  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='drink_speed_verifications') then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='speed_attempt_id') then
      v_insert_cols := array_append(v_insert_cols, 'speed_attempt_id');
      v_insert_vals := array_append(v_insert_vals, format('%s', v_attempt_id));
    elsif exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='attempt_id') then
      v_insert_cols := array_append(v_insert_cols, 'attempt_id');
      v_insert_vals := array_append(v_insert_vals, format('%s', v_attempt_id));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='verifier_player_id') then
      v_insert_cols := array_append(v_insert_cols, 'verifier_player_id');
      v_insert_vals := array_append(v_insert_vals, format('%s', v_player_id));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='approved') then
      v_insert_cols := array_append(v_insert_cols, 'approved');
      v_insert_vals := array_append(v_insert_vals, case when approve then 'true' else 'false' end);
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='reason') then
      v_insert_cols := array_append(v_insert_cols, 'reason');
      v_insert_vals := array_append(v_insert_vals, format('%L', reason));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='created_at') then
      v_insert_cols := array_append(v_insert_cols, 'created_at');
      v_insert_vals := array_append(v_insert_vals, 'now()');
    end if;
    if array_length(v_insert_cols,1) is not null then
      v_sql := format('insert into public.drink_speed_verifications (%s) values (%s)', array_to_string(v_insert_cols, ', '), array_to_string(v_insert_vals, ', '));
      execute v_sql;
    end if;
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='status') then
    execute format('update public.drink_speed_attempts set status=%L where id=%s', case when approve then 'verified' else 'rejected' end, v_attempt_id);
  end if;
  if approve and exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='verified_at') then
    execute format('update public.drink_speed_attempts set verified_at=now() where id=%s', v_attempt_id);
  end if;

  return jsonb_build_object('ok', true, 'id', v_attempt_id, 'status', case when approve then 'verified' else 'rejected' end);
end;
$$;

grant execute on function public.verify_drink_speed_attempt(text,bigint,numeric,numeric,numeric,boolean,text) to anon, authenticated;

commit;


begin;

-- -----------------------------------------------------------------------------
-- v229: separate speed-attempt pipeline from drink verification pipeline.
-- Speed submissions now create speed attempts only.
-- Speed verification now uses its own verifier table / majority outcome.
-- -----------------------------------------------------------------------------

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
  v_speed_type_id bigint;
  v_event_type_label text;
  v_unit_value numeric := 0;
  v_client_attempt_type text;
  v_speed_cols text[] := array[]::text[];
  v_speed_vals text[] := array[]::text[];
  v_sql text;
  v_speed_id bigint;
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

  begin
    select dst.id,
           coalesce(dst.label, det.label, dst.key, det.key, initcap(replace(event_type_key,'_',' '))),
           coalesce(det.unit_value, 0)
      into v_speed_type_id, v_event_type_label, v_unit_value
    from public.drink_speed_types dst
    left join public.drink_event_types det on lower(det.key) = lower(dst.key)
    where lower(dst.key) = lower(event_type_key)
    limit 1;
  exception when others then
    v_speed_type_id := null;
    v_event_type_label := initcap(replace(event_type_key,'_',' '));
    v_unit_value := 0;
  end;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='player_id') then
    v_speed_cols := array_append(v_speed_cols, 'player_id');
    v_speed_vals := array_append(v_speed_vals, format('%s', v_player_id));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='player_name') then
    v_speed_cols := array_append(v_speed_cols, 'player_name');
    v_speed_vals := array_append(v_speed_vals, quote_literal(coalesce(v_player_name,'Onbekend')));
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
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='event_type_key') then
    v_speed_cols := array_append(v_speed_cols, 'event_type_key');
    v_speed_vals := array_append(v_speed_vals, quote_literal(event_type_key));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='event_type_label') then
    v_speed_cols := array_append(v_speed_cols, 'event_type_label');
    v_speed_vals := array_append(v_speed_vals, quote_literal(v_event_type_label));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='quantity') then
    v_speed_cols := array_append(v_speed_cols, 'quantity');
    v_speed_vals := array_append(v_speed_vals, format('%s', coalesce(quantity,1)));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='total_units') then
    v_speed_cols := array_append(v_speed_cols, 'total_units');
    v_speed_vals := array_append(v_speed_vals, format('%s', round(coalesce(v_unit_value,0) * coalesce(quantity,1), 2)));
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

  return jsonb_build_object('ok', true, 'speed_attempt_id', v_speed_id, 'event_type_key', event_type_key, 'event_type_label', v_event_type_label, 'separate_speed_pipeline', true);
end;
$$;

grant execute on function public.create_combined_drink_speed_attempt(text,text,numeric,numeric,numeric,numeric,numeric,text) to anon, authenticated;

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
    with event_types as (
      select lower(det.key) as key, coalesce(det.label, det.key) as label, coalesce(det.unit_value,0) as unit_value
      from public.drink_event_types det
    ), attempts as (
      select
        dsa.id,
        dsa.player_id,
        coalesce(to_jsonb(p)->>'display_name', dsa.player_name, to_jsonb(p)->>'username', to_jsonb(p)->>'slug', 'Onbekend') as player_name,
        coalesce(nullif(to_jsonb(dsa)->>'event_type_label',''), nullif(to_jsonb(dsa)->>'speed_type_label',''), dst.label, et.label, dst.key, et.key, 'Snelheid') as event_type_label,
        coalesce(nullif(to_jsonb(dsa)->>'event_type_key',''), nullif(to_jsonb(dsa)->>'speed_type_key',''), dst.key, et.key, 'speed') as speed_type_key,
        (to_jsonb(p)->>'avatar_url') as avatar_url,
        round(coalesce(dsa.duration_seconds,0)::numeric,1) as duration_seconds,
        coalesce(to_jsonb(dsa)->>'status', 'pending') as status,
        dsa.created_at,
        nullif(to_jsonb(dsa)->>'lat','')::numeric as lat,
        nullif(to_jsonb(dsa)->>'lng','')::numeric as lng,
        coalesce(nullif(to_jsonb(dsa)->>'quantity','')::numeric, 1) as quantity,
        coalesce(nullif(to_jsonb(dsa)->>'total_units','')::numeric, et.unit_value * coalesce(nullif(to_jsonb(dsa)->>'quantity','')::numeric,1), 0) as total_units
      from public.drink_speed_attempts dsa
      left join public.players p on p.id = dsa.player_id
      left join public.drink_speed_types dst on dst.id = dsa.speed_type_id
      left join event_types et on et.key = lower(coalesce(nullif(to_jsonb(dsa)->>'event_type_key',''), nullif(to_jsonb(dsa)->>'speed_type_key',''), dst.key))
    ), top_attempts as (
      select player_name, event_type_label as speed_type_label, speed_type_key, avatar_url, round(min(duration_seconds)::numeric,1) as duration_seconds
      from attempts
      where status = 'verified'
      group by player_name, event_type_label, speed_type_key, avatar_url
      order by min(duration_seconds) asc, player_name asc
      limit 25
    ), my_attempts as (
      select id, player_name, event_type_label as speed_type_label, speed_type_key, avatar_url, round(duration_seconds::numeric,1) as duration_seconds, status, created_at, total_units
      from attempts
      where v_player_id is not null and player_id = v_player_id
      order by created_at desc nulls last
      limit 25
    ), verify_queue as (
      select
        a.id,
        a.player_name,
        a.event_type_label,
        a.event_type_label as speed_type_label,
        a.speed_type_key,
        a.avatar_url,
        round(a.duration_seconds::numeric,1) as duration_seconds,
        a.created_at,
        a.total_units,
        case
          when viewer_lat is not null and viewer_lng is not null and a.lat is not null and a.lng is not null then
            round((6371000 * acos(least(1, greatest(-1,
              cos(radians(viewer_lat::double precision)) * cos(radians(a.lat::double precision)) * cos(radians(a.lng::double precision) - radians(viewer_lng::double precision)) +
              sin(radians(viewer_lat::double precision)) * sin(radians(a.lat::double precision))
            ))))::numeric,1)
          else null
        end as distance_m
      from attempts a
      where a.status = 'pending'
        and (v_player_id is null or a.player_id <> v_player_id)
      order by a.created_at desc nulls last
      limit 25
    )
    select jsonb_build_object(
      'top_attempts', coalesce((select jsonb_agg(to_jsonb(top_attempts)) from top_attempts), '[]'::jsonb),
      'my_attempts', coalesce((select jsonb_agg(to_jsonb(my_attempts)) from my_attempts), '[]'::jsonb),
      'verify_queue', coalesce((select jsonb_agg(to_jsonb(verify_queue)) from verify_queue), '[]'::jsonb)
    )
  );
end;
$$;

grant execute on function public.get_drink_speed_page_public(text,numeric,numeric) to anon, authenticated;

drop function if exists public.verify_drink_speed_attempt(text,bigint,numeric,numeric,numeric,boolean,text);
create function public.verify_drink_speed_attempt(
  session_token text,
  attempt_id bigint,
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
  v_attempt_id bigint := attempt_id;
  v_player_id bigint;
  v_attempt jsonb;
  v_attempt_player_id bigint;
  v_status text;
  v_insert_cols text[] := array[]::text[];
  v_insert_vals text[] := array[]::text[];
  v_sql text;
  v_approve_count integer := 0;
  v_reject_count integer := 0;
  v_final_status text := 'pending';
begin
  v_player_id := public._resolve_player_id_from_session_token(session_token);
  if v_player_id is null then
    raise exception 'Niet ingelogd.';
  end if;

  select to_jsonb(t) into v_attempt
  from (select * from public.drink_speed_attempts dsa where dsa.id = v_attempt_id limit 1) t;

  if v_attempt is null then
    raise exception 'Snelheidspoging niet gevonden.';
  end if;

  v_attempt_player_id := nullif(v_attempt->>'player_id','')::bigint;
  v_status := coalesce(v_attempt->>'status','pending');

  if v_attempt_player_id is not null and v_attempt_player_id = v_player_id then
    raise exception 'Je kunt je eigen snelheidspoging niet bevestigen.';
  end if;

  if exists (
    select 1 from public.drink_speed_verifications dsv
    where (coalesce(nullif(to_jsonb(dsv)->>'speed_attempt_id','')::bigint, nullif(to_jsonb(dsv)->>'attempt_id','')::bigint) = v_attempt_id)
      and dsv.verifier_player_id = v_player_id
  ) then
    return jsonb_build_object('ok', true, 'id', v_attempt_id, 'status', v_status, 'already_verified_by_you', true);
  end if;

  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='drink_speed_verifications') then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='speed_attempt_id') then
      v_insert_cols := array_append(v_insert_cols, 'speed_attempt_id');
      v_insert_vals := array_append(v_insert_vals, format('%s', v_attempt_id));
    elsif exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='attempt_id') then
      v_insert_cols := array_append(v_insert_cols, 'attempt_id');
      v_insert_vals := array_append(v_insert_vals, format('%s', v_attempt_id));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='verifier_player_id') then
      v_insert_cols := array_append(v_insert_cols, 'verifier_player_id');
      v_insert_vals := array_append(v_insert_vals, format('%s', v_player_id));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='approved') then
      v_insert_cols := array_append(v_insert_cols, 'approved');
      v_insert_vals := array_append(v_insert_vals, case when approve then 'true' else 'false' end);
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='reason') then
      v_insert_cols := array_append(v_insert_cols, 'reason');
      v_insert_vals := array_append(v_insert_vals, format('%L', reason));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='created_at') then
      v_insert_cols := array_append(v_insert_cols, 'created_at');
      v_insert_vals := array_append(v_insert_vals, 'now()');
    end if;
    if array_length(v_insert_cols,1) is not null then
      v_sql := format('insert into public.drink_speed_verifications (%s) values (%s)', array_to_string(v_insert_cols, ', '), array_to_string(v_insert_vals, ', '));
      execute v_sql;
    end if;
  end if;

  select
    count(*) filter (where coalesce(nullif(to_jsonb(dsv)->>'approved','')::boolean, false) = true),
    count(*) filter (where coalesce(nullif(to_jsonb(dsv)->>'approved','')::boolean, false) = false)
    into v_approve_count, v_reject_count
  from public.drink_speed_verifications dsv
  where coalesce(nullif(to_jsonb(dsv)->>'speed_attempt_id','')::bigint, nullif(to_jsonb(dsv)->>'attempt_id','')::bigint) = v_attempt_id;

  if v_approve_count > v_reject_count then
    v_final_status := 'verified';
  elsif v_reject_count > v_approve_count then
    v_final_status := 'rejected';
  else
    v_final_status := 'pending';
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='status') then
    execute format('update public.drink_speed_attempts set status=%L where id=%s', v_final_status, v_attempt_id);
  end if;
  if v_final_status = 'verified' and exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='verified_at') then
    execute format('update public.drink_speed_attempts set verified_at=now() where id=%s', v_attempt_id);
  end if;

  return jsonb_build_object('ok', true, 'id', v_attempt_id, 'status', v_final_status, 'approve_votes', v_approve_count, 'reject_votes', v_reject_count, 'independent_speed_pipeline', true);
end;
$$;

grant execute on function public.verify_drink_speed_attempt(text,bigint,numeric,numeric,numeric,boolean,text) to anon, authenticated;

commit;


begin;

-- -----------------------------------------------------------------------------
-- v230: add speed attempts into drinks stats/totals and timed majority finalization
-- -----------------------------------------------------------------------------

create or replace function public.finalize_expired_drink_speed_votes()
returns integer
language plpgsql
security definer
as $$
declare
  v_count integer := 0;
begin
  if to_regclass('public.drink_speed_verifications') is null then
    return 0;
  end if;

  with vote_rollup as (
    select
      coalesce(nullif(to_jsonb(dsv)->>'speed_attempt_id','')::bigint, nullif(to_jsonb(dsv)->>'attempt_id','')::bigint) as speed_attempt_id,
      min(coalesce(dsv.created_at, now())) as first_vote_at,
      count(*) filter (where coalesce(nullif(to_jsonb(dsv)->>'approved','')::boolean, false) = true) as approve_votes,
      count(*) filter (where coalesce(nullif(to_jsonb(dsv)->>'approved','')::boolean, false) = false) as reject_votes
    from public.drink_speed_verifications dsv
    group by 1
  ), winners as (
    select
      vr.speed_attempt_id,
      case
        when vr.approve_votes > vr.reject_votes then 'verified'
        when vr.reject_votes > vr.approve_votes then 'rejected'
        else 'pending'
      end as final_status
    from vote_rollup vr
    join public.drink_speed_attempts dsa on dsa.id = vr.speed_attempt_id
    where coalesce(to_jsonb(dsa)->>'status','pending') = 'pending'
      and vr.first_vote_at <= now() - interval '60 seconds'
  )
  update public.drink_speed_attempts dsa
     set status = w.final_status,
         verified_at = case when w.final_status = 'verified' and exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='verified_at') then now() else dsa.verified_at end
    from winners w
   where dsa.id = w.speed_attempt_id
     and w.final_status <> 'pending';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  return v_count;
end;
$$;

grant execute on function public.finalize_expired_drink_speed_votes() to anon, authenticated;

create or replace function public.verify_drink_speed_attempt(
  session_token text,
  attempt_id bigint,
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
  v_attempt_id bigint := attempt_id;
  v_player_id bigint;
  v_attempt jsonb;
  v_attempt_player_id bigint;
  v_status text;
  v_insert_cols text[] := array[]::text[];
  v_insert_vals text[] := array[]::text[];
  v_sql text;
  v_approve_count integer := 0;
  v_reject_count integer := 0;
  v_first_vote_at timestamptz;
begin
  v_player_id := public._resolve_player_id_from_session_token(session_token);
  if v_player_id is null then
    raise exception 'Niet ingelogd.';
  end if;

  perform public.finalize_expired_drink_speed_votes();

  select to_jsonb(t) into v_attempt
  from (select * from public.drink_speed_attempts dsa where dsa.id = v_attempt_id limit 1) t;

  if v_attempt is null then
    raise exception 'Snelheidspoging niet gevonden.';
  end if;

  v_attempt_player_id := nullif(v_attempt->>'player_id','')::bigint;
  v_status := coalesce(v_attempt->>'status','pending');

  if v_attempt_player_id is not null and v_attempt_player_id = v_player_id then
    raise exception 'Je kunt je eigen snelheidspoging niet bevestigen.';
  end if;

  if v_status <> 'pending' then
    return jsonb_build_object('ok', true, 'id', v_attempt_id, 'status', v_status, 'already', true);
  end if;

  if exists (
    select 1 from public.drink_speed_verifications dsv
    where coalesce(nullif(to_jsonb(dsv)->>'speed_attempt_id','')::bigint, nullif(to_jsonb(dsv)->>'attempt_id','')::bigint) = v_attempt_id
      and dsv.verifier_player_id = v_player_id
  ) then
    return jsonb_build_object('ok', true, 'id', v_attempt_id, 'status', v_status, 'already_verified_by_you', true);
  end if;

  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='drink_speed_verifications') then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='speed_attempt_id') then
      v_insert_cols := array_append(v_insert_cols, 'speed_attempt_id');
      v_insert_vals := array_append(v_insert_vals, format('%s', v_attempt_id));
    elsif exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='attempt_id') then
      v_insert_cols := array_append(v_insert_cols, 'attempt_id');
      v_insert_vals := array_append(v_insert_vals, format('%s', v_attempt_id));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='verifier_player_id') then
      v_insert_cols := array_append(v_insert_cols, 'verifier_player_id');
      v_insert_vals := array_append(v_insert_vals, format('%s', v_player_id));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='approved') then
      v_insert_cols := array_append(v_insert_cols, 'approved');
      v_insert_vals := array_append(v_insert_vals, case when approve then 'true' else 'false' end);
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='reason') then
      v_insert_cols := array_append(v_insert_cols, 'reason');
      v_insert_vals := array_append(v_insert_vals, format('%L', reason));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='created_at') then
      v_insert_cols := array_append(v_insert_cols, 'created_at');
      v_insert_vals := array_append(v_insert_vals, 'now()');
    end if;
    if array_length(v_insert_cols,1) is not null then
      v_sql := format('insert into public.drink_speed_verifications (%s) values (%s)', array_to_string(v_insert_cols, ', '), array_to_string(v_insert_vals, ', '));
      execute v_sql;
    end if;
  end if;

  select
    min(coalesce(dsv.created_at, now())),
    count(*) filter (where coalesce(nullif(to_jsonb(dsv)->>'approved','')::boolean, false) = true),
    count(*) filter (where coalesce(nullif(to_jsonb(dsv)->>'approved','')::boolean, false) = false)
    into v_first_vote_at, v_approve_count, v_reject_count
  from public.drink_speed_verifications dsv
  where coalesce(nullif(to_jsonb(dsv)->>'speed_attempt_id','')::bigint, nullif(to_jsonb(dsv)->>'attempt_id','')::bigint) = v_attempt_id;

  if v_first_vote_at is not null and v_first_vote_at <= now() - interval '60 seconds' then
    perform public.finalize_expired_drink_speed_votes();
    select coalesce(to_jsonb(dsa)->>'status','pending') into v_status from public.drink_speed_attempts dsa where dsa.id = v_attempt_id;
  else
    v_status := 'pending';
  end if;

  return jsonb_build_object('ok', true, 'id', v_attempt_id, 'status', v_status, 'approve_votes', v_approve_count, 'reject_votes', v_reject_count, 'vote_window_ends_at', v_first_vote_at + interval '60 seconds');
end;
$$;

grant execute on function public.verify_drink_speed_attempt(text,bigint,numeric,numeric,numeric,boolean,text) to anon, authenticated;

create or replace function public.get_drink_speed_page_public(
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
  perform public.finalize_expired_drink_speed_votes();
  return (
    with event_types as (
      select lower(det.key) as key, coalesce(det.label, det.key) as label, coalesce(det.unit_value,0) as unit_value
      from public.drink_event_types det
    ), attempts as (
      select
        dsa.id,
        dsa.player_id,
        coalesce(to_jsonb(p)->>'display_name', dsa.player_name, to_jsonb(p)->>'username', to_jsonb(p)->>'slug', 'Onbekend') as player_name,
        coalesce(nullif(to_jsonb(dsa)->>'event_type_label',''), nullif(to_jsonb(dsa)->>'speed_type_label',''), dst.label, et.label, dst.key, et.key, 'Snelheid') as event_type_label,
        coalesce(nullif(to_jsonb(dsa)->>'event_type_key',''), nullif(to_jsonb(dsa)->>'speed_type_key',''), dst.key, et.key, 'speed') as speed_type_key,
        (to_jsonb(p)->>'avatar_url') as avatar_url,
        round(coalesce(dsa.duration_seconds,0)::numeric,1) as duration_seconds,
        coalesce(to_jsonb(dsa)->>'status', 'pending') as status,
        dsa.created_at,
        nullif(to_jsonb(dsa)->>'lat','')::numeric as lat,
        nullif(to_jsonb(dsa)->>'lng','')::numeric as lng,
        coalesce(nullif(to_jsonb(dsa)->>'quantity','')::numeric, 1) as quantity,
        coalesce(nullif(to_jsonb(dsa)->>'total_units','')::numeric, et.unit_value * coalesce(nullif(to_jsonb(dsa)->>'quantity','')::numeric,1), 0) as total_units
      from public.drink_speed_attempts dsa
      left join public.players p on p.id = dsa.player_id
      left join public.drink_speed_types dst on dst.id = dsa.speed_type_id
      left join event_types et on et.key = lower(coalesce(nullif(to_jsonb(dsa)->>'event_type_key',''), nullif(to_jsonb(dsa)->>'speed_type_key',''), dst.key))
    ), top_attempts as (
      select player_name, event_type_label as speed_type_label, speed_type_key, avatar_url, round(min(duration_seconds)::numeric,1) as duration_seconds
      from attempts
      where status = 'verified'
      group by player_name, event_type_label, speed_type_key, avatar_url
      order by min(duration_seconds) asc, player_name asc
      limit 25
    ), my_attempts as (
      select id, player_name, event_type_label as speed_type_label, speed_type_key, avatar_url, round(duration_seconds::numeric,1) as duration_seconds, status, created_at, total_units
      from attempts
      where v_player_id is not null and player_id = v_player_id
      order by created_at desc nulls last
      limit 25
    ), verify_queue as (
      select
        a.id,
        a.player_name,
        a.event_type_label,
        a.event_type_label as speed_type_label,
        a.speed_type_key,
        a.avatar_url,
        round(a.duration_seconds::numeric,1) as duration_seconds,
        a.created_at,
        a.total_units,
        case
          when viewer_lat is not null and viewer_lng is not null and a.lat is not null and a.lng is not null then
            round((6371000 * acos(least(1, greatest(-1,
              cos(radians(viewer_lat::double precision)) * cos(radians(a.lat::double precision)) * cos(radians(a.lng::double precision) - radians(viewer_lng::double precision)) +
              sin(radians(viewer_lat::double precision)) * sin(radians(a.lat::double precision))
            ))))::numeric,1)
          else null
        end as distance_m
      from attempts a
      where a.status = 'pending'
        and (v_player_id is null or a.player_id <> v_player_id)
      order by a.created_at desc nulls last
      limit 25
    )
    select jsonb_build_object(
      'top_attempts', coalesce((select jsonb_agg(to_jsonb(top_attempts)) from top_attempts), '[]'::jsonb),
      'my_attempts', coalesce((select jsonb_agg(to_jsonb(my_attempts)) from my_attempts), '[]'::jsonb),
      'verify_queue', coalesce((select jsonb_agg(to_jsonb(verify_queue)) from verify_queue), '[]'::jsonb)
    )
  );
end;
$$;

grant execute on function public.get_drink_speed_page_public(text,numeric,numeric) to anon, authenticated;

create or replace function public.get_drinks_homepage_top5_public()
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
  select lower(det.key) as key, coalesce(det.label, initcap(replace(det.key,'_',' '))) as label, coalesce(det.unit_value,0) as unit_value
  from public.drink_event_types det
), verified_drinks as (
  select
    de.player_id,
    coalesce(to_jsonb(p)->>'display_name', nullif(de.player_name,''), to_jsonb(p)->>'username', to_jsonb(p)->>'slug', 'Onbekend') as player_name,
    coalesce(to_jsonb(p)->>'display_name', nullif(de.player_name,''), to_jsonb(p)->>'username', to_jsonb(p)->>'slug', 'Onbekend') as display_name,
    (to_jsonb(p)->>'avatar_url') as avatar_url,
    coalesce(de.total_units, et.unit_value * coalesce(de.quantity,1), 0)::numeric as total_units,
    1::numeric as event_count,
    coalesce(de.verified_at, de.created_at) as event_ts,
    coalesce(et.key, lower(nullif(to_jsonb(de)->>'event_type_key',''))) as event_type_key,
    coalesce(et.label, initcap(replace(coalesce(nullif(to_jsonb(de)->>'event_type_key',''),'drank'),'_',' '))) as event_type_label,
    null::numeric as duration_seconds
  from public.drink_events de
  left join public.players p on p.id = de.player_id
  left join event_types et on et.key = lower(coalesce(nullif(to_jsonb(de)->>'event_type_key',''), et.key))
  where coalesce(de.status,'')='verified'
), verified_speed as (
  select
    dsa.player_id,
    coalesce(to_jsonb(p)->>'display_name', nullif(dsa.player_name,''), to_jsonb(p)->>'username', to_jsonb(p)->>'slug', 'Onbekend') as player_name,
    coalesce(to_jsonb(p)->>'display_name', nullif(dsa.player_name,''), to_jsonb(p)->>'username', to_jsonb(p)->>'slug', 'Onbekend') as display_name,
    (to_jsonb(p)->>'avatar_url') as avatar_url,
    coalesce(nullif(to_jsonb(dsa)->>'total_units','')::numeric, et.unit_value * coalesce(nullif(to_jsonb(dsa)->>'quantity','')::numeric,1), 0) as total_units,
    1::numeric as event_count,
    coalesce(dsa.verified_at, dsa.created_at) as event_ts,
    lower(coalesce(nullif(to_jsonb(dsa)->>'event_type_key',''), nullif(to_jsonb(dsa)->>'speed_type_key',''), dst.key)) as event_type_key,
    coalesce(nullif(to_jsonb(dsa)->>'event_type_label',''), nullif(to_jsonb(dsa)->>'speed_type_label',''), dst.label, et.label, 'Snelheid') as event_type_label,
    dsa.duration_seconds
  from public.drink_speed_attempts dsa
  left join public.players p on p.id = dsa.player_id
  left join public.drink_speed_types dst on dst.id = dsa.speed_type_id
  left join event_types et on et.key = lower(coalesce(nullif(to_jsonb(dsa)->>'event_type_key',''), nullif(to_jsonb(dsa)->>'speed_type_key',''), dst.key))
  where coalesce(to_jsonb(dsa)->>'status','')='verified'
), consumption as (
  select * from verified_drinks
  union all
  select player_id, player_name, display_name, avatar_url, total_units, event_count, event_ts, event_type_key, event_type_label, duration_seconds from verified_speed
), session_top as (
  select player_name, display_name, avatar_url, round(sum(total_units)::numeric,1) as total_units
  from consumption c, day_start ds
  where c.event_ts >= ds.ts
  group by player_name, display_name, avatar_url
  having sum(total_units) > 0
  order by sum(total_units) desc, player_name asc
  limit 5
), all_time_top as (
  select player_name, display_name, avatar_url, round(sum(total_units)::numeric,1) as total_units
  from consumption c
  group by player_name, display_name, avatar_url
  having sum(total_units) > 0
  order by sum(total_units) desc, player_name asc
  limit 5
), speed_ranked_by_type as (
  select event_type_key as speed_key, event_type_label as speed_label, player_name, display_name, avatar_url, round(min(duration_seconds)::numeric,1) as duration_seconds
  from verified_speed
  where lower(coalesce(event_type_key,'')) <> 'shot' and coalesce(duration_seconds,0) > 0
  group by event_type_key, event_type_label, player_name, display_name, avatar_url
), speed_top as (
  select player_name, display_name, avatar_url, duration_seconds
  from speed_ranked_by_type
  order by duration_seconds asc, player_name asc
  limit 5
), base_speed_groups as (
  select * from (values ('bier','1 Bak'),('2bakken','2 Bakken'),('ice','Ice'),('wijnfles','Fles Wijn'),('liter_bier','Liter Bier')) as t(speed_key,speed_label)
), speed_top_by_type as (
  select jsonb_agg(jsonb_build_object(
    'key', b.speed_key,
    'label', b.speed_label,
    'rows', coalesce((select jsonb_agg(jsonb_build_object('player_name',x.player_name,'display_name',x.display_name,'avatar_url',x.avatar_url,'duration_seconds',x.duration_seconds) order by x.duration_seconds asc, x.player_name asc)
                      from (select s.player_name, s.display_name, s.avatar_url, s.duration_seconds from speed_ranked_by_type s where lower(s.speed_key)=lower(b.speed_key) order by s.duration_seconds asc, s.player_name asc limit 5) x), '[]'::jsonb)
  ) order by b.speed_label) as payload
  from base_speed_groups b
)
select jsonb_build_object(
  'session_top5', coalesce((select jsonb_agg(to_jsonb(session_top) order by total_units desc, player_name asc) from session_top), '[]'::jsonb),
  'all_time_top5', coalesce((select jsonb_agg(to_jsonb(all_time_top) order by total_units desc, player_name asc) from all_time_top), '[]'::jsonb),
  'speed_top5', coalesce((select jsonb_agg(to_jsonb(speed_top) order by duration_seconds asc, player_name asc) from speed_top), '[]'::jsonb),
  'speed_top5_by_type', coalesce((select payload from speed_top_by_type), '[]'::jsonb)
);
$$;

grant execute on function public.get_drinks_homepage_top5_public() to anon, authenticated;

create or replace function public.get_drinks_stats_public()
returns jsonb
language sql
security definer
set search_path = public
as $$
with event_types as (
  select lower(det.key) as key, coalesce(det.label, initcap(replace(det.key,'_',' '))) as label, coalesce(det.unit_value,0) as unit_value
  from public.drink_event_types det
), drinks as (
  select
    coalesce(to_jsonb(p)->>'display_name', nullif(de.player_name,''), to_jsonb(p)->>'username', to_jsonb(p)->>'slug', 'Onbekend') as player_name,
    coalesce(de.total_units, et.unit_value * coalesce(de.quantity,1), 0)::numeric as total_units,
    coalesce(de.verified_at, de.created_at) as event_ts,
    coalesce(et.key, lower(nullif(to_jsonb(de)->>'event_type_key',''))) as event_type_key,
    coalesce(et.label, initcap(replace(coalesce(nullif(to_jsonb(de)->>'event_type_key',''),'drank'),'_',' '))) as event_type_label
  from public.drink_events de
  left join public.players p on p.id = de.player_id
  left join event_types et on et.key = lower(coalesce(nullif(to_jsonb(de)->>'event_type_key',''), et.key))
  where coalesce(de.status,'')='verified'
), speeds as (
  select
    coalesce(to_jsonb(p)->>'display_name', nullif(dsa.player_name,''), to_jsonb(p)->>'username', to_jsonb(p)->>'slug', 'Onbekend') as player_name,
    coalesce(nullif(to_jsonb(dsa)->>'total_units','')::numeric, et.unit_value * coalesce(nullif(to_jsonb(dsa)->>'quantity','')::numeric,1), 0) as total_units,
    coalesce(dsa.verified_at, dsa.created_at) as event_ts,
    lower(coalesce(nullif(to_jsonb(dsa)->>'event_type_key',''), nullif(to_jsonb(dsa)->>'speed_type_key',''), dst.key)) as event_type_key,
    coalesce(nullif(to_jsonb(dsa)->>'event_type_label',''), nullif(to_jsonb(dsa)->>'speed_type_label',''), dst.label, et.label, 'Snelheid') as event_type_label
  from public.drink_speed_attempts dsa
  left join public.players p on p.id = dsa.player_id
  left join public.drink_speed_types dst on dst.id = dsa.speed_type_id
  left join event_types et on et.key = lower(coalesce(nullif(to_jsonb(dsa)->>'event_type_key',''), nullif(to_jsonb(dsa)->>'speed_type_key',''), dst.key))
  where coalesce(to_jsonb(dsa)->>'status','')='verified'
), consumption as (
  select * from drinks
  union all
  select * from speeds
), totals as (
  select
    count(*)::int as all_events,
    round(coalesce(sum(total_units),0)::numeric,1) as all_units,
    count(*) filter (where event_ts >= date_trunc('month', now() at time zone 'Europe/Amsterdam'))::int as month_events,
    round(coalesce(sum(total_units) filter (where event_ts >= date_trunc('month', now() at time zone 'Europe/Amsterdam')),0)::numeric,1) as month_units
  from consumption
), top_units as (
  select player_name, count(*)::int as events, round(sum(total_units)::numeric,1) as units
  from consumption
  group by player_name
  order by sum(total_units) desc, player_name asc
  limit 25
), top_count as (
  select player_name, count(*)::int as events, round(sum(total_units)::numeric,1) as units
  from consumption
  group by player_name
  order by count(*) desc, player_name asc
  limit 25
), by_type as (
  select event_type_key as key, event_type_label as label, count(*)::int as events, round(sum(total_units)::numeric,1) as units
  from consumption
  group by event_type_key, event_type_label
  order by sum(total_units) desc, event_type_label asc
)
select jsonb_build_object(
  'totals', coalesce((select to_jsonb(totals) from totals), '{}'::jsonb),
  'top_units', coalesce((select jsonb_agg(to_jsonb(top_units)) from top_units), '[]'::jsonb),
  'top_count', coalesce((select jsonb_agg(to_jsonb(top_count)) from top_count), '[]'::jsonb),
  'by_type', coalesce((select jsonb_agg(to_jsonb(by_type)) from by_type), '[]'::jsonb)
);
$$;

grant execute on function public.get_drinks_stats_public() to anon, authenticated;

create or replace function public.get_drink_player_public(player_name text)
returns jsonb
language sql
security definer
set search_path = public
as $$
with target as (
  select p.id, coalesce(p.display_name, to_jsonb(p)->>'username', p.slug, player_name) as resolved_name
  from public.players p
  where lower(coalesce(p.display_name, to_jsonb(p)->>'username', p.slug, '')) = lower(player_name)
  limit 1
), event_types as (
  select lower(det.key) as key, coalesce(det.label, initcap(replace(det.key,'_',' '))) as label, coalesce(det.unit_value,0) as unit_value
  from public.drink_event_types det
), drinks as (
  select
    coalesce(de.verified_at, de.created_at) as event_ts,
    coalesce(de.total_units, et.unit_value * coalesce(de.quantity,1), 0)::numeric as total_units,
    coalesce(et.key, lower(nullif(to_jsonb(de)->>'event_type_key',''))) as event_type_key,
    coalesce(et.label, initcap(replace(coalesce(nullif(to_jsonb(de)->>'event_type_key',''),'drank'),'_',' '))) as event_type_label
  from public.drink_events de
  join target t on t.id = de.player_id
  left join event_types et on et.key = lower(coalesce(nullif(to_jsonb(de)->>'event_type_key',''), et.key))
  where coalesce(de.status,'')='verified'
), speeds as (
  select
    coalesce(dsa.verified_at, dsa.created_at) as event_ts,
    coalesce(nullif(to_jsonb(dsa)->>'total_units','')::numeric, et.unit_value * coalesce(nullif(to_jsonb(dsa)->>'quantity','')::numeric,1), 0) as total_units,
    lower(coalesce(nullif(to_jsonb(dsa)->>'event_type_key',''), nullif(to_jsonb(dsa)->>'speed_type_key',''), dst.key)) as event_type_key,
    coalesce(nullif(to_jsonb(dsa)->>'event_type_label',''), nullif(to_jsonb(dsa)->>'speed_type_label',''), dst.label, et.label, 'Snelheid') as event_type_label,
    dsa.duration_seconds
  from public.drink_speed_attempts dsa
  join target t on t.id = dsa.player_id
  left join public.drink_speed_types dst on dst.id = dsa.speed_type_id
  left join event_types et on et.key = lower(coalesce(nullif(to_jsonb(dsa)->>'event_type_key',''), nullif(to_jsonb(dsa)->>'speed_type_key',''), dst.key))
  where coalesce(to_jsonb(dsa)->>'status','')='verified'
), consumption as (
  select event_ts, total_units, event_type_key, event_type_label from drinks
  union all
  select event_ts, total_units, event_type_key, event_type_label from speeds
), nights as (
  select date_trunc('day', event_ts at time zone 'Europe/Amsterdam') as session_day, sum(total_units) as units
  from consumption
  group by 1
), summary as (
  select jsonb_build_object(
    'events', (select count(*)::int from consumption),
    'units', (select round(coalesce(sum(total_units),0)::numeric,1) from consumption),
    'avg_night_units', (select round(coalesce(avg(units),0)::numeric,1) from nights),
    'favorite_type', (select event_type_label from consumption group by event_type_label order by count(*) desc, event_type_label asc limit 1)
  ) as payload
), top_types as (
  select event_type_key as key, event_type_label as label, count(*)::int as events, round(sum(total_units)::numeric,1) as units
  from consumption
  group by event_type_key, event_type_label
  order by count(*) desc, event_type_label asc
  limit 10
), speed_records as (
  select event_type_label as label, round(min(duration_seconds)::numeric,1) as seconds
  from speeds
  group by event_type_label
  order by min(duration_seconds) asc, event_type_label asc
  limit 10
), recent as (
  select event_type_label, total_units, event_ts as verified_at from consumption order by event_ts desc nulls last limit 20
)
select jsonb_build_object(
  'summary', coalesce((select payload from summary), jsonb_build_object('events',0,'units',0,'avg_night_units',0,'favorite_type',null)),
  'top_types', coalesce((select jsonb_agg(to_jsonb(top_types)) from top_types), '[]'::jsonb),
  'speed_records', coalesce((select jsonb_agg(to_jsonb(speed_records)) from speed_records), '[]'::jsonb),
  'recent', coalesce((select jsonb_agg(to_jsonb(recent)) from recent), '[]'::jsonb),
  'speed_best_seconds', (select min(seconds) from speed_records)
);
$$;

grant execute on function public.get_drink_player_public(text) to anon, authenticated;

commit;


begin;

-- v231 follow-up fixes
create or replace function public.verify_drink_speed_attempt(
  session_token text,
  attempt_id bigint,
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
  v_attempt_id bigint := attempt_id;
  v_player_id bigint;
  v_attempt jsonb;
  v_attempt_player_id bigint;
  v_status text;
  v_verifier_player_name text;
  v_insert_cols text[] := array[]::text[];
  v_insert_vals text[] := array[]::text[];
  v_sql text;
  v_approve_count integer := 0;
  v_reject_count integer := 0;
  v_first_vote_at timestamptz;
begin
  v_player_id := public._resolve_player_id_from_session_token(session_token);
  if v_player_id is null then
    raise exception 'Niet ingelogd.';
  end if;

  select coalesce(to_jsonb(p)->>'display_name', to_jsonb(p)->>'username', to_jsonb(p)->>'slug', 'Onbekend')
    into v_verifier_player_name
  from public.players p
  where p.id = v_player_id
  limit 1;

  perform public.finalize_expired_drink_speed_votes();

  select to_jsonb(t) into v_attempt
  from (select * from public.drink_speed_attempts dsa where dsa.id = v_attempt_id limit 1) t;

  if v_attempt is null then
    raise exception 'Snelheidspoging niet gevonden.';
  end if;

  v_attempt_player_id := nullif(v_attempt->>'player_id','')::bigint;
  v_status := coalesce(v_attempt->>'status','pending');

  if v_attempt_player_id is not null and v_attempt_player_id = v_player_id then
    raise exception 'Je kunt je eigen snelheidspoging niet bevestigen.';
  end if;

  if v_status <> 'pending' then
    return jsonb_build_object('ok', true, 'id', v_attempt_id, 'status', v_status, 'already', true);
  end if;

  if exists (
    select 1 from public.drink_speed_verifications dsv
    where coalesce(nullif(to_jsonb(dsv)->>'speed_attempt_id','')::bigint, nullif(to_jsonb(dsv)->>'attempt_id','')::bigint) = v_attempt_id
      and dsv.verifier_player_id = v_player_id
  ) then
    return jsonb_build_object('ok', true, 'id', v_attempt_id, 'status', v_status, 'already_verified_by_you', true);
  end if;

  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='drink_speed_verifications') then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='speed_attempt_id') then
      v_insert_cols := array_append(v_insert_cols, 'speed_attempt_id');
      v_insert_vals := array_append(v_insert_vals, format('%s', v_attempt_id));
    elsif exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='attempt_id') then
      v_insert_cols := array_append(v_insert_cols, 'attempt_id');
      v_insert_vals := array_append(v_insert_vals, format('%s', v_attempt_id));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='verifier_player_id') then
      v_insert_cols := array_append(v_insert_cols, 'verifier_player_id');
      v_insert_vals := array_append(v_insert_vals, format('%s', v_player_id));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='verifier_player_name') then
      v_insert_cols := array_append(v_insert_cols, 'verifier_player_name');
      v_insert_vals := array_append(v_insert_vals, format('%L', coalesce(v_verifier_player_name,'Onbekend')));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='approved') then
      v_insert_cols := array_append(v_insert_cols, 'approved');
      v_insert_vals := array_append(v_insert_vals, case when approve then 'true' else 'false' end);
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='reason') then
      v_insert_cols := array_append(v_insert_cols, 'reason');
      v_insert_vals := array_append(v_insert_vals, format('%L', reason));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='created_at') then
      v_insert_cols := array_append(v_insert_cols, 'created_at');
      v_insert_vals := array_append(v_insert_vals, 'now()');
    end if;
    if array_length(v_insert_cols,1) is not null then
      v_sql := format('insert into public.drink_speed_verifications (%s) values (%s)', array_to_string(v_insert_cols, ', '), array_to_string(v_insert_vals, ', '));
      execute v_sql;
    end if;
  end if;

  select
    min(coalesce(dsv.created_at, now())),
    count(*) filter (where coalesce(nullif(to_jsonb(dsv)->>'approved','')::boolean, false) = true),
    count(*) filter (where coalesce(nullif(to_jsonb(dsv)->>'approved','')::boolean, false) = false)
    into v_first_vote_at, v_approve_count, v_reject_count
  from public.drink_speed_verifications dsv
  where coalesce(nullif(to_jsonb(dsv)->>'speed_attempt_id','')::bigint, nullif(to_jsonb(dsv)->>'attempt_id','')::bigint) = v_attempt_id;

  if v_first_vote_at is not null and v_first_vote_at <= now() - interval '60 seconds' then
    perform public.finalize_expired_drink_speed_votes();
    select coalesce(to_jsonb(dsa)->>'status','pending') into v_status from public.drink_speed_attempts dsa where dsa.id = v_attempt_id;
  else
    v_status := 'pending';
  end if;

  return jsonb_build_object('ok', true, 'id', v_attempt_id, 'status', v_status, 'approve_votes', v_approve_count, 'reject_votes', v_reject_count, 'vote_window_ends_at', v_first_vote_at + interval '60 seconds');
end;
$$;

grant execute on function public.verify_drink_speed_attempt(text,bigint,numeric,numeric,numeric,boolean,text) to anon, authenticated;

create or replace function public.get_drink_player_public(player_name text)
returns jsonb
language sql
security definer
set search_path = public
as $$
with target as (
  select p.id, coalesce(p.display_name, to_jsonb(p)->>'username', p.slug, player_name) as resolved_name
  from public.players p
  where lower(coalesce(p.display_name, to_jsonb(p)->>'username', p.slug, '')) = lower(player_name)
  limit 1
), event_types as (
  select lower(det.key) as key, coalesce(det.label, initcap(replace(det.key,'_',' '))) as label, coalesce(det.unit_value,0) as unit_value
  from public.drink_event_types det
), drinks as (
  select coalesce(de.verified_at, de.created_at) as event_ts,
         coalesce(de.total_units, et.unit_value * coalesce(de.quantity,1), 0)::numeric as total_units,
         coalesce(et.key, lower(nullif(to_jsonb(de)->>'event_type_key',''))) as event_type_key,
         coalesce(et.label, initcap(replace(coalesce(nullif(to_jsonb(de)->>'event_type_key',''),'drank'),'_',' '))) as event_type_label
  from public.drink_events de
  join target t on t.id = de.player_id
  left join event_types et on et.key = lower(coalesce(nullif(to_jsonb(de)->>'event_type_key',''), et.key))
  where coalesce(de.status,'')='verified'
), speeds as (
  select coalesce(dsa.verified_at, dsa.created_at) as event_ts,
         coalesce(nullif(to_jsonb(dsa)->>'total_units','')::numeric, et.unit_value * coalesce(nullif(to_jsonb(dsa)->>'quantity','')::numeric,1), 0) as total_units,
         lower(coalesce(nullif(to_jsonb(dsa)->>'event_type_key',''), nullif(to_jsonb(dsa)->>'speed_type_key',''), dst.key)) as event_type_key,
         coalesce(nullif(to_jsonb(dsa)->>'event_type_label',''), nullif(to_jsonb(dsa)->>'speed_type_label',''), dst.label, et.label, 'Snelheid') as event_type_label,
         dsa.duration_seconds
  from public.drink_speed_attempts dsa
  join target t on t.id = dsa.player_id
  left join public.drink_speed_types dst on dst.id = dsa.speed_type_id
  left join event_types et on et.key = lower(coalesce(nullif(to_jsonb(dsa)->>'event_type_key',''), nullif(to_jsonb(dsa)->>'speed_type_key',''), dst.key))
  where coalesce(to_jsonb(dsa)->>'status','')='verified'
), consumption as (
  select event_ts, total_units, event_type_key, event_type_label from drinks
  union all
  select event_ts, total_units, event_type_key, event_type_label from speeds
), nights as (
  select date_trunc('day', event_ts at time zone 'Europe/Amsterdam') as session_day, sum(total_units) as units
  from consumption
  group by 1
), summary as (
  select jsonb_build_object(
    'events', (select count(*)::int from consumption),
    'units', (select round(coalesce(sum(total_units),0)::numeric,1) from consumption),
    'avg_night_units', (select round(coalesce(avg(units),0)::numeric,1) from nights),
    'favorite_type', (select event_type_label from consumption group by event_type_label order by count(*) desc, event_type_label asc limit 1)
  ) as payload
), top_types as (
  select event_type_key as key, event_type_label as label, count(*)::int as events, round(sum(total_units)::numeric,1) as units
  from consumption
  group by event_type_key, event_type_label
  order by count(*) desc, event_type_label asc
  limit 10
), speed_records as (
  select event_type_label as label, round(min(duration_seconds)::numeric,1) as seconds
  from speeds
  group by event_type_label
  order by min(duration_seconds) asc, event_type_label asc
  limit 10
), recent as (
  select event_type_label, total_units, event_ts as verified_at from consumption order by event_ts desc nulls last limit 20
)
select jsonb_build_object(
  'summary', coalesce((select payload from summary), jsonb_build_object('events',0,'units',0,'avg_night_units',0,'favorite_type',null)),
  'top_types', coalesce((select jsonb_agg(to_jsonb(top_types)) from top_types), '[]'::jsonb),
  'speed_records', coalesce((select jsonb_agg(to_jsonb(speed_records)) from speed_records), '[]'::jsonb),
  'recent', coalesce((select jsonb_agg(to_jsonb(recent)) from recent), '[]'::jsonb),
  'speed_best_seconds', (select min(seconds) from speed_records)
);
$$;

grant execute on function public.get_drink_player_public(text) to anon, authenticated;

commit;

begin;

create table if not exists public.admin_drinks_action_groups (
  id bigserial primary key,
  action_kind text not null,
  entity_kind text not null,
  created_at timestamptz not null default now(),
  undone_at timestamptz null
);

create table if not exists public.admin_drinks_action_items (
  id bigserial primary key,
  action_group_id bigint not null references public.admin_drinks_action_groups(id) on delete cascade,
  entity_kind text not null,
  entity_id bigint not null,
  previous_status text null,
  next_status text null,
  created_at timestamptz not null default now()
);

create or replace function public._clear_player_account_access(target_player_id bigint)
returns void
language plpgsql
security definer
as $$
declare
  v_sets text[] := array[]::text[];
  v_sql text;
begin
  if target_player_id is null then
    return;
  end if;

  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='sessions') then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='sessions' and column_name='player_id') then
      execute 'delete from public.sessions where player_id = $1' using target_player_id;
    end if;
  end if;

  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='players') then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='active') then v_sets := array_append(v_sets, 'active = false'); end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='status') then v_sets := array_append(v_sets, 'status = ''archived'''); end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='email') then v_sets := array_append(v_sets, 'email = null'); end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='reserved_for_email') then v_sets := array_append(v_sets, 'reserved_for_email = null'); end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='pin_hash') then v_sets := array_append(v_sets, 'pin_hash = null'); end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='updated_at') then v_sets := array_append(v_sets, 'updated_at = now()'); end if;
    if array_length(v_sets,1) is not null then
      v_sql := 'update public.players set ' || array_to_string(v_sets, ', ') || ' where id = $1';
      execute v_sql using target_player_id;
    end if;
  end if;
end;
$$;

grant execute on function public._clear_player_account_access(bigint) to anon, authenticated;

create or replace function public._next_spookinoza_name()
returns text
language plpgsql
security definer
as $$
declare
  v_n integer := 1;
  v_name text;
begin
  loop
    v_name := 'Spookinoza ' || v_n::text;
    exit when not exists (select 1 from public.players p where lower(coalesce(to_jsonb(p)->>'display_name', to_jsonb(p)->>'username', to_jsonb(p)->>'slug', '')) = lower(v_name));
    v_n := v_n + 1;
  end loop;
  return v_name;
end;
$$;

grant execute on function public._next_spookinoza_name() to anon, authenticated;

create or replace function public._replace_player_name_references(old_name text, new_name text, target_player_id bigint)
returns void
language plpgsql
security definer
as $$
declare
  rec record;
begin
  if coalesce(trim(old_name),'') = '' or coalesce(trim(new_name),'') = '' then
    return;
  end if;

  for rec in
    select table_schema, table_name, column_name
    from information_schema.columns
    where table_schema='public'
      and data_type='text'
      and column_name in ('player_name','display_name','username','submitted_by_name','verifier_player_name','created_by_name')
  loop
    execute format('update %I.%I set %I = $1 where lower(coalesce(%I, '''')) = lower($2)', rec.table_schema, rec.table_name, rec.column_name, rec.column_name)
      using new_name, old_name;
  end loop;

  for rec in
    select table_schema, table_name, column_name
    from information_schema.columns
    where table_schema='public'
      and data_type='ARRAY'
      and udt_name = '_text'
      and column_name in ('winner_names','participants','team_a_player_names','team_b_player_names','player_names')
  loop
    execute format('update %I.%I set %I = array(select case when lower(x)=lower($1) then $2 else x end from unnest(coalesce(%I, ''{}''::text[])) x) where exists (select 1 from unnest(coalesce(%I, ''{}''::text[])) x where lower(x)=lower($1))', rec.table_schema, rec.table_name, rec.column_name, rec.column_name, rec.column_name)
      using old_name, new_name;
  end loop;

  if target_player_id is not null then
    for rec in
      select c.table_schema, c.table_name, c.column_name
      from information_schema.columns c
      where c.table_schema='public'
        and c.column_name in ('player_name','display_name')
        and exists (
          select 1 from information_schema.columns c2
          where c2.table_schema = c.table_schema
            and c2.table_name = c.table_name
            and c2.column_name = 'player_id'
        )
    loop
      execute format('update %I.%I set %I = $1 where player_id = $2', rec.table_schema, rec.table_name, rec.column_name)
        using new_name, target_player_id;
    end loop;
  end if;
end;
$$;

grant execute on function public._replace_player_name_references(text,text,bigint) to anon, authenticated;

drop function if exists public.admin_remove_allowed_username(text,bigint);
create or replace function public.admin_remove_allowed_username(
  admin_session_token text,
  allowed_username_id_input bigint
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row record;
begin
  perform public.admin_check_session(admin_session_token);

  if allowed_username_id_input is null then
    raise exception 'allowed_username_id ontbreekt';
  end if;

  select * into v_row from public.allowed_usernames where id = allowed_username_id_input;
  if not found then
    raise exception 'Naam niet gevonden';
  end if;

  perform public._clear_player_account_access(v_row.player_id);

  update public.allowed_usernames
     set status = 'archived',
         reserved_for_email = null,
         updated_at = now()
   where id = allowed_username_id_input;

  return jsonb_build_object('ok', true, 'removed', true, 'mode', 'archived_account', 'player_id', v_row.player_id);
end;
$$;

grant execute on function public.admin_remove_allowed_username(text,bigint) to anon, authenticated;

create or replace function public.admin_permanently_delete_allowed_username(
  admin_session_token text,
  allowed_username_id_input bigint
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row record;
  v_old_name text;
  v_placeholder text;
  v_sets text[] := array[]::text[];
  v_sql text;
  v_slug text;
begin
  perform public.admin_check_session(admin_session_token);

  if allowed_username_id_input is null then
    raise exception 'allowed_username_id ontbreekt';
  end if;

  select * into v_row from public.allowed_usernames where id = allowed_username_id_input;
  if not found then
    raise exception 'Naam niet gevonden';
  end if;

  v_old_name := coalesce(v_row.display_name, v_row.username, 'Onbekend');
  v_placeholder := public._next_spookinoza_name();
  v_slug := lower(replace(v_placeholder, ' ', '-'));

  perform public._clear_player_account_access(v_row.player_id);
  perform public._replace_player_name_references(v_old_name, v_placeholder, v_row.player_id);

  if v_row.player_id is not null and exists (select 1 from information_schema.tables where table_schema='public' and table_name='players') then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='display_name') then v_sets := array_append(v_sets, format('display_name = %L', v_placeholder)); end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='username') then v_sets := array_append(v_sets, format('username = %L', v_slug)); end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='slug') then v_sets := array_append(v_sets, format('slug = %L', v_slug)); end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='status') then v_sets := array_append(v_sets, 'status = ''ghosted'''); end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='updated_at') then v_sets := array_append(v_sets, 'updated_at = now()'); end if;
    if array_length(v_sets,1) is not null then
      v_sql := 'update public.players set ' || array_to_string(v_sets, ', ') || ' where id = $1';
      execute v_sql using v_row.player_id;
    end if;
  end if;

  update public.allowed_usernames
     set status = 'retired_permanently',
         reserved_for_email = null,
         reserved_for_person_note = coalesce(reserved_for_person_note, '') || case when coalesce(reserved_for_person_note,'')='' then '' else ' · ' end || 'permanent verwijderd',
         updated_at = now()
   where id = allowed_username_id_input;

  return jsonb_build_object('ok', true, 'placeholder_name', v_placeholder, 'player_id', v_row.player_id);
end;
$$;

grant execute on function public.admin_permanently_delete_allowed_username(text,bigint) to anon, authenticated;

create or replace function public.admin_batch_update_drink_event_entries(
  admin_session_token text,
  drink_event_ids_input bigint[],
  new_status_input text
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_group_id bigint;
  v_status text := lower(trim(coalesce(new_status_input,'pending')));
begin
  perform public.admin_check_session(admin_session_token);
  if coalesce(array_length(drink_event_ids_input,1),0) = 0 then
    raise exception 'Geen drinks-events geselecteerd';
  end if;
  insert into public.admin_drinks_action_groups(action_kind, entity_kind) values ('batch_status', 'drink_event') returning id into v_group_id;
  insert into public.admin_drinks_action_items(action_group_id, entity_kind, entity_id, previous_status, next_status)
  select v_group_id, 'drink_event', de.id, coalesce(de.status,'pending'), v_status
  from public.drink_events de where de.id = any(drink_event_ids_input);
  update public.drink_events de
     set status = v_status
   where de.id = any(drink_event_ids_input);
  return jsonb_build_object('ok', true, 'action_group_id', v_group_id, 'affected', coalesce(array_length(drink_event_ids_input,1),0));
end;
$$;

grant execute on function public.admin_batch_update_drink_event_entries(text,bigint[],text) to anon, authenticated;

create or replace function public.admin_batch_update_drink_speed_attempt_entries(
  admin_session_token text,
  attempt_ids_input bigint[],
  new_status_input text
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_group_id bigint;
  v_status text := lower(trim(coalesce(new_status_input,'pending')));
begin
  perform public.admin_check_session(admin_session_token);
  if coalesce(array_length(attempt_ids_input,1),0) = 0 then
    raise exception 'Geen snelheidspogingen geselecteerd';
  end if;
  insert into public.admin_drinks_action_groups(action_kind, entity_kind) values ('batch_status', 'speed_attempt') returning id into v_group_id;
  insert into public.admin_drinks_action_items(action_group_id, entity_kind, entity_id, previous_status, next_status)
  select v_group_id, 'speed_attempt', dsa.id, coalesce(to_jsonb(dsa)->>'status','pending'), v_status
  from public.drink_speed_attempts dsa where dsa.id = any(attempt_ids_input);
  update public.drink_speed_attempts dsa
     set status = v_status
   where dsa.id = any(attempt_ids_input);
  return jsonb_build_object('ok', true, 'action_group_id', v_group_id, 'affected', coalesce(array_length(attempt_ids_input,1),0));
end;
$$;

grant execute on function public.admin_batch_update_drink_speed_attempt_entries(text,bigint[],text) to anon, authenticated;

create or replace function public.admin_undo_drinks_action(
  admin_session_token text,
  action_group_id_input bigint
)
returns jsonb
language plpgsql
security definer
as $$
declare
  rec record;
begin
  perform public.admin_check_session(admin_session_token);
  if action_group_id_input is null then
    raise exception 'action_group_id ontbreekt';
  end if;

  for rec in
    select * from public.admin_drinks_action_items where action_group_id = action_group_id_input order by id desc
  loop
    if rec.entity_kind = 'drink_event' then
      update public.drink_events set status = coalesce(rec.previous_status,'pending') where id = rec.entity_id;
    elsif rec.entity_kind = 'speed_attempt' then
      update public.drink_speed_attempts set status = coalesce(rec.previous_status,'pending') where id = rec.entity_id;
    end if;
  end loop;

  update public.admin_drinks_action_groups set undone_at = now() where id = action_group_id_input;
  return jsonb_build_object('ok', true, 'action_group_id', action_group_id_input);
end;
$$;

grant execute on function public.admin_undo_drinks_action(text,bigint) to anon, authenticated;

create or replace function public.admin_delete_drink_event_entry(admin_session_token text, drink_event_id_input bigint)
returns jsonb language plpgsql security definer as $$
declare
  v_res jsonb;
begin
  v_res := public.admin_batch_update_drink_event_entries(admin_session_token, array[drink_event_id_input], 'deleted');
  return jsonb_build_object('ok', true, 'id', drink_event_id_input, 'action_group_id', v_res->>'action_group_id');
end;
$$;

grant execute on function public.admin_delete_drink_event_entry(text,bigint) to anon, authenticated;

create or replace function public.admin_delete_drink_speed_attempt_entry(admin_session_token text, attempt_id_input bigint)
returns jsonb language plpgsql security definer as $$
declare
  v_res jsonb;
begin
  v_res := public.admin_batch_update_drink_speed_attempt_entries(admin_session_token, array[attempt_id_input], 'deleted');
  return jsonb_build_object('ok', true, 'id', attempt_id_input, 'action_group_id', v_res->>'action_group_id');
end;
$$;

grant execute on function public.admin_delete_drink_speed_attempt_entry(text,bigint) to anon, authenticated;

create or replace function public.create_drink_speed_attempt(
  session_token text,
  client_attempt_id text,
  event_type_key text,
  quantity numeric default 1,
  duration_seconds numeric default null,
  lat double precision default null,
  lng double precision default null,
  accuracy double precision default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_player_id bigint;
  v_player_name text;
  v_speed_type_id bigint;
  v_units numeric := 0;
  v_insert_cols text[] := array[]::text[];
  v_insert_vals text[] := array[]::text[];
  v_sql text;
  v_speed_id bigint;
begin
  if duration_seconds is null or duration_seconds <= 0 then
    raise exception 'Vul een geldige snelheidstijd in.';
  end if;
  v_player_id := public._resolve_player_id_from_session_token(session_token);
  if v_player_id is null then
    raise exception 'Niet ingelogd.';
  end if;
  select coalesce(to_jsonb(p)->>'display_name', to_jsonb(p)->>'username', to_jsonb(p)->>'slug', 'Onbekend') into v_player_name from public.players p where p.id = v_player_id limit 1;
  select dst.id, coalesce(det.unit_value,0) into v_speed_type_id, v_units
  from public.drink_speed_types dst
  left join public.drink_event_types det on lower(det.key) = lower(dst.key)
  where dst.key = event_type_key limit 1;
  if v_speed_type_id is null then
    raise exception 'Geen snelheidstype gevonden voor %.', event_type_key;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='client_attempt_id') then
    v_insert_cols := array_append(v_insert_cols, 'client_attempt_id');
    v_insert_vals := array_append(v_insert_vals, format('%L', coalesce(nullif(client_attempt_id,''), md5(random()::text || clock_timestamp()::text))));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='player_id') then v_insert_cols := array_append(v_insert_cols, 'player_id'); v_insert_vals := array_append(v_insert_vals, format('%s', v_player_id)); end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='player_name') then v_insert_cols := array_append(v_insert_cols, 'player_name'); v_insert_vals := array_append(v_insert_vals, format('%L', v_player_name)); end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='speed_type_id') then v_insert_cols := array_append(v_insert_cols, 'speed_type_id'); v_insert_vals := array_append(v_insert_vals, format('%s', v_speed_type_id)); end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='event_type_key') then v_insert_cols := array_append(v_insert_cols, 'event_type_key'); v_insert_vals := array_append(v_insert_vals, format('%L', event_type_key)); end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='event_type_label') then v_insert_cols := array_append(v_insert_cols, 'event_type_label'); v_insert_vals := array_append(v_insert_vals, format('%L', coalesce((select label from public.drink_event_types where lower(key)=lower(event_type_key) limit 1), event_type_key))); end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='quantity') then v_insert_cols := array_append(v_insert_cols, 'quantity'); v_insert_vals := array_append(v_insert_vals, format('%s', coalesce(quantity,1))); end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='total_units') then v_insert_cols := array_append(v_insert_cols, 'total_units'); v_insert_vals := array_append(v_insert_vals, format('%s', round((coalesce(quantity,1) * coalesce(v_units,0))::numeric,1))); end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='duration_seconds') then v_insert_cols := array_append(v_insert_cols, 'duration_seconds'); v_insert_vals := array_append(v_insert_vals, format('%s', duration_seconds)); end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='status') then v_insert_cols := array_append(v_insert_cols, 'status'); v_insert_vals := array_append(v_insert_vals, quote_literal('pending')); end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='lat') and lat is not null then v_insert_cols := array_append(v_insert_cols, 'lat'); v_insert_vals := array_append(v_insert_vals, format('%s', lat)); end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='lng') and lng is not null then v_insert_cols := array_append(v_insert_cols, 'lng'); v_insert_vals := array_append(v_insert_vals, format('%s', lng)); end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='accuracy') and accuracy is not null then v_insert_cols := array_append(v_insert_cols, 'accuracy'); v_insert_vals := array_append(v_insert_vals, format('%s', accuracy)); end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='created_at') then v_insert_cols := array_append(v_insert_cols, 'created_at'); v_insert_vals := array_append(v_insert_vals, 'now()'); end if;
  v_sql := format('insert into public.drink_speed_attempts (%s) values (%s) returning id', array_to_string(v_insert_cols, ', '), array_to_string(v_insert_vals, ', '));
  execute v_sql into v_speed_id;
  return jsonb_build_object('ok', true, 'speed_attempt_id', v_speed_id, 'linked', false);
end;
$$;

grant execute on function public.create_drink_speed_attempt(text,text,text,numeric,numeric,double precision,double precision,double precision) to anon, authenticated;

drop function if exists public.create_combined_drink_speed_attempt(text,text,numeric,numeric,double precision,double precision,double precision);
drop function if exists public.create_combined_drink_speed_attempt(text,text,text,numeric,numeric,double precision,double precision,double precision);
create or replace function public.create_combined_drink_speed_attempt(
  session_token text,
  client_attempt_id text,
  event_type_key text,
  quantity numeric default 1,
  duration_seconds numeric default null,
  lat double precision default null,
  lng double precision default null,
  accuracy double precision default null
)
returns jsonb
language plpgsql
security definer
as $$
begin
  return public.create_drink_speed_attempt(session_token, client_attempt_id, event_type_key, quantity, duration_seconds, lat, lng, accuracy);
end;
$$;

grant execute on function public.create_combined_drink_speed_attempt(text,text,text,numeric,numeric,double precision,double precision,double precision) to anon, authenticated;

insert into public.allowed_usernames (username, display_name, status)
select lower(regexp_replace(name,'[^a-zA-Z0-9]+','','g')), name, 'available'
from (values ('Yago'),('Petter'),('Thibault'),('Joris')) t(name)
where exists (select 1 from information_schema.tables where table_schema='public' and table_name='allowed_usernames')
  and not exists (select 1 from public.allowed_usernames au where lower(au.display_name)=lower(t.name) or lower(au.username)=lower(regexp_replace(t.name,'[^a-zA-Z0-9]+','','g')));

commit;

begin;

-- v236 follow-up: remove create_combined overload ambiguity, extend vote window,
-- keep votes open longer, and resolve ties to verify.

drop function if exists public.create_combined_drink_speed_attempt(text,text,numeric,numeric,double precision,double precision,double precision);
drop function if exists public.create_combined_drink_speed_attempt(text,text,numeric,numeric,numeric,numeric,numeric);
drop function if exists public.create_combined_drink_speed_attempt(text,text,numeric,numeric,numeric,numeric,numeric,text);
drop function if exists public.create_combined_drink_speed_attempt(text,text,text,numeric,numeric,double precision,double precision,double precision);
drop function if exists public.create_combined_drink_speed_attempt(text,text,numeric,numeric,double precision,double precision,double precision,text);

create or replace function public.create_combined_drink_speed_attempt(
  session_token text,
  client_attempt_id text,
  event_type_key text,
  quantity numeric default 1,
  duration_seconds numeric default null,
  lat double precision default null,
  lng double precision default null,
  accuracy double precision default null
)
returns jsonb
language plpgsql
security definer
as $$
begin
  return public.create_drink_speed_attempt(session_token, client_attempt_id, event_type_key, quantity, duration_seconds, lat, lng, accuracy);
end;
$$;

grant execute on function public.create_combined_drink_speed_attempt(text,text,text,numeric,numeric,double precision,double precision,double precision) to anon, authenticated;

create or replace function public.finalize_expired_drink_event_votes()
returns integer
language plpgsql
security definer
as $$
declare
  v_count integer := 0;
  rec record;
  v_sets text[];
  v_sql text;
  v_verified_by bigint;
begin
  if to_regclass('public.drink_event_verifications') is null or to_regclass('public.drink_events') is null then
    return 0;
  end if;

  for rec in
    with vote_rollup as (
      select
        dev.drink_event_id,
        min(coalesce(dev.created_at, now())) as first_vote_at,
        count(*) filter (where coalesce(dev.approved, false) is true) as approve_votes,
        count(*) filter (where coalesce(dev.approved, false) is false) as reject_votes
      from public.drink_event_verifications dev
      group by 1
    )
    select
      vr.drink_event_id,
      case when vr.reject_votes > vr.approve_votes then 'rejected' else 'verified' end as final_status
    from vote_rollup vr
    join public.drink_events de on de.id = vr.drink_event_id
    where coalesce(to_jsonb(de)->>'status','pending') = 'pending'
      and vr.first_vote_at <= now() - interval '180 seconds'
  loop
    v_sets := array[format('status = %L', rec.final_status)];
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='updated_at') then
      v_sets := array_append(v_sets, 'updated_at = now()');
    end if;
    if rec.final_status = 'verified' and exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='verified_at') then
      v_sets := array_append(v_sets, 'verified_at = now()');
    end if;
    if rec.final_status = 'verified' and exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='verified_by_player_id') then
      select dev.verifier_player_id
        into v_verified_by
      from public.drink_event_verifications dev
      where dev.drink_event_id = rec.drink_event_id
        and coalesce(dev.approved, false) is true
      order by coalesce(dev.created_at, now()) asc
      limit 1;
      if v_verified_by is not null then
        v_sets := array_append(v_sets, format('verified_by_player_id = %s', v_verified_by));
      end if;
    end if;
    v_sql := 'update public.drink_events set ' || array_to_string(v_sets, ', ') || format(' where id = %s', rec.drink_event_id);
    execute v_sql;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

grant execute on function public.finalize_expired_drink_event_votes() to anon, authenticated;

create or replace function public.verify_drink_event(
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
  v_sql text;
  v_already_by_you boolean := false;
  v_approve_votes integer := 0;
  v_reject_votes integer := 0;
  v_first_vote_at timestamptz;
  v_window_ends_at timestamptz;
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

  perform public.finalize_expired_drink_event_votes();
  select coalesce(to_jsonb(de)->>'status','pending') into v_event_status from public.drink_events de where de.id = v_event_id;
  if v_event_status <> 'pending' then
    return jsonb_build_object('ok', true, 'id', v_event_id, 'status', v_event_status, 'already', true);
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

  perform public.finalize_expired_drink_event_votes();

  select
    min(coalesce(dev.created_at, now())),
    count(*) filter (where coalesce(dev.approved, false) is true),
    count(*) filter (where coalesce(dev.approved, false) is false)
    into v_first_vote_at, v_approve_votes, v_reject_votes
  from public.drink_event_verifications dev
  where dev.drink_event_id = v_event_id;

  if v_first_vote_at is not null and v_first_vote_at <= now() - interval '180 seconds' then
    perform public.finalize_expired_drink_event_votes();
  end if;

  select coalesce(to_jsonb(de)->>'status','pending') into v_event_status from public.drink_events de where de.id = v_event_id;
  v_window_ends_at := case when v_first_vote_at is null then null else v_first_vote_at + interval '180 seconds' end;

  return jsonb_build_object(
    'ok', true,
    'id', v_event_id,
    'status', v_event_status,
    'approve_votes', v_approve_votes,
    'reject_votes', v_reject_votes,
    'already_verified_by_you', v_already_by_you,
    'vote_window_ends_at', v_window_ends_at,
    'tie_rule', 'verify'
  );
end;
$$;

grant execute on function public.verify_drink_event(text,bigint,numeric,numeric,numeric,boolean,text) to anon, authenticated;

create or replace function public.finalize_expired_drink_speed_votes()
returns integer
language plpgsql
security definer
as $$
declare
  v_count integer := 0;
  rec record;
  v_sets text[];
  v_sql text;
begin
  if to_regclass('public.drink_speed_verifications') is null or to_regclass('public.drink_speed_attempts') is null then
    return 0;
  end if;

  for rec in
    with vote_rollup as (
      select
        coalesce(nullif(to_jsonb(dsv)->>'speed_attempt_id','')::bigint, nullif(to_jsonb(dsv)->>'attempt_id','')::bigint) as speed_attempt_id,
        min(coalesce(dsv.created_at, now())) as first_vote_at,
        count(*) filter (where coalesce(nullif(to_jsonb(dsv)->>'approved','')::boolean, false) = true) as approve_votes,
        count(*) filter (where coalesce(nullif(to_jsonb(dsv)->>'approved','')::boolean, false) = false) as reject_votes
      from public.drink_speed_verifications dsv
      group by 1
    )
    select
      vr.speed_attempt_id,
      case when vr.reject_votes > vr.approve_votes then 'rejected' else 'verified' end as final_status
    from vote_rollup vr
    join public.drink_speed_attempts dsa on dsa.id = vr.speed_attempt_id
    where coalesce(to_jsonb(dsa)->>'status','pending') = 'pending'
      and vr.first_vote_at <= now() - interval '180 seconds'
  loop
    v_sets := array[format('status = %L', rec.final_status)];
    if rec.final_status = 'verified' and exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='verified_at') then
      v_sets := array_append(v_sets, 'verified_at = now()');
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='updated_at') then
      v_sets := array_append(v_sets, 'updated_at = now()');
    end if;
    v_sql := 'update public.drink_speed_attempts set ' || array_to_string(v_sets, ', ') || format(' where id = %s', rec.speed_attempt_id);
    execute v_sql;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.finalize_expired_drink_speed_votes() to anon, authenticated;

create or replace function public.verify_drink_speed_attempt(
  session_token text,
  attempt_id bigint,
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
  v_attempt_id bigint := attempt_id;
  v_player_id bigint;
  v_attempt jsonb;
  v_attempt_player_id bigint;
  v_status text;
  v_verifier_player_name text;
  v_insert_cols text[] := array[]::text[];
  v_insert_vals text[] := array[]::text[];
  v_sql text;
  v_approve_count integer := 0;
  v_reject_count integer := 0;
  v_first_vote_at timestamptz;
  v_window_ends_at timestamptz;
begin
  v_player_id := public._resolve_player_id_from_session_token(session_token);
  if v_player_id is null then
    raise exception 'Niet ingelogd.';
  end if;

  select coalesce(to_jsonb(p)->>'display_name', to_jsonb(p)->>'username', to_jsonb(p)->>'slug', 'Onbekend')
    into v_verifier_player_name
  from public.players p
  where p.id = v_player_id
  limit 1;

  perform public.finalize_expired_drink_speed_votes();

  select to_jsonb(t) into v_attempt
  from (select * from public.drink_speed_attempts dsa where dsa.id = v_attempt_id limit 1) t;

  if v_attempt is null then
    raise exception 'Snelheidspoging niet gevonden.';
  end if;

  v_attempt_player_id := nullif(v_attempt->>'player_id','')::bigint;
  v_status := coalesce(v_attempt->>'status','pending');

  if v_attempt_player_id is not null and v_attempt_player_id = v_player_id then
    raise exception 'Je kunt je eigen snelheidspoging niet bevestigen.';
  end if;

  if v_status <> 'pending' then
    return jsonb_build_object('ok', true, 'id', v_attempt_id, 'status', v_status, 'already', true);
  end if;

  if exists (
    select 1 from public.drink_speed_verifications dsv
    where coalesce(nullif(to_jsonb(dsv)->>'speed_attempt_id','')::bigint, nullif(to_jsonb(dsv)->>'attempt_id','')::bigint) = v_attempt_id
      and dsv.verifier_player_id = v_player_id
  ) then
    return jsonb_build_object('ok', true, 'id', v_attempt_id, 'status', v_status, 'already_verified_by_you', true);
  end if;

  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='drink_speed_verifications') then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='speed_attempt_id') then
      v_insert_cols := array_append(v_insert_cols, 'speed_attempt_id');
      v_insert_vals := array_append(v_insert_vals, format('%s', v_attempt_id));
    elsif exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='attempt_id') then
      v_insert_cols := array_append(v_insert_cols, 'attempt_id');
      v_insert_vals := array_append(v_insert_vals, format('%s', v_attempt_id));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='verifier_player_id') then
      v_insert_cols := array_append(v_insert_cols, 'verifier_player_id');
      v_insert_vals := array_append(v_insert_vals, format('%s', v_player_id));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='verifier_player_name') then
      v_insert_cols := array_append(v_insert_cols, 'verifier_player_name');
      v_insert_vals := array_append(v_insert_vals, format('%L', coalesce(v_verifier_player_name,'Onbekend')));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='approved') then
      v_insert_cols := array_append(v_insert_cols, 'approved');
      v_insert_vals := array_append(v_insert_vals, case when approve then 'true' else 'false' end);
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='reason') then
      v_insert_cols := array_append(v_insert_cols, 'reason');
      v_insert_vals := array_append(v_insert_vals, format('%L', reason));
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_verifications' and column_name='created_at') then
      v_insert_cols := array_append(v_insert_cols, 'created_at');
      v_insert_vals := array_append(v_insert_vals, 'now()');
    end if;
    if array_length(v_insert_cols,1) is not null then
      v_sql := format('insert into public.drink_speed_verifications (%s) values (%s)', array_to_string(v_insert_cols, ', '), array_to_string(v_insert_vals, ', '));
      execute v_sql;
    end if;
  end if;

  perform public.finalize_expired_drink_speed_votes();

  select
    min(coalesce(dsv.created_at, now())),
    count(*) filter (where coalesce(nullif(to_jsonb(dsv)->>'approved','')::boolean, false) = true),
    count(*) filter (where coalesce(nullif(to_jsonb(dsv)->>'approved','')::boolean, false) = false)
    into v_first_vote_at, v_approve_count, v_reject_count
  from public.drink_speed_verifications dsv
  where coalesce(nullif(to_jsonb(dsv)->>'speed_attempt_id','')::bigint, nullif(to_jsonb(dsv)->>'attempt_id','')::bigint) = v_attempt_id;

  if v_first_vote_at is not null and v_first_vote_at <= now() - interval '180 seconds' then
    perform public.finalize_expired_drink_speed_votes();
  end if;

  select coalesce(to_jsonb(dsa)->>'status','pending') into v_status from public.drink_speed_attempts dsa where dsa.id = v_attempt_id;
  v_window_ends_at := case when v_first_vote_at is null then null else v_first_vote_at + interval '180 seconds' end;

  return jsonb_build_object(
    'ok', true,
    'id', v_attempt_id,
    'status', v_status,
    'approve_votes', v_approve_count,
    'reject_votes', v_reject_count,
    'vote_window_ends_at', v_window_ends_at,
    'tie_rule', 'verify'
  );
end;
$$;

grant execute on function public.verify_drink_speed_attempt(text,bigint,numeric,numeric,numeric,boolean,text) to anon, authenticated;

commit;
