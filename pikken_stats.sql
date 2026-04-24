begin;

create table if not exists public.gejast_pikken_player_stats_cache (
  site_scope text not null default 'friends',
  player_name text not null,
  matches_played integer not null default 0,
  wins integer not null default 0,
  win_pct numeric,
  dice_lost numeric not null default 0,
  rounds_survived numeric not null default 0,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (site_scope, player_name)
);

create index if not exists idx_gejast_pikken_player_stats_lookup
  on public.gejast_pikken_player_stats_cache (site_scope, wins desc, matches_played desc, player_name);

alter table public.gejast_pikken_player_stats_cache enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='gejast_pikken_player_stats_cache' and policyname='gejast_pikken_player_stats_no_direct_public') then
    create policy gejast_pikken_player_stats_no_direct_public on public.gejast_pikken_player_stats_cache for all using (false) with check (false);
  end if;
end $$;
revoke all on public.gejast_pikken_player_stats_cache from anon, authenticated;

create or replace function public._gejast_phase9_scope(scope_input text default null)
returns text language sql stable as $$
  select case when lower(coalesce(nullif(btrim(scope_input),''),'friends')) = 'family' then 'family' else 'friends' end;
$$;

create or replace function public._gejast_phase9_json_text(j jsonb, keys text[])
returns text language sql stable as $$
  select nullif(btrim(coalesce((select j ->> k from unnest(keys) k where nullif(btrim(j ->> k),'') is not null limit 1),'')), '')
$$;

create or replace function public._gejast_phase9_num(value text)
returns numeric language plpgsql immutable as $$
begin
  if value is null or btrim(value) = '' then return null; end if;
  return value::numeric;
exception when others then return null;
end;
$$;

grant execute on function public._gejast_phase9_scope(text) to anon, authenticated;
grant execute on function public._gejast_phase9_json_text(jsonb,text[]) to anon, authenticated;
grant execute on function public._gejast_phase9_num(text) to anon, authenticated;

create or replace function public.refresh_pikken_base_stats_v641(site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_scope text := public._gejast_phase9_scope(site_scope_input);
  v_table regclass := coalesce(to_regclass('public.pikken_players'), to_regclass('public.pikken_game_players'), to_regclass('public.pikken_participants'));
  v_rows integer := 0;
begin
  if v_table is null then
    return jsonb_build_object('ok', true, 'phase', 'v641', 'site_scope', v_scope, 'upserted_rows', 0, 'reason', 'no pikken player table found');
  end if;

  execute format($sql$
    with raw as (
      select to_jsonb(p) j from %s p
    ), normalized as (
      select
        public._gejast_phase9_scope(coalesce(public._gejast_phase9_json_text(j, array['site_scope','scope','scope_input']),'friends')) as site_scope,
        public._gejast_phase9_json_text(j, array['player_name','display_name','name','username','nickname']) as player_name,
        public._gejast_phase9_json_text(j, array['game_id','match_id','client_match_id','lobby_id']) as game_id,
        lower(coalesce(public._gejast_phase9_json_text(j, array['is_winner','winner','won','final_winner','game_winner']),'false')) as winner_text,
        coalesce(public._gejast_phase9_num(public._gejast_phase9_json_text(j, array['dice_lost','lost_dice','dice_removed','penalty_dice'])),0) as dice_lost,
        coalesce(public._gejast_phase9_num(public._gejast_phase9_json_text(j, array['rounds_survived','round_no','last_round','rounds_played'])),0) as rounds_survived
      from raw
    ), per_player as (
      select site_scope, player_name,
             count(distinct coalesce(game_id, player_name || ':' || site_scope))::integer as matches_played,
             count(*) filter (where winner_text in ('true','t','1','yes','y','win','won','winner'))::integer as wins,
             sum(dice_lost) as dice_lost,
             sum(rounds_survived) as rounds_survived
      from normalized
      where site_scope = $1 and player_name is not null and btrim(player_name) <> ''
      group by site_scope, player_name
    )
    insert into public.gejast_pikken_player_stats_cache(site_scope, player_name, matches_played, wins, win_pct, dice_lost, rounds_survived, payload, updated_at)
    select site_scope, player_name, matches_played, wins,
           case when matches_played > 0 then round((wins::numeric/nullif(matches_played,0))*100,2) end,
           coalesce(dice_lost,0), coalesce(rounds_survived,0),
           jsonb_build_object('source_table', %L, 'phase','v641','definition','defensive extraction from Pikken player/participant rows'), now()
    from per_player
    on conflict (site_scope, player_name)
    do update set matches_played=excluded.matches_played, wins=excluded.wins, win_pct=excluded.win_pct, dice_lost=excluded.dice_lost,
      rounds_survived=excluded.rounds_survived, payload=excluded.payload, updated_at=now()
  $sql$, v_table, v_table::text) using v_scope;
  get diagnostics v_rows = row_count;

  insert into public.gejast_shared_stats_cache(site_scope, game_key, player_name, metric_key, metric_label, metric_value, metric_payload, source_key, updated_at)
  select site_scope, 'pikken', player_name, metric_key, metric_label, metric_value, payload || jsonb_build_object('phase','v641'), source_key, now()
  from (
    select site_scope, player_name, 'matches_played' metric_key, 'Potjes' metric_label, matches_played::numeric metric_value, payload, 'pikken_base_v641' source_key from public.gejast_pikken_player_stats_cache where site_scope=v_scope
    union all select site_scope, player_name, 'wins', 'Zeges', wins::numeric, payload, 'pikken_base_v641' from public.gejast_pikken_player_stats_cache where site_scope=v_scope
    union all select site_scope, player_name, 'win_pct', 'Winstpercentage', win_pct, payload, 'pikken_base_v641' from public.gejast_pikken_player_stats_cache where site_scope=v_scope
    union all select site_scope, player_name, 'dice_lost', 'Dobbelstenen verloren', dice_lost, payload, 'pikken_base_v641' from public.gejast_pikken_player_stats_cache where site_scope=v_scope
    union all select site_scope, player_name, 'rounds_survived', 'Rondes overleefd', rounds_survived, payload, 'pikken_base_v641' from public.gejast_pikken_player_stats_cache where site_scope=v_scope
  ) src
  where player_name is not null and btrim(player_name) <> ''
  on conflict (site_scope, game_key, player_name, metric_key)
  do update set metric_label=excluded.metric_label, metric_value=excluded.metric_value, metric_payload=excluded.metric_payload, source_key=excluded.source_key, updated_at=now();

  return jsonb_build_object('ok', true, 'phase', 'v641', 'site_scope', v_scope, 'used_table', v_table::text, 'upserted_rows', v_rows);
end;
$$;

grant execute on function public.refresh_pikken_base_stats_v641(text) to anon, authenticated;

commit;
