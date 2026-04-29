-- GEJAST v708: screenshot RPC compatibility for ladder/drinks plus Paardenrace/Pikken frontend support.

begin;

drop function if exists public.get_public_ladder_page_scoped(text, text);
create or replace function public.get_public_ladder_page_scoped(
  game_key text,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_key text := lower(trim(coalesce(game_key, 'klaverjassen')));
  v_alt text;
  v_base jsonb := '{}'::jsonb;
begin
  if v_key in ('klaverjas','klaverjassen','klaverjassen_v450') then
    v_key := 'klaverjassen';
    v_alt := 'klaverjas';
  elsif v_key in ('boerenbridge','bridge') then
    v_key := 'boerenbridge';
    v_alt := 'boerenbridge';
  elsif v_key in ('beerpong','beer_pong') then
    v_key := 'beerpong';
    v_alt := 'beerpong';
  else
    v_key := 'klaverjassen';
    v_alt := 'klaverjas';
  end if;

  begin
    if to_regprocedure('public.get_public_ladder_page(text)') is not null then
      execute 'select public.get_public_ladder_page($1::text)' into v_base using v_key;
    end if;
  exception when others then
    begin
      execute 'select public.get_public_ladder_page($1::text)' into v_base using v_alt;
    exception when others then
      v_base := jsonb_build_object(
        'ok', true,
        'source', 'v708_empty_ladder_compat',
        'game_key', v_key,
        'ladder', '[]'::jsonb,
        'recent_matches', '[]'::jsonb,
        'pair_stats', '[]'::jsonb,
        'matchup_stats', '[]'::jsonb,
        'history_series', '[]'::jsonb
      );
    end;
  end;

  return coalesce(v_base, '{}'::jsonb)
    || jsonb_build_object('ok', true, 'game_key', v_key, 'site_scope', site_scope_input);
end
$fn$;

drop function if exists public.get_drinks_page_public(text, double precision, double precision);
create or replace function public.get_drinks_page_public(
  session_token text,
  viewer_lat double precision,
  viewer_lng double precision
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := 'friends';
  v_out jsonb := '{}'::jsonb;
begin
  if to_regprocedure('public.get_drinks_dashboard_fallback_public(text)') is not null then
    execute 'select public.get_drinks_dashboard_fallback_public($1::text)' into v_out using v_scope;
  elsif to_regprocedure('public.get_drinks_page_public(text)') is not null then
    execute 'select public.get_drinks_page_public($1::text)' into v_out using v_scope;
  else
    v_out := jsonb_build_object(
      'ok', true,
      'source', 'v708_empty_drinks_compat',
      'session', jsonb_build_object('units', 0, 'events', 0),
      'totals', jsonb_build_object('today_units', 0, 'today_events', 0, 'all_units', 0, 'all_events', 0),
      'ladders', jsonb_build_object('today_units', '[]'::jsonb, 'all_units', '[]'::jsonb, 'all_count', '[]'::jsonb),
      'big_nights', '[]'::jsonb,
      'by_location', '[]'::jsonb,
      'fairness_cards', '[]'::jsonb,
      'verify_queue', '[]'::jsonb,
      'my_pending_events', '[]'::jsonb
    );
  end if;

  return coalesce(v_out, '{}'::jsonb)
    || jsonb_build_object(
      'ok', true,
      'viewer_lat', viewer_lat,
      'viewer_lng', viewer_lng
    );
end
$fn$;

drop function if exists public.get_drinks_push_phase_summary_v661(integer, text);
create or replace function public.get_drinks_push_phase_summary_v661(
  limit_input integer default 50,
  site_scope_input text default 'friends'
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select jsonb_build_object(
    'ok', true,
    'source', 'v708_push_phase_compat',
    'limit', greatest(1, least(coalesce(limit_input, 50), 200)),
    'site_scope', case when lower(coalesce(site_scope_input, 'friends')) in ('family','familie') then 'family' else 'friends' end,
    'items', '[]'::jsonb,
    'phases', '[]'::jsonb,
    'summary', jsonb_build_object('pending', 0, 'sent', 0, 'failed', 0)
  )
$fn$;

grant execute on function public.get_drinks_page_public(text, double precision, double precision) to anon, authenticated;
grant execute on function public.get_drinks_push_phase_summary_v661(integer, text) to anon, authenticated;
grant execute on function public.get_public_ladder_page_scoped(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
