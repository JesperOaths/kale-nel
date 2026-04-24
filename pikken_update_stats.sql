begin;

create table if not exists public.gejast_pikken_bid_stats_cache (
  site_scope text not null default 'friends',
  player_name text not null,
  bids_made integer not null default 0,
  avg_normalized_bid numeric,
  max_normalized_bid numeric,
  pik_calls integer not null default 0,
  tilt_factor numeric,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (site_scope, player_name)
);

create index if not exists idx_gejast_pikken_bid_stats_lookup
  on public.gejast_pikken_bid_stats_cache (site_scope, bids_made desc, avg_normalized_bid desc nulls last, player_name);

alter table public.gejast_pikken_bid_stats_cache enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='gejast_pikken_bid_stats_cache' and policyname='gejast_pikken_bid_stats_no_direct_public') then
    create policy gejast_pikken_bid_stats_no_direct_public on public.gejast_pikken_bid_stats_cache for all using (false) with check (false);
  end if;
end $$;
revoke all on public.gejast_pikken_bid_stats_cache from anon, authenticated;

create or replace function public.refresh_pikken_bid_stats_v641(site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_scope text := public._gejast_phase9_scope(site_scope_input);
  v_table regclass := coalesce(to_regclass('public.pikken_round_bids'), to_regclass('public.pikken_bids'), to_regclass('public.pikken_bid_history'));
  v_rows integer := 0;
begin
  if v_table is null then
    return jsonb_build_object('ok', true, 'phase', 'v641', 'site_scope', v_scope, 'upserted_rows', 0, 'reason', 'no Pikken bid table found');
  end if;

  execute format($sql$
    with raw as (select to_jsonb(b) j from %s b), normalized as (
      select public._gejast_phase9_scope(coalesce(public._gejast_phase9_json_text(j, array['site_scope','scope','scope_input']),'friends')) as site_scope,
             public._gejast_phase9_json_text(j, array['player_name','bidder_name','display_name','name','username','nickname']) as player_name,
             coalesce(public._gejast_phase9_num(public._gejast_phase9_json_text(j, array['count','bid_count','dice_count','quantity'])),0) as bid_count,
             coalesce(public._gejast_phase9_num(public._gejast_phase9_json_text(j, array['face','bid_face','dice_face','value'])),0) as bid_face,
             lower(coalesce(public._gejast_phase9_json_text(j, array['is_pik','pik','bid_is_pik','face_label']),'false')) as pik_text
      from raw
    ), per_player as (
      select site_scope, player_name, count(*)::integer as bids_made,
             round(avg(nullif(bid_count,0) * case when bid_face = 1 then 7 else nullif(bid_face,0) end), 3) as avg_normalized_bid,
             max(nullif(bid_count,0) * case when bid_face = 1 then 7 else nullif(bid_face,0) end) as max_normalized_bid,
             count(*) filter (where bid_face = 1 or pik_text in ('true','t','1','yes','y','pik'))::integer as pik_calls
      from normalized
      where site_scope = $1 and player_name is not null and btrim(player_name) <> ''
      group by site_scope, player_name
    )
    insert into public.gejast_pikken_bid_stats_cache(site_scope, player_name, bids_made, avg_normalized_bid, max_normalized_bid, pik_calls, tilt_factor, payload, updated_at)
    select site_scope, player_name, bids_made, avg_normalized_bid, max_normalized_bid, pik_calls,
           round(coalesce(avg_normalized_bid,0) + (pik_calls::numeric * 1.75), 3) as tilt_factor,
           jsonb_build_object('source_table', %L, 'phase','v641','definition','normalized_bid=count*(face, with pik/ace treated as 7); tilt_factor=avg_normalized_bid + pik_calls*1.75'), now()
    from per_player
    on conflict (site_scope, player_name)
    do update set bids_made=excluded.bids_made, avg_normalized_bid=excluded.avg_normalized_bid, max_normalized_bid=excluded.max_normalized_bid,
      pik_calls=excluded.pik_calls, tilt_factor=excluded.tilt_factor, payload=excluded.payload, updated_at=now()
  $sql$, v_table, v_table::text) using v_scope;
  get diagnostics v_rows = row_count;

  insert into public.gejast_shared_stats_cache(site_scope, game_key, player_name, metric_key, metric_label, metric_value, metric_payload, source_key, updated_at)
  select site_scope, 'pikken', player_name, metric_key, metric_label, metric_value, payload || jsonb_build_object('phase','v641'), 'pikken_bid_stats_v641', now()
  from (
    select site_scope, player_name, 'bids_made' metric_key, 'Biedingen' metric_label, bids_made::numeric metric_value, payload from public.gejast_pikken_bid_stats_cache where site_scope=v_scope
    union all select site_scope, player_name, 'avg_normalized_bid', 'Gemiddeld genormaliseerd bod', avg_normalized_bid, payload from public.gejast_pikken_bid_stats_cache where site_scope=v_scope
    union all select site_scope, player_name, 'max_normalized_bid', 'Hoogste genormaliseerde bod', max_normalized_bid, payload from public.gejast_pikken_bid_stats_cache where site_scope=v_scope
    union all select site_scope, player_name, 'pik_calls', 'Pik-biedingen', pik_calls::numeric, payload from public.gejast_pikken_bid_stats_cache where site_scope=v_scope
    union all select site_scope, player_name, 'tilt_factor', 'Tilt-factor', tilt_factor, payload from public.gejast_pikken_bid_stats_cache where site_scope=v_scope
  ) src
  where player_name is not null and btrim(player_name) <> ''
  on conflict (site_scope, game_key, player_name, metric_key)
  do update set metric_label=excluded.metric_label, metric_value=excluded.metric_value, metric_payload=excluded.metric_payload, source_key=excluded.source_key, updated_at=now();

  return jsonb_build_object('ok', true, 'phase', 'v641', 'site_scope', v_scope, 'used_table', v_table::text, 'upserted_rows', v_rows);
end;
$$;

grant execute on function public.refresh_pikken_bid_stats_v641(text) to anon, authenticated;

commit;
