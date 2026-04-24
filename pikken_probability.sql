begin;

create table if not exists public.gejast_pikken_probability_cache (
  site_scope text not null default 'friends',
  game_id text not null,
  player_name text not null,
  dice_count numeric,
  win_probability_pct numeric,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (site_scope, game_id, player_name)
);

create index if not exists idx_gejast_pikken_probability_lookup
  on public.gejast_pikken_probability_cache (site_scope, game_id, win_probability_pct desc nulls last, player_name);

alter table public.gejast_pikken_probability_cache enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='gejast_pikken_probability_cache' and policyname='gejast_pikken_probability_no_direct_public') then
    create policy gejast_pikken_probability_no_direct_public on public.gejast_pikken_probability_cache for all using (false) with check (false);
  end if;
end $$;
revoke all on public.gejast_pikken_probability_cache from anon, authenticated;

create or replace function public.refresh_pikken_probability_v641(game_id_input text default null, site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_scope text := public._gejast_phase9_scope(site_scope_input);
  v_game text := nullif(btrim(coalesce(game_id_input,'')), '');
  v_table regclass := coalesce(to_regclass('public.pikken_players'), to_regclass('public.pikken_game_players'), to_regclass('public.pikken_participants'));
  v_rows integer := 0;
begin
  if v_game is null then
    return jsonb_build_object('ok', true, 'phase', 'v641', 'site_scope', v_scope, 'upserted_rows', 0, 'reason', 'no game_id_input supplied');
  end if;
  if v_table is null then
    return jsonb_build_object('ok', true, 'phase', 'v641', 'site_scope', v_scope, 'game_id', v_game, 'upserted_rows', 0, 'reason', 'no Pikken player table found');
  end if;

  execute format($sql$
    with raw as (select to_jsonb(p) j from %s p), normalized as (
      select public._gejast_phase9_scope(coalesce(public._gejast_phase9_json_text(j, array['site_scope','scope','scope_input']),'friends')) as site_scope,
             public._gejast_phase9_json_text(j, array['game_id','match_id','client_match_id','lobby_id']) as game_id,
             public._gejast_phase9_json_text(j, array['player_name','display_name','name','username','nickname']) as player_name,
             greatest(coalesce(public._gejast_phase9_num(public._gejast_phase9_json_text(j, array['dice_count','dice_remaining','current_dice','alive_dice','start_dice'])),0),0) as dice_count,
             lower(coalesce(public._gejast_phase9_json_text(j, array['alive','is_alive','eliminated','is_eliminated']),'true')) as alive_text
      from raw
    ), scoped as (
      select * from normalized where site_scope=$1 and game_id=$2 and player_name is not null and btrim(player_name) <> ''
    ), weighted as (
      select *, sum(case when alive_text in ('false','f','0','no','eliminated','true_eliminated') then 0 else greatest(dice_count,0) end) over () as total_dice
      from scoped
    )
    insert into public.gejast_pikken_probability_cache(site_scope, game_id, player_name, dice_count, win_probability_pct, payload, updated_at)
    select site_scope, game_id, player_name, dice_count,
           case when total_dice > 0 then round((greatest(dice_count,0)/total_dice)*100,2) end,
           jsonb_build_object('source_table', %L, 'phase','v641','definition','lightweight live odds based on current dice share'), now()
    from weighted
    on conflict (site_scope, game_id, player_name)
    do update set dice_count=excluded.dice_count, win_probability_pct=excluded.win_probability_pct, payload=excluded.payload, updated_at=now()
  $sql$, v_table, v_table::text) using v_scope, v_game;
  get diagnostics v_rows = row_count;
  return jsonb_build_object('ok', true, 'phase', 'v641', 'site_scope', v_scope, 'game_id', v_game, 'used_table', v_table::text, 'upserted_rows', v_rows);
end;
$$;

create or replace function public.get_pikken_live_probability_public_v641(game_id_input text default null, site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_scope text := public._gejast_phase9_scope(site_scope_input);
  v_game text := nullif(btrim(coalesce(game_id_input,'')), '');
  v_refresh jsonb;
  v_rows jsonb;
begin
  if v_game is null then
    return jsonb_build_object('ok', true, 'phase', 'v641', 'site_scope', v_scope, 'items', '[]'::jsonb, 'reason', 'no game_id_input supplied');
  end if;
  v_refresh := public.refresh_pikken_probability_v641(v_game, v_scope);
  select coalesce(jsonb_agg(to_jsonb(t) order by t.win_probability_pct desc nulls last, t.player_name), '[]'::jsonb)
  into v_rows
  from (
    select site_scope, game_id, player_name, dice_count, win_probability_pct, payload, updated_at
    from public.gejast_pikken_probability_cache
    where site_scope=v_scope and game_id=v_game
    order by win_probability_pct desc nulls last, player_name
  ) t;
  return jsonb_build_object('ok', true, 'phase', 'v641', 'site_scope', v_scope, 'game_id', v_game, 'refresh', v_refresh, 'items', coalesce(v_rows,'[]'::jsonb));
end;
$$;

grant execute on function public.refresh_pikken_probability_v641(text,text) to anon, authenticated;
grant execute on function public.get_pikken_live_probability_public_v641(text,text) to anon, authenticated;

commit;
