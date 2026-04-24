begin;

create table if not exists public.gejast_klaverjassen_comeback_cache (
  site_scope text not null default 'friends',
  player_name text not null,
  comeback_wins integer not null default 0,
  finished_matches integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (site_scope, player_name)
);

create index if not exists idx_gejast_klaverjassen_comeback_lookup
  on public.gejast_klaverjassen_comeback_cache (site_scope, comeback_wins desc, finished_matches desc, player_name);

alter table public.gejast_klaverjassen_comeback_cache enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='gejast_klaverjassen_comeback_cache' and policyname='gejast_klaverjassen_comeback_no_direct_public') then
    create policy gejast_klaverjassen_comeback_no_direct_public on public.gejast_klaverjassen_comeback_cache for all using (false) with check (false);
  end if;
end $$;
revoke all on public.gejast_klaverjassen_comeback_cache from anon, authenticated;

create or replace function public.refresh_klaverjassen_comeback_stats_v640(site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_scope text := public._gejast_phase8_scope(site_scope_input);
  v_rows integer := 0;
begin
  if to_regclass('public.klaverjas_matches') is null or to_regclass('public.klaverjas_rounds') is null or to_regclass('public.klaverjas_match_player_rows') is null then
    return jsonb_build_object('ok', true, 'phase', 'v640', 'site_scope', v_scope, 'upserted_rows', 0, 'reason', 'klaverjas match/round/player views not present');
  end if;

  execute $sql$
    with round_running as (
      select r.match_id,
             r.round_no,
             sum(coalesce(r.awarded_ladder_w,0)) over (partition by r.match_id order by r.round_no rows between unbounded preceding and current row) as running_w,
             sum(coalesce(r.awarded_ladder_z,0)) over (partition by r.match_id order by r.round_no rows between unbounded preceding and current row) as running_z
      from public.klaverjas_rounds r
    ), comeback_matches as (
      select m.id as match_id, m.site_scope, m.winner_side,
             exists (
               select 1 from round_running rr
               where rr.match_id = m.id
                 and ((m.winner_side = 'W' and rr.running_w < rr.running_z) or (m.winner_side = 'Z' and rr.running_z < rr.running_w))
             ) as had_trail
      from public.klaverjas_matches m
      where m.site_scope = $1 and m.status = 'finished' and m.winner_side in ('W','Z')
    ), per_player as (
      select p.site_scope,
             p.player_name,
             count(*) filter (where cm.winner_side = p.side and cm.had_trail) as comeback_wins,
             count(*) filter (where cm.winner_side is not null) as finished_matches
      from public.klaverjas_match_player_rows p
      join comeback_matches cm on cm.match_id = p.match_id
      group by p.site_scope, p.player_name
    )
    insert into public.gejast_klaverjassen_comeback_cache(site_scope, player_name, comeback_wins, finished_matches, payload, updated_at)
    select site_scope, player_name, comeback_wins::integer, finished_matches::integer,
           jsonb_build_object('definition','winner side trailed after at least one recorded round before winning','phase','v640'), now()
    from per_player
    where player_name is not null and btrim(player_name) <> ''
    on conflict (site_scope, player_name)
    do update set comeback_wins = excluded.comeback_wins, finished_matches = excluded.finished_matches, payload = excluded.payload, updated_at = now()
  $sql$ using v_scope;
  get diagnostics v_rows = row_count;

  insert into public.gejast_shared_stats_cache(site_scope, game_key, player_name, metric_key, metric_label, metric_value, metric_payload, source_key, updated_at)
  select site_scope, 'klaverjassen', player_name, 'comeback_wins', 'Comeback-zeges', comeback_wins::numeric, payload, 'klaverjassen_comeback_v640', now()
  from public.gejast_klaverjassen_comeback_cache
  where site_scope = v_scope
  on conflict (site_scope, game_key, player_name, metric_key)
  do update set metric_label = excluded.metric_label, metric_value = excluded.metric_value, metric_payload = excluded.metric_payload, source_key = excluded.source_key, updated_at = now();

  return jsonb_build_object('ok', true, 'phase', 'v640', 'site_scope', v_scope, 'upserted_rows', v_rows);
end;
$$;

grant execute on function public.refresh_klaverjassen_comeback_stats_v640(text) to anon, authenticated;

commit;
