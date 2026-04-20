-- GEJAST / Kale Nel
-- v596 Klaverjas persistence, snapshots, spectator live flow, quick stats, and derived stats views
-- Whole-state sync model based on the v596 scorer prototype payload.

create extension if not exists pgcrypto;

create table if not exists public.klaverjas_matches (
  id uuid primary key default gen_random_uuid(),
  site_scope text not null default 'friends',
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  status text not null default 'active' check (status in ('active','abandoned','finished')),
  total_rounds_played integer not null default 0,
  total_takken_played integer not null default 0,
  progress_ratio numeric(8,4) not null default 0,
  elo_scale_applied numeric(8,4) not null default 0,
  team_w_player_ids jsonb not null default '[]'::jsonb,
  team_z_player_ids jsonb not null default '[]'::jsonb,
  team_w_player_names jsonb not null default '[]'::jsonb,
  team_z_player_names jsonb not null default '[]'::jsonb,
  final_score_w integer not null default 0,
  final_score_z integer not null default 0,
  final_raw_w integer not null default 0,
  final_raw_z integer not null default 0,
  total_roem_w integer not null default 0,
  total_roem_z integer not null default 0,
  kruipen_side text null check (kruipen_side in ('W','Z')),
  naakt_kruipen_side text null check (naakt_kruipen_side in ('W','Z')),
  winner_side text null check (winner_side in ('W','Z')),
  theoretical_full_delta integer null,
  actual_delta integer null,
  payload_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists klaverjas_matches_scope_status_idx on public.klaverjas_matches(site_scope, status, started_at desc);
create index if not exists klaverjas_matches_updated_idx on public.klaverjas_matches(updated_at desc);

create table if not exists public.klaverjas_rounds (
  id bigserial primary key,
  match_id uuid not null references public.klaverjas_matches(id) on delete cascade,
  round_no integer not null,
  tak_no integer not null,
  round_in_tak integer not null,
  bid_team text not null check (bid_team in ('W','Z')),
  bid_value integer not null,
  suit text not null,
  base_points_w integer not null default 0,
  base_points_z integer not null default 0,
  roem_w integer not null default 0,
  roem_z integer not null default 0,
  nat_by text null check (nat_by in ('W','Z')),
  pit_by text null check (pit_by in ('W','Z')),
  verzaakt_by text null check (verzaakt_by in ('W','Z')),
  awarded_raw_w integer not null default 0,
  awarded_raw_z integer not null default 0,
  awarded_ladder_w integer not null default 0,
  awarded_ladder_z integer not null default 0,
  dealer_player text null,
  forehand_player text null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(match_id, round_no)
);

create index if not exists klaverjas_rounds_match_round_idx on public.klaverjas_rounds(match_id, round_no);

create table if not exists public.klaverjas_match_snapshots (
  id bigserial primary key,
  match_id uuid not null references public.klaverjas_matches(id) on delete cascade,
  snapshot_no integer not null,
  round_count integer not null,
  tak_count integer not null,
  progress_ratio numeric(8,4) not null,
  elo_scale numeric(8,4) not null,
  serialized_score_state jsonb not null,
  created_at timestamptz not null default now(),
  unique(match_id, snapshot_no)
);

create index if not exists klaverjas_match_snapshots_match_idx on public.klaverjas_match_snapshots(match_id, snapshot_no desc);

create table if not exists public.klaverjas_active_match_presence (
  id bigserial primary key,
  site_scope text not null default 'friends',
  session_token text not null,
  player_name text null,
  match_id uuid not null references public.klaverjas_matches(id) on delete cascade,
  page_kind text not null default 'scorer',
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(session_token, match_id)
);

create index if not exists klaverjas_active_presence_session_idx on public.klaverjas_active_match_presence(session_token, last_seen_at desc);
create index if not exists klaverjas_active_presence_match_idx on public.klaverjas_active_match_presence(match_id, last_seen_at desc);

create or replace function public._klaverjas_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_klaverjas_matches_touch_updated_at on public.klaverjas_matches;
create trigger trg_klaverjas_matches_touch_updated_at
before update on public.klaverjas_matches
for each row execute function public._klaverjas_touch_updated_at();

drop trigger if exists trg_klaverjas_rounds_touch_updated_at on public.klaverjas_rounds;
create trigger trg_klaverjas_rounds_touch_updated_at
before update on public.klaverjas_rounds
for each row execute function public._klaverjas_touch_updated_at();

create or replace function public._klaverjas_safe_scope(scope_in text)
returns text
language sql
immutable
as $$
  select case when lower(coalesce(scope_in,'')) = 'family' then 'family' else 'friends' end
$$;

create or replace function public._klaverjas_progress_scale(round_count integer)
returns numeric
language sql
immutable
as $$
  select case
    when coalesce(round_count, 0) < 8 then 0
    else greatest(0.25::numeric, least(1::numeric, coalesce(round_count,0)::numeric / 16::numeric))
  end
$$;

create or replace function public._klaverjas_tak_count(round_count integer)
returns integer
language sql
immutable
as $$
  select case when coalesce(round_count,0) <= 0 then 0 else least(4, ceil(coalesce(round_count,0)::numeric / 4.0)::integer) end
$$;

create or replace function public._klaverjas_kruip_side(score_w integer, score_z integer)
returns text
language sql
immutable
as $$
  select case
    when coalesce(score_w,0) > coalesce(score_z,0) and coalesce(score_z,0) * 2 < coalesce(score_w,0) then 'Z'
    when coalesce(score_z,0) > coalesce(score_w,0) and coalesce(score_w,0) * 2 < coalesce(score_z,0) then 'W'
    else null
  end
$$;

create or replace function public._klaverjas_naakt_kruip_side(score_w integer, score_z integer)
returns text
language sql
immutable
as $$
  select case
    when coalesce(score_w,0) > coalesce(score_z,0) and coalesce(score_z,0) * 3 < coalesce(score_w,0) then 'Z'
    when coalesce(score_z,0) > coalesce(score_w,0) and coalesce(score_w,0) * 3 < coalesce(score_z,0) then 'W'
    else null
  end
$$;

create or replace function public._klaverjas_dealer_name(order_json jsonb, round_no integer)
returns text
language sql
immutable
as $$
  select case
    when jsonb_typeof(order_json) <> 'array' or jsonb_array_length(order_json) = 0 or coalesce(round_no,0) <= 0 then null
    else order_json ->> (((round_no - 1) % jsonb_array_length(order_json)))
  end
$$;

create or replace function public._klaverjas_forehand_name(order_json jsonb, round_no integer)
returns text
language sql
immutable
as $$
  select case
    when jsonb_typeof(order_json) <> 'array' or jsonb_array_length(order_json) = 0 or coalesce(round_no,0) <= 0 then null
    else order_json ->> (((round_no) % jsonb_array_length(order_json)))
  end
$$;

create or replace function public._klaverjas_match_players(match_row public.klaverjas_matches)
returns table(player_name text, side text)
language sql
stable
as $$
  select value::text, 'W'::text from jsonb_array_elements_text(coalesce(match_row.team_w_player_names, '[]'::jsonb))
  union all
  select value::text, 'Z'::text from jsonb_array_elements_text(coalesce(match_row.team_z_player_names, '[]'::jsonb))
$$;

create or replace view public.klaverjas_match_player_rows as
select m.id as match_id,
       m.site_scope,
       p.player_name,
       p.side,
       m.status,
       m.started_at,
       m.finished_at,
       m.progress_ratio,
       m.elo_scale_applied,
       m.final_score_w,
       m.final_score_z,
       m.final_raw_w,
       m.final_raw_z,
       m.total_roem_w,
       m.total_roem_z,
       m.winner_side,
       m.kruipen_side,
       m.naakt_kruipen_side
from public.klaverjas_matches m
cross join lateral public._klaverjas_match_players(m) p;

create or replace view public.klaverjas_player_stats_v as
with player_matches as (
  select r.*,
         case when r.side = 'W' then r.final_score_w else r.final_score_z end as player_final_score,
         case when r.side = 'W' then r.final_raw_w else r.final_raw_z end as player_final_raw,
         case when r.side = 'W' then r.total_roem_w else r.total_roem_z end as player_roem,
         case when r.side = 'W' then r.final_score_z else r.final_score_w end as opponent_final_score,
         case when r.side = 'W' then r.total_roem_z else r.total_roem_w end as opponent_roem
  from public.klaverjas_match_player_rows r
),
round_player_stats as (
  select m.site_scope,
         p.player_name,
         p.side,
         count(*) filter (where (p.side = 'W' and coalesce(r.awarded_ladder_w,0) > coalesce(r.awarded_ladder_z,0)) or (p.side = 'Z' and coalesce(r.awarded_ladder_z,0) > coalesce(r.awarded_ladder_w,0))) as rounds_won,
         sum(case when p.side = 'W' and coalesce(r.awarded_ladder_w,0) > coalesce(r.awarded_ladder_z,0) and r.round_in_tak = 4 then 1 when p.side = 'Z' and coalesce(r.awarded_ladder_z,0) > coalesce(r.awarded_ladder_w,0) and r.round_in_tak = 4 then 1 else 0 end) as takken_won,
         sum(case when p.side = r.bid_team and r.suit = '♥' then 1 else 0 end) as bids_hearts,
         sum(case when p.side = r.bid_team and r.suit = '♦' then 1 else 0 end) as bids_diamonds,
         sum(case when p.side = r.bid_team and r.suit = '♣' then 1 else 0 end) as bids_clubs,
         sum(case when p.side = r.bid_team and r.suit = '♠' then 1 else 0 end) as bids_spades,
         sum(case when p.side = r.bid_team and r.suit = 'S' then 1 else 0 end) as bids_sans,
         max(case when p.side = r.bid_team and r.nat_by is null and r.verzaakt_by is null then r.bid_value end) as highest_successful_bid,
         max(case when p.side = r.bid_team and (r.nat_by is not null or r.verzaakt_by is not null) then r.bid_value end) as highest_failed_bid,
         sum(case when r.nat_by = p.side then 1 else 0 end) as nat_given,
         sum(case when r.nat_by is not null and r.nat_by <> p.side then 1 else 0 end) as nat_suffered,
         sum(case when r.pit_by = p.side then 1 else 0 end) as pit_given,
         sum(case when r.pit_by is not null and r.pit_by <> p.side then 1 else 0 end) as pit_suffered,
         sum(case when r.verzaakt_by = p.side then 1 else 0 end) as verzaakt_committed,
         sum(case when r.verzaakt_by is not null and r.verzaakt_by <> p.side then 1 else 0 end) as verzaakt_suffered_from_opponent,
         sum(case when m.kruipen_side is not null and m.kruipen_side <> p.side then 1 else 0 end) as kruipen_forced_on_opponent,
         sum(case when m.kruipen_side = p.side then 1 else 0 end) as kruipen_suffered,
         sum(case when m.naakt_kruipen_side is not null and m.naakt_kruipen_side <> p.side then 1 else 0 end) as naakt_kruipen_forced_on_opponent,
         sum(case when m.naakt_kruipen_side = p.side then 1 else 0 end) as naakt_kruipen_suffered
  from public.klaverjas_rounds r
  join public.klaverjas_matches m on m.id = r.match_id
  join public.klaverjas_match_player_rows p on p.match_id = r.match_id
  group by m.site_scope, p.player_name, p.side
)
select pm.site_scope,
       pm.player_name,
       count(*) as matches_played,
       count(*) filter (where pm.winner_side = pm.side) as matches_won,
       coalesce(sum(rps.rounds_won),0) as rounds_won,
       coalesce(sum(rps.takken_won),0) as takken_won,
       round(avg(pm.player_final_score)::numeric, 2) as average_final_score,
       sum(pm.player_roem) as total_roem_won,
       coalesce(sum(rps.bids_hearts),0) as total_bids_hearts,
       coalesce(sum(rps.bids_diamonds),0) as total_bids_diamonds,
       coalesce(sum(rps.bids_clubs),0) as total_bids_clubs,
       coalesce(sum(rps.bids_spades),0) as total_bids_spades,
       coalesce(sum(rps.bids_sans),0) as total_bids_sans,
       max(rps.highest_successful_bid) as highest_successful_bid,
       max(rps.highest_failed_bid) as highest_failed_bid,
       coalesce(sum(rps.nat_given),0) as nat_given,
       coalesce(sum(rps.nat_suffered),0) as nat_suffered,
       coalesce(sum(rps.pit_given),0) as pit_given,
       coalesce(sum(rps.pit_suffered),0) as pit_suffered,
       coalesce(sum(rps.verzaakt_committed),0) as verzaakt_committed,
       coalesce(sum(rps.verzaakt_suffered_from_opponent),0) as verzaakt_suffered_from_opponent,
       coalesce(sum(rps.kruipen_forced_on_opponent),0) as kruipen_forced_on_opponent,
       coalesce(sum(rps.kruipen_suffered),0) as kruipen_suffered,
       coalesce(sum(rps.naakt_kruipen_forced_on_opponent),0) as naakt_kruipen_forced_on_opponent,
       coalesce(sum(rps.naakt_kruipen_suffered),0) as naakt_kruipen_suffered,
       count(*) filter (where pm.status = 'abandoned') as abandoned_matches_involved_in,
       count(*) filter (where pm.status = 'abandoned' or coalesce(pm.elo_scale_applied,1) < 1) as partial_elo_matches_involved_in
from player_matches pm
left join round_player_stats rps on rps.site_scope = pm.site_scope and rps.player_name = pm.player_name and rps.side = pm.side
group by pm.site_scope, pm.player_name;

create or replace function public._klaverjas_build_match_json(match_id_input uuid)
returns jsonb
language sql
stable
as $$
  with m as (
    select * from public.klaverjas_matches where id = match_id_input
  ),
  r as (
    select * from public.klaverjas_rounds where match_id = match_id_input order by round_no asc
  ),
  s as (
    select * from public.klaverjas_match_snapshots where match_id = match_id_input order by snapshot_no asc
  )
  select jsonb_build_object(
    'match', (select to_jsonb(m.*) from m),
    'rounds', coalesce((select jsonb_agg(to_jsonb(r.*) order by r.round_no) from r), '[]'::jsonb),
    'snapshots', coalesce((select jsonb_agg(to_jsonb(s.*) order by s.snapshot_no) from s), '[]'::jsonb)
  );
$$;

create or replace function public.klaverjas_upsert_match_state_scoped(
  session_token text default null,
  match_id_input uuid default null,
  site_scope_input text default 'friends',
  team_w_player_ids_input jsonb default '[]'::jsonb,
  team_z_player_ids_input jsonb default '[]'::jsonb,
  team_w_player_names_input jsonb default '[]'::jsonb,
  team_z_player_names_input jsonb default '[]'::jsonb,
  rounds_input jsonb default '[]'::jsonb,
  payload_snapshot_input jsonb default '{}'::jsonb,
  status_input text default 'active',
  started_at_input timestamptz default now()
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_match_id uuid := coalesce(match_id_input, gen_random_uuid());
  v_scope text := public._klaverjas_safe_scope(site_scope_input);
  v_round_count integer := 0;
  v_tak_count integer := 0;
  v_progress numeric(8,4) := 0;
  v_elo_scale numeric(8,4) := 0;
  v_score_w integer := 0;
  v_score_z integer := 0;
  v_raw_w integer := 0;
  v_raw_z integer := 0;
  v_roem_w integer := 0;
  v_roem_z integer := 0;
  v_winner text := null;
  v_status text := case when lower(coalesce(status_input,'')) = 'finished' then 'finished' when lower(coalesce(status_input,'')) = 'abandoned' then 'abandoned' else 'active' end;
  v_player_order jsonb := coalesce(payload_snapshot_input -> 'playerOrder', payload_snapshot_input -> 'player_order', '[]'::jsonb);
  v_snapshot_no integer := 0;
  v_round jsonb;
  v_i integer := 0;
  v_round_score_state jsonb;
begin
  if jsonb_typeof(coalesce(rounds_input, '[]'::jsonb)) <> 'array' then
    raise exception 'rounds_input must be a json array';
  end if;

  insert into public.klaverjas_matches(
    id, site_scope, started_at, status,
    team_w_player_ids, team_z_player_ids,
    team_w_player_names, team_z_player_names,
    payload_snapshot
  ) values (
    v_match_id, v_scope, coalesce(started_at_input, now()), v_status,
    coalesce(team_w_player_ids_input, '[]'::jsonb), coalesce(team_z_player_ids_input, '[]'::jsonb),
    coalesce(team_w_player_names_input, '[]'::jsonb), coalesce(team_z_player_names_input, '[]'::jsonb),
    coalesce(payload_snapshot_input, '{}'::jsonb)
  )
  on conflict (id) do update set
    site_scope = excluded.site_scope,
    status = excluded.status,
    team_w_player_ids = excluded.team_w_player_ids,
    team_z_player_ids = excluded.team_z_player_ids,
    team_w_player_names = excluded.team_w_player_names,
    team_z_player_names = excluded.team_z_player_names,
    payload_snapshot = excluded.payload_snapshot;

  delete from public.klaverjas_rounds where match_id = v_match_id;
  delete from public.klaverjas_match_snapshots where match_id = v_match_id;

  for v_round in
    select value from jsonb_array_elements(coalesce(rounds_input, '[]'::jsonb))
  loop
    v_i := v_i + 1;
    insert into public.klaverjas_rounds(
      match_id, round_no, tak_no, round_in_tak,
      bid_team, bid_value, suit,
      base_points_w, base_points_z,
      roem_w, roem_z,
      nat_by, pit_by, verzaakt_by,
      awarded_raw_w, awarded_raw_z,
      awarded_ladder_w, awarded_ladder_z,
      dealer_player, forehand_player, payload
    ) values (
      v_match_id,
      coalesce(nullif((v_round ->> 'round')::int, null), nullif((v_round ->> 'roundNo')::int, null), v_i),
      coalesce(nullif((v_round ->> 'tak')::int, null), public._klaverjas_tak_count(v_i)),
      coalesce(nullif((v_round ->> 'roundInTak')::int, null), ((v_i - 1) % 4) + 1),
      coalesce(v_round ->> 'team', 'W'),
      coalesce((v_round ->> 'bid')::int, 80),
      coalesce(v_round ->> 'suit', '♠'),
      coalesce((v_round ->> 'baseW')::int, 0),
      coalesce((v_round ->> 'baseZ')::int, 0),
      coalesce((v_round ->> 'roemW')::int, 0),
      coalesce((v_round ->> 'roemZ')::int, 0),
      nullif(v_round ->> 'natBy', ''),
      nullif(v_round ->> 'pitBy', ''),
      nullif(v_round ->> 'verzaaktBy', ''),
      coalesce((v_round ->> 'fw')::int, 0),
      coalesce((v_round ->> 'fz')::int, 0),
      coalesce((v_round ->> 'fw')::int, 0),
      coalesce((v_round ->> 'fz')::int, 0),
      coalesce(v_round ->> 'dealer', public._klaverjas_dealer_name(v_player_order, v_i)),
      coalesce(v_round ->> 'forehand', public._klaverjas_forehand_name(v_player_order, v_i)),
      coalesce(v_round, '{}'::jsonb)
    );
  end loop;

  select count(*)::int,
         public._klaverjas_tak_count(count(*)::int),
         least(1::numeric, count(*)::numeric / 16::numeric),
         public._klaverjas_progress_scale(count(*)::int),
         coalesce(sum(awarded_ladder_w),0),
         coalesce(sum(awarded_ladder_z),0),
         coalesce(sum(awarded_raw_w),0),
         coalesce(sum(awarded_raw_z),0),
         coalesce(sum(roem_w),0),
         coalesce(sum(roem_z),0)
    into v_round_count, v_tak_count, v_progress, v_elo_scale, v_score_w, v_score_z, v_raw_w, v_raw_z, v_roem_w, v_roem_z
  from public.klaverjas_rounds
  where match_id = v_match_id;

  if v_score_w > v_score_z then v_winner := 'W';
  elsif v_score_z > v_score_w then v_winner := 'Z';
  else v_winner := null;
  end if;

  update public.klaverjas_matches
     set status = case when v_status = 'finished' then 'finished' when v_status = 'abandoned' then 'abandoned' else 'active' end,
         finished_at = case when v_status in ('finished','abandoned') then now() else null end,
         total_rounds_played = v_round_count,
         total_takken_played = v_tak_count,
         progress_ratio = v_progress,
         elo_scale_applied = v_elo_scale,
         final_score_w = v_score_w,
         final_score_z = v_score_z,
         final_raw_w = v_raw_w,
         final_raw_z = v_raw_z,
         total_roem_w = v_roem_w,
         total_roem_z = v_roem_z,
         kruipen_side = public._klaverjas_kruip_side(v_score_w, v_score_z),
         naakt_kruipen_side = public._klaverjas_naakt_kruip_side(v_score_w, v_score_z),
         winner_side = v_winner,
         theoretical_full_delta = case when v_winner = 'W' then greatest(1, v_score_w - v_score_z) when v_winner = 'Z' then greatest(1, v_score_z - v_score_w) else 0 end,
         actual_delta = case when v_winner is null then 0 else round((case when v_winner = 'W' then greatest(1, v_score_w - v_score_z) else greatest(1, v_score_z - v_score_w) end) * v_elo_scale)::int end,
         payload_snapshot = coalesce(payload_snapshot_input, '{}'::jsonb)
   where id = v_match_id;

  if v_round_count >= 8 then
    for v_i in 8..v_round_count loop
      v_snapshot_no := v_snapshot_no + 1;
      select jsonb_build_object(
        'match_id', v_match_id,
        'round_count', v_i,
        'tak_count', public._klaverjas_tak_count(v_i),
        'progress_ratio', least(1::numeric, v_i::numeric / 16::numeric),
        'elo_scale', public._klaverjas_progress_scale(v_i),
        'players', jsonb_build_object('W', team_w_player_names_input, 'Z', team_z_player_names_input),
        'totals', jsonb_build_object(
          'W', coalesce((select sum(awarded_ladder_w) from public.klaverjas_rounds where match_id = v_match_id and round_no <= v_i),0),
          'Z', coalesce((select sum(awarded_ladder_z) from public.klaverjas_rounds where match_id = v_match_id and round_no <= v_i),0)
        ),
        'rawTotals', jsonb_build_object(
          'W', coalesce((select sum(awarded_raw_w) from public.klaverjas_rounds where match_id = v_match_id and round_no <= v_i),0),
          'Z', coalesce((select sum(awarded_raw_z) from public.klaverjas_rounds where match_id = v_match_id and round_no <= v_i),0)
        ),
        'rounds', coalesce((select jsonb_agg(payload order by round_no) from public.klaverjas_rounds where match_id = v_match_id and round_no <= v_i), '[]'::jsonb)
      ) into v_round_score_state;

      insert into public.klaverjas_match_snapshots(match_id, snapshot_no, round_count, tak_count, progress_ratio, elo_scale, serialized_score_state)
      values (
        v_match_id,
        v_snapshot_no,
        v_i,
        public._klaverjas_tak_count(v_i),
        least(1::numeric, v_i::numeric / 16::numeric),
        public._klaverjas_progress_scale(v_i),
        v_round_score_state
      );
    end loop;
  end if;

  return public._klaverjas_build_match_json(v_match_id);
end;
$$;

grant execute on function public.klaverjas_upsert_match_state_scoped(text, uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, timestamptz) to anon, authenticated;

create or replace function public.klaverjas_set_active_match_presence_scoped(
  session_token text default null,
  match_id_input uuid default null,
  site_scope_input text default 'friends',
  player_name_input text default null,
  page_kind_input text default 'scorer'
)
returns jsonb
language sql
security definer
as $$
  insert into public.klaverjas_active_match_presence(site_scope, session_token, player_name, match_id, page_kind, last_seen_at)
  values (public._klaverjas_safe_scope(site_scope_input), session_token, nullif(trim(coalesce(player_name_input,'')),''), match_id_input, coalesce(page_kind_input,'scorer'), now())
  on conflict (session_token, match_id)
  do update set last_seen_at = now(), page_kind = excluded.page_kind, player_name = excluded.player_name
  returning jsonb_build_object('ok', true, 'match_id', match_id, 'page_kind', page_kind);
$$;

grant execute on function public.klaverjas_set_active_match_presence_scoped(text, uuid, text, text, text) to anon, authenticated;

create or replace function public.klaverjas_clear_active_match_presence_scoped(
  session_token text default null,
  match_id_input uuid default null
)
returns jsonb
language sql
security definer
as $$
  with d as (
    delete from public.klaverjas_active_match_presence
    where session_token = coalesce(session_token,'')
      and (match_id_input is null or match_id = match_id_input)
    returning 1
  )
  select jsonb_build_object('ok', true, 'deleted', count(*)) from d;
$$;

grant execute on function public.klaverjas_clear_active_match_presence_scoped(text, uuid) to anon, authenticated;

create or replace function public.klaverjas_get_live_match_public(match_id_input uuid)
returns jsonb
language sql
security definer
as $$
  select public._klaverjas_build_match_json(match_id_input);
$$;

grant execute on function public.klaverjas_get_live_match_public(uuid) to anon, authenticated;

create or replace function public.klaverjas_get_quick_stats_public(match_id_input uuid, snapshot_no_input integer default null)
returns jsonb
language sql
security definer
as $$
  with m as (
    select * from public.klaverjas_matches where id = match_id_input
  ),
  chosen_snapshot as (
    select *
    from public.klaverjas_match_snapshots
    where match_id = match_id_input
      and (snapshot_no_input is null or snapshot_no = snapshot_no_input)
    order by snapshot_no desc
    limit 1
  )
  select case
    when exists(select 1 from m where status = 'finished') then public._klaverjas_build_match_json(match_id_input)
    when exists(select 1 from chosen_snapshot) then jsonb_build_object(
      'match', (select to_jsonb(m.*) from m),
      'snapshot', (select to_jsonb(chosen_snapshot.*) from chosen_snapshot),
      'quick_stats_payload', (select serialized_score_state from chosen_snapshot)
    )
    else public._klaverjas_build_match_json(match_id_input)
  end;
$$;

grant execute on function public.klaverjas_get_quick_stats_public(uuid, integer) to anon, authenticated;

create or replace function public.klaverjas_get_player_stats_public(site_scope_input text default 'friends', player_name_input text default null)
returns setof public.klaverjas_player_stats_v
language sql
security definer
as $$
  select *
  from public.klaverjas_player_stats_v
  where site_scope = public._klaverjas_safe_scope(site_scope_input)
    and (player_name_input is null or lower(player_name) = lower(player_name_input))
  order by matches_won desc, matches_played desc, total_roem_won desc, player_name asc;
$$;

grant execute on function public.klaverjas_get_player_stats_public(text, text) to anon, authenticated;

create or replace function public.klaverjas_get_fun_ladders_public(site_scope_input text default 'friends')
returns jsonb
language sql
security definer
as $$
  with s as (
    select * from public.klaverjas_player_stats_v where site_scope = public._klaverjas_safe_scope(site_scope_input)
  )
  select jsonb_build_object(
    'grootste_roemrat', coalesce((select jsonb_agg(to_jsonb(x)) from (select player_name, total_roem_won from s order by total_roem_won desc, player_name asc limit 10) x), '[]'::jsonb),
    'pitmachine', coalesce((select jsonb_agg(to_jsonb(x)) from (select player_name, pit_given from s order by pit_given desc, player_name asc limit 10) x), '[]'::jsonb),
    'natnek', coalesce((select jsonb_agg(to_jsonb(x)) from (select player_name, nat_suffered from s order by nat_suffered desc, player_name asc limit 10) x), '[]'::jsonb),
    'kruipkampioen', coalesce((select jsonb_agg(to_jsonb(x)) from (select player_name, kruipen_forced_on_opponent from s order by kruipen_forced_on_opponent desc, player_name asc limit 10) x), '[]'::jsonb),
    'naakt_kruip_magneet', coalesce((select jsonb_agg(to_jsonb(x)) from (select player_name, naakt_kruipen_suffered from s order by naakt_kruipen_suffered desc, player_name asc limit 10) x), '[]'::jsonb),
    'meest_overmoedig_mislukt', coalesce((select jsonb_agg(to_jsonb(x)) from (select player_name, highest_failed_bid from s order by highest_failed_bid desc nulls last, player_name asc limit 10) x), '[]'::jsonb),
    'succesvolle_hoge_bieder', coalesce((select jsonb_agg(to_jsonb(x)) from (select player_name, highest_successful_bid from s order by highest_successful_bid desc nulls last, player_name asc limit 10) x), '[]'::jsonb)
  );
$$;

grant execute on function public.klaverjas_get_fun_ladders_public(text) to anon, authenticated;
