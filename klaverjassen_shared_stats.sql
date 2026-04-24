begin;

create table if not exists public.gejast_shared_stats_cache (
  site_scope text not null default 'friends',
  game_key text not null,
  player_name text not null,
  metric_key text not null,
  metric_label text not null,
  metric_value numeric,
  metric_payload jsonb not null default '{}'::jsonb,
  source_key text not null default 'manual',
  updated_at timestamptz not null default now(),
  primary key (site_scope, game_key, player_name, metric_key)
);

create index if not exists idx_gejast_shared_stats_cache_lookup
  on public.gejast_shared_stats_cache (site_scope, game_key, metric_key, metric_value desc nulls last, updated_at desc);

create or replace function public._gejast_phase8_scope(scope_input text default null)
returns text
language sql
stable
as $$
  select case when lower(coalesce(nullif(btrim(scope_input),''),'friends')) = 'family' then 'family' else 'friends' end;
$$;

create or replace function public.refresh_klaverjassen_shared_stats_v640(site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_scope text := public._gejast_phase8_scope(site_scope_input);
  v_rows integer := 0;
  v_total integer := 0;
begin
  if to_regclass('public.klaverjas_player_stats_v') is not null then
    execute $sql$
      insert into public.gejast_shared_stats_cache(site_scope, game_key, player_name, metric_key, metric_label, metric_value, metric_payload, source_key, updated_at)
      select site_scope, 'klaverjassen', player_name, metric_key, metric_label, metric_value,
             jsonb_build_object('source_view','klaverjas_player_stats_v','phase','v640'),
             'klaverjassen_player_stats_v640', now()
      from (
        select site_scope, player_name, 'matches_played' metric_key, 'Potjes' metric_label, matches_played::numeric metric_value from public.klaverjas_player_stats_v where site_scope = $1
        union all select site_scope, player_name, 'matches_won', 'Zeges', matches_won::numeric from public.klaverjas_player_stats_v where site_scope = $1
        union all select site_scope, player_name, 'win_pct', 'Winstpercentage', case when matches_played > 0 then round((matches_won::numeric / nullif(matches_played,0)) * 100, 2) end from public.klaverjas_player_stats_v where site_scope = $1
        union all select site_scope, player_name, 'rounds_won', 'Rondes gewonnen', rounds_won::numeric from public.klaverjas_player_stats_v where site_scope = $1
        union all select site_scope, player_name, 'takken_won', 'Takken gewonnen', takken_won::numeric from public.klaverjas_player_stats_v where site_scope = $1
        union all select site_scope, player_name, 'average_final_score', 'Gemiddelde eindscore', average_final_score::numeric from public.klaverjas_player_stats_v where site_scope = $1
        union all select site_scope, player_name, 'total_roem_won', 'Totale roem', total_roem_won::numeric from public.klaverjas_player_stats_v where site_scope = $1
        union all select site_scope, player_name, 'nat_given', 'Nat gegeven', nat_given::numeric from public.klaverjas_player_stats_v where site_scope = $1
        union all select site_scope, player_name, 'nat_suffered', 'Nat gekregen', nat_suffered::numeric from public.klaverjas_player_stats_v where site_scope = $1
        union all select site_scope, player_name, 'pit_given', 'Pit gegeven', pit_given::numeric from public.klaverjas_player_stats_v where site_scope = $1
        union all select site_scope, player_name, 'pit_suffered', 'Pit gekregen', pit_suffered::numeric from public.klaverjas_player_stats_v where site_scope = $1
        union all select site_scope, player_name, 'kruipen_forced_on_opponent', 'Kruipen uitgedeeld', kruipen_forced_on_opponent::numeric from public.klaverjas_player_stats_v where site_scope = $1
        union all select site_scope, player_name, 'kruipen_suffered', 'Kruipen gekregen', kruipen_suffered::numeric from public.klaverjas_player_stats_v where site_scope = $1
        union all select site_scope, player_name, 'naakt_kruipen_forced_on_opponent', 'Naakt kruipen uitgedeeld', naakt_kruipen_forced_on_opponent::numeric from public.klaverjas_player_stats_v where site_scope = $1
        union all select site_scope, player_name, 'naakt_kruipen_suffered', 'Naakt kruipen gekregen', naakt_kruipen_suffered::numeric from public.klaverjas_player_stats_v where site_scope = $1
        union all select site_scope, player_name, 'highest_successful_bid', 'Hoogste gelukte bod', highest_successful_bid::numeric from public.klaverjas_player_stats_v where site_scope = $1
        union all select site_scope, player_name, 'highest_failed_bid', 'Hoogste mislukte bod', highest_failed_bid::numeric from public.klaverjas_player_stats_v where site_scope = $1
      ) src
      where player_name is not null and btrim(player_name) <> ''
      on conflict (site_scope, game_key, player_name, metric_key)
      do update set metric_label = excluded.metric_label, metric_value = excluded.metric_value, metric_payload = excluded.metric_payload, source_key = excluded.source_key, updated_at = now()
    $sql$ using v_scope;
    get diagnostics v_rows = row_count;
    v_total := v_total + coalesce(v_rows,0);
  end if;

  if to_regclass('public.klaverjas_player_ratings') is not null then
    execute $sql$
      insert into public.gejast_shared_stats_cache(site_scope, game_key, player_name, metric_key, metric_label, metric_value, metric_payload, source_key, updated_at)
      select $1, 'klaverjassen', player_name, metric_key, metric_label, metric_value,
             jsonb_build_object('source_table','klaverjas_player_ratings','phase','v640'),
             'klaverjassen_player_ratings_v640', now()
      from (
        select player_name, 'current_elo' metric_key, 'Huidige Elo' metric_label, elo_rating::numeric metric_value from public.klaverjas_player_ratings
        union all select player_name, 'rating_games_played', 'Elo-potjes', games_played::numeric from public.klaverjas_player_ratings
        union all select player_name, 'rating_wins', 'Elo-zeges', wins::numeric from public.klaverjas_player_ratings
        union all select player_name, 'rating_losses', 'Elo-verlies', losses::numeric from public.klaverjas_player_ratings
      ) src
      where player_name is not null and btrim(player_name) <> ''
      on conflict (site_scope, game_key, player_name, metric_key)
      do update set metric_label = excluded.metric_label, metric_value = excluded.metric_value, metric_payload = excluded.metric_payload, source_key = excluded.source_key, updated_at = now()
    $sql$ using v_scope;
    get diagnostics v_rows = row_count;
    v_total := v_total + coalesce(v_rows,0);
  end if;

  return jsonb_build_object('ok', true, 'phase', 'v640', 'site_scope', v_scope, 'upserted_rows', v_total,
    'used_player_stats_view', to_regclass('public.klaverjas_player_stats_v') is not null,
    'used_ratings_table', to_regclass('public.klaverjas_player_ratings') is not null);
end;
$$;

grant execute on function public.refresh_klaverjassen_shared_stats_v640(text) to anon, authenticated;
grant execute on function public._gejast_phase8_scope(text) to anon, authenticated;

commit;
