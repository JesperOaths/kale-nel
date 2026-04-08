begin;

create or replace function public.get_homepage_boot_bundle_scoped(
  session_token text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := public._scope_norm(site_scope_input);
  v_homepage_state jsonb := '{}'::jsonb;
  v_extra_poll jsonb := '{}'::jsonb;
  v_ladders jsonb := '{}'::jsonb;
  v_drinks_home jsonb := '{}'::jsonb;
  v_drinks_top5 jsonb := '{}'::jsonb;
  v_live_entries jsonb := '{}'::jsonb;
begin
  begin
    v_homepage_state := public.get_gejast_homepage_state(session_token);
  exception when undefined_function or others then
    begin
      v_homepage_state := public.get_public_state(session_token);
    exception when others then
      v_homepage_state := '{}'::jsonb;
    end;
  end;

  begin
    v_extra_poll := public.get_site_poll_state('gejast_drinks_donderdag', session_token);
  exception when undefined_function or others then
    v_extra_poll := '{}'::jsonb;
  end;

  begin
    v_ladders := public.get_homepage_ladders_public_scoped(v_scope);
  exception when undefined_function then
    v_ladders := public.get_homepage_ladders_public();
  when others then
    v_ladders := '{}'::jsonb;
  end;

  begin
    v_drinks_home := public.get_drinks_homepage_public_scoped(v_scope);
  exception when undefined_function then
    v_drinks_home := public.get_drinks_homepage_public();
  when others then
    v_drinks_home := '{}'::jsonb;
  end;

  begin
    v_drinks_top5 := public.get_drinks_homepage_top5_public_scoped(v_scope);
  exception when undefined_function then
    v_drinks_top5 := public.get_drinks_homepage_top5_public();
  when others then
    v_drinks_top5 := '{}'::jsonb;
  end;

  begin
    v_live_entries := public.get_homepage_live_state_public(session_token);
  exception when others then
    v_live_entries := '{}'::jsonb;
  end;

  return jsonb_build_object(
    'site_scope', v_scope,
    'homepage_state', coalesce(v_homepage_state, '{}'::jsonb),
    'extra_poll_state', coalesce(v_extra_poll, '{}'::jsonb),
    'ladders', coalesce(v_ladders, '{}'::jsonb),
    'drinks_home', coalesce(v_drinks_home, '{}'::jsonb),
    'drinks_top5', coalesce(v_drinks_top5, '{}'::jsonb),
    'live_entries', coalesce(v_live_entries, '{}'::jsonb),
    'perf_hints', jsonb_build_object(
      'defer_drinks_top5_rotation', true,
      'defer_homepage_ladders_until_visible', v_scope = 'friends',
      'render_mobile_lite', true
    )
  );
end;
$fn$;

create or replace function public.get_player_page_bundle_scoped(
  player_name text,
  game_key text default 'klaverjas',
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := public._scope_norm(site_scope_input);
  v_unified jsonb := '{}'::jsonb;
  v_shared jsonb := '{}'::jsonb;
  v_insights jsonb := '{}'::jsonb;
  v_drinks jsonb := '{}'::jsonb;
  v_badges jsonb := '{}'::jsonb;
begin
  v_unified := public.get_public_player_unified_scoped(player_name, v_scope);
  v_shared := public.get_public_shared_player_stats_scoped(game_key, player_name, v_scope);
  v_insights := public.get_public_player_game_insights_scoped(game_key, player_name, v_scope);

  begin
    v_drinks := public.get_drink_player_public_scoped(player_name, v_scope);
  exception when undefined_function then
    v_drinks := public.get_drink_player_public(player_name);
  when others then
    v_drinks := '{}'::jsonb;
  end;

  begin
    v_badges := public.get_player_badge_bundle_scoped(player_name, v_scope);
  exception when undefined_function or others then
    v_badges := '{}'::jsonb;
  end;

  return jsonb_build_object(
    'player_name', player_name,
    'game_key', lower(trim(coalesce(game_key, 'klaverjas'))),
    'site_scope', v_scope,
    'unified', coalesce(v_unified, '{}'::jsonb),
    'shared_stats', coalesce(v_shared, '{}'::jsonb),
    'game_insights', coalesce(v_insights, '{}'::jsonb),
    'drinks', coalesce(v_drinks, '{}'::jsonb),
    'badges', coalesce(v_badges, '{}'::jsonb),
    'perf_hints', jsonb_build_object(
      'defer_matches_render', true,
      'defer_drinks_panel', true,
      'chunk_match_render', true
    )
  );
end;
$fn$;

create or replace function public.get_profiles_page_bundle_scoped(
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := public._scope_norm(site_scope_input);
  v_players jsonb := '[]'::jsonb;
  v_badges jsonb := '[]'::jsonb;
begin
  v_players := coalesce(public.get_all_site_players_public_scoped(v_scope)->'players', '[]'::jsonb);

  begin
    v_badges := coalesce(public.get_site_player_badge_cards_scoped(v_scope)->'players', '[]'::jsonb);
  exception when undefined_function or others then
    v_badges := '[]'::jsonb;
  end;

  return jsonb_build_object(
    'site_scope', v_scope,
    'players', coalesce(v_players, '[]'::jsonb),
    'badge_cards', coalesce(v_badges, '[]'::jsonb),
    'perf_hints', jsonb_build_object(
      'chunk_cards', true,
      'lazy_avatars', true,
      'mobile_initial_batch', 18
    )
  );
end;
$fn$;

create or replace function public.get_drinks_page_bundle_public_scoped(
  session_token text default null,
  viewer_lat numeric default null,
  viewer_lng numeric default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := public._scope_norm(site_scope_input);
  v_page jsonb := '{}'::jsonb;
  v_dashboard jsonb := '{}'::jsonb;
  v_history jsonb := '[]'::jsonb;
  v_speed jsonb := '{}'::jsonb;
begin
  begin
    v_page := public.get_drinks_page_public(session_token, viewer_lat, viewer_lng);
  exception when others then
    v_page := '{}'::jsonb;
  end;

  begin
    v_dashboard := public.get_drinks_dashboard_fallback_public();
  exception when others then
    v_dashboard := '{}'::jsonb;
  end;

  begin
    v_history := public.get_verified_drinks_history_public_scoped(25, v_scope);
  exception when undefined_function then
    v_history := public.get_verified_drinks_history_public(25);
  when others then
    v_history := '[]'::jsonb;
  end;

  begin
    v_speed := public.get_drink_speed_page_public(session_token);
  exception when others then
    v_speed := '{}'::jsonb;
  end;

  return jsonb_build_object(
    'site_scope', v_scope,
    'page', coalesce(v_page, '{}'::jsonb),
    'dashboard', coalesce(v_dashboard, '{}'::jsonb),
    'history', coalesce(v_history, '[]'::jsonb),
    'speed', coalesce(v_speed, '{}'::jsonb),
    'perf_hints', jsonb_build_object(
      'defer_location_breakdown', true,
      'defer_speed_highlights', true,
      'geo_refresh_cooldown_ms', 15000
    )
  );
end;
$fn$;

grant execute on function public.get_homepage_boot_bundle_scoped(text, text) to anon, authenticated;
grant execute on function public.get_player_page_bundle_scoped(text, text, text) to anon, authenticated;
grant execute on function public.get_profiles_page_bundle_scoped(text) to anon, authenticated;
grant execute on function public.get_drinks_page_bundle_public_scoped(text, numeric, numeric, text) to anon, authenticated;

commit;
