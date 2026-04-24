begin;

create table if not exists public.gejast_klaverjassen_opponent_elo_cache (
  site_scope text not null default 'friends',
  player_name text not null,
  avg_current_opponent_elo numeric,
  opponent_samples integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (site_scope, player_name)
);

create index if not exists idx_gejast_klaverjassen_opponent_elo_lookup
  on public.gejast_klaverjassen_opponent_elo_cache (site_scope, avg_current_opponent_elo desc nulls last, opponent_samples desc, player_name);

alter table public.gejast_klaverjassen_opponent_elo_cache enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='gejast_klaverjassen_opponent_elo_cache' and policyname='gejast_klaverjassen_opponent_elo_no_direct_public') then
    create policy gejast_klaverjassen_opponent_elo_no_direct_public on public.gejast_klaverjassen_opponent_elo_cache for all using (false) with check (false);
  end if;
end $$;
revoke all on public.gejast_klaverjassen_opponent_elo_cache from anon, authenticated;

create or replace function public.refresh_klaverjassen_opponent_elo_v640(site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_scope text := public._gejast_phase8_scope(site_scope_input);
  v_rows integer := 0;
begin
  if to_regclass('public.klaverjas_match_player_rows') is null or to_regclass('public.klaverjas_player_ratings') is null then
    return jsonb_build_object('ok', true, 'phase', 'v640', 'site_scope', v_scope, 'upserted_rows', 0, 'reason', 'klaverjas player rows or ratings table not present');
  end if;

  execute $sql$
    with pairings as (
      select p.site_scope, p.player_name, opp.player_name as opponent_name, r.elo_rating as opponent_elo
      from public.klaverjas_match_player_rows p
      join public.klaverjas_match_player_rows opp on opp.match_id = p.match_id and opp.side <> p.side and lower(opp.player_name) <> lower(p.player_name)
      left join public.klaverjas_player_ratings r on lower(r.player_name) = lower(opp.player_name)
      where p.site_scope = $1 and p.player_name is not null and opp.player_name is not null
    ), agg as (
      select site_scope, player_name, round(avg(opponent_elo)::numeric, 2) as avg_current_opponent_elo, count(opponent_name)::integer as opponent_samples
      from pairings
      group by site_scope, player_name
    )
    insert into public.gejast_klaverjassen_opponent_elo_cache(site_scope, player_name, avg_current_opponent_elo, opponent_samples, payload, updated_at)
    select site_scope, player_name, avg_current_opponent_elo, opponent_samples,
           jsonb_build_object('definition','average current Elo of opponents faced in recorded Klaverjassen matches','phase','v640'), now()
    from agg
    where player_name is not null and btrim(player_name) <> ''
    on conflict (site_scope, player_name)
    do update set avg_current_opponent_elo = excluded.avg_current_opponent_elo, opponent_samples = excluded.opponent_samples, payload = excluded.payload, updated_at = now()
  $sql$ using v_scope;
  get diagnostics v_rows = row_count;

  insert into public.gejast_shared_stats_cache(site_scope, game_key, player_name, metric_key, metric_label, metric_value, metric_payload, source_key, updated_at)
  select site_scope, 'klaverjassen', player_name, 'avg_current_opponent_elo', 'Gem. tegenstander-Elo', avg_current_opponent_elo, payload || jsonb_build_object('samples', opponent_samples), 'klaverjassen_opponent_elo_v640', now()
  from public.gejast_klaverjassen_opponent_elo_cache
  where site_scope = v_scope
  on conflict (site_scope, game_key, player_name, metric_key)
  do update set metric_label = excluded.metric_label, metric_value = excluded.metric_value, metric_payload = excluded.metric_payload, source_key = excluded.source_key, updated_at = now();

  return jsonb_build_object('ok', true, 'phase', 'v640', 'site_scope', v_scope, 'upserted_rows', v_rows);
end;
$$;

grant execute on function public.refresh_klaverjassen_opponent_elo_v640(text) to anon, authenticated;

commit;
