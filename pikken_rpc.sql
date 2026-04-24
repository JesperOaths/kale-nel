begin;

create or replace function public.refresh_pikken_phase9_all_v641(site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_scope text := public._gejast_phase9_scope(site_scope_input);
  v_base jsonb := '{}'::jsonb;
  v_bids jsonb := '{}'::jsonb;
begin
  v_base := public.refresh_pikken_base_stats_v641(v_scope);
  v_bids := public.refresh_pikken_bid_stats_v641(v_scope);
  return jsonb_build_object('ok', true, 'phase', 'v641', 'site_scope', v_scope, 'base', v_base, 'bids', v_bids);
end;
$$;

create or replace function public.get_pikken_shared_stats_public_v641(site_scope_input text default 'friends', player_name_input text default null, metric_key_input text default null, limit_input integer default 80)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_scope text := public._gejast_phase9_scope(site_scope_input);
  v_player text := nullif(btrim(coalesce(player_name_input,'')), '');
  v_metric text := nullif(btrim(coalesce(metric_key_input,'')), '');
  v_limit integer := greatest(1, least(coalesce(limit_input,80), 240));
  v_rows jsonb;
begin
  perform public.refresh_pikken_phase9_all_v641(v_scope);
  select coalesce(jsonb_agg(to_jsonb(t) order by t.metric_key, t.metric_value desc nulls last, t.player_name), '[]'::jsonb)
  into v_rows
  from (
    select site_scope, game_key, player_name, metric_key, metric_label, metric_value, metric_payload, source_key, updated_at
    from public.gejast_shared_stats_cache
    where site_scope = v_scope and game_key = 'pikken'
      and (v_player is null or lower(player_name)=lower(v_player))
      and (v_metric is null or metric_key = v_metric)
    order by metric_key, metric_value desc nulls last, player_name
    limit v_limit
  ) t;
  return jsonb_build_object('ok', true, 'phase', 'v641', 'site_scope', v_scope, 'player_name', v_player, 'metric_key', v_metric, 'items', coalesce(v_rows,'[]'::jsonb));
end;
$$;

create or replace function public.admin_get_pikken_shared_stats_audit_v641(admin_session_token text default null, site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_scope text := public._gejast_phase9_scope(site_scope_input);
  v_refresh jsonb;
  v_metrics jsonb;
  v_cache_rows integer := 0;
begin
  if to_regprocedure('public._gejast_admin_session_required(text)') is not null then
    perform public._gejast_admin_session_required(admin_session_token);
  end if;
  v_refresh := public.refresh_pikken_phase9_all_v641(v_scope);
  select count(*) into v_cache_rows from public.gejast_shared_stats_cache where site_scope=v_scope and game_key='pikken';
  select coalesce(jsonb_agg(jsonb_build_object('metric_key',metric_key,'label',max_label,'players',players,'updated_at',updated_at) order by metric_key), '[]'::jsonb)
  into v_metrics
  from (
    select metric_key, max(metric_label) max_label, count(distinct player_name) players, max(updated_at) updated_at
    from public.gejast_shared_stats_cache
    where site_scope=v_scope and game_key='pikken'
    group by metric_key
  ) x;
  return jsonb_build_object(
    'ok', true,
    'phase', 'v641',
    'site_scope', v_scope,
    'refresh', v_refresh,
    'cache_rows', v_cache_rows,
    'metrics', coalesce(v_metrics,'[]'::jsonb),
    'tables', jsonb_build_object(
      'pikken_players', to_regclass('public.pikken_players') is not null,
      'pikken_game_players', to_regclass('public.pikken_game_players') is not null,
      'pikken_round_bids', to_regclass('public.pikken_round_bids') is not null,
      'pikken_bids', to_regclass('public.pikken_bids') is not null,
      'pikken_round_hands', to_regclass('public.pikken_round_hands') is not null
    )
  );
end;
$$;

grant execute on function public.refresh_pikken_phase9_all_v641(text) to anon, authenticated;
grant execute on function public.get_pikken_shared_stats_public_v641(text,text,text,integer) to anon, authenticated;
grant execute on function public.admin_get_pikken_shared_stats_audit_v641(text,text) to anon, authenticated;

commit;
