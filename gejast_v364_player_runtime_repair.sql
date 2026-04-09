-- GEJAST v364 targeted player/runtime SQL repair
begin;

create or replace function public._gejast_public_game_bundle(game_key_input text, player_name_input text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_game text := lower(trim(coalesce(game_key_input,'')));
  v_name text := public._gejast_resolve_player_name(player_name_input);
  v_summary jsonb := '{}'::jsonb;
  v_matches jsonb := '[]'::jsonb;
  v_rating numeric := 1000;
  v_badge text := 'Starter';
  v_games integer := 0;
  v_wins integer := 0;
  v_losses integer := 0;
  v_win_pct numeric := 0;
begin
  if v_name is null then
    return jsonb_build_object('player_name', null, 'badge', 'Starter', 'summary', jsonb_build_object('games_played',0,'matches_played',0,'wins',0,'losses',0,'win_pct',0,'elo_rating',1000), 'matches', '[]'::jsonb);
  end if;

  if v_game in ('klaverjas','boerenbridge') then
    with rows as (
      select *
      from public._gejast_summary_player_rows(false) spr
      where spr.game_key = v_game
        and public._gejast_norm_name(spr.player_name) = public._gejast_norm_name(v_name)
    ), agg as (
      select count(*)::int as games_played,
             count(*) filter (where rows.is_win)::int as wins,
             count(*) filter (where not rows.is_win)::int as losses
      from rows
    )
    select coalesce(a.games_played,0),
           coalesce(a.wins,0),
           coalesce(a.losses,0),
           coalesce(jsonb_agg(jsonb_build_object(
             'finished_at', r.finished_at,
             'winner_names', to_jsonb(r.winner_names),
             'participants', to_jsonb(r.participants),
             'player_result', case when r.is_win then 'win' when coalesce(array_length(r.winner_names,1),0) = 0 or coalesce(array_length(r.winner_names,1),0) = coalesce(array_length(r.participants,1),0) then 'draw' else 'loss' end,
             'elo_delta', 0,
             'scoreline', case when v_game = 'klaverjas' then coalesce(r.summary_payload->'totals'->>'wij','0') || ' - ' || coalesce(r.summary_payload->'totals'->>'zij','0') else coalesce(r.summary_payload->'match_summary'->>'top_score', r.summary_payload->>'top_score', '') end,
             'recap_text', r.recap_text,
             'details', '[]'::jsonb
           ) order by r.finished_at desc, r.match_ref desc), '[]'::jsonb)
    into v_games, v_wins, v_losses, v_matches
    from agg a
    left join rows r on true
    group by a.games_played, a.wins, a.losses;

    v_win_pct := case when v_games > 0 then round((100.0 * v_wins) / v_games, 1) else 0 end;
    v_rating := 1000;
  elsif v_game = 'beerpong' then
    with rows as (
      select *
      from public._gejast_beerpong_player_rows() bpr
      where public._gejast_norm_name(bpr.player_name) = public._gejast_norm_name(v_name)
    ), agg as (
      select count(*)::int as games_played,
             count(*) filter (where rows.is_win)::int as wins,
             count(*) filter (where not rows.is_win)::int as losses
      from rows
    )
    select coalesce(a.games_played,0),
           coalesce(a.wins,0),
           coalesce(a.losses,0),
           coalesce(jsonb_agg(jsonb_build_object(
             'finished_at', r.finished_at,
             'winner_names', to_jsonb(r.winner_names),
             'participants', to_jsonb(r.participants),
             'player_result', case when r.is_win then 'win' else 'loss' end,
             'elo_delta', 0,
             'scoreline', case when lower(coalesce(r.summary_payload->>'match_format','2v2')) = '1v1' then '1v1' else '2v2' end,
             'recap_text', case when r.is_win then 'Beerpong winst.' else 'Beerpong verlies.' end,
             'details', '[]'::jsonb
           ) order by r.finished_at desc, r.match_ref desc), '[]'::jsonb)
    into v_games, v_wins, v_losses, v_matches
    from agg a
    left join rows r on true
    group by a.games_played, a.wins, a.losses;

    select coalesce(bpr.rating,1000) into v_rating
    from public.beerpong_player_ratings bpr
    join public.players p on p.id = bpr.player_id
    where public._gejast_norm_name(p.display_name) = public._gejast_norm_name(v_name)
    order by bpr.updated_at desc nulls last
    limit 1;
    v_win_pct := case when v_games > 0 then round((100.0 * v_wins) / v_games, 1) else 0 end;
  else
    return jsonb_build_object('player_name', v_name, 'badge', 'Starter', 'summary', jsonb_build_object('games_played',0,'matches_played',0,'wins',0,'losses',0,'win_pct',0,'elo_rating',1000), 'matches', '[]'::jsonb);
  end if;

  v_badge := public._gejast_public_badge(v_games, v_win_pct);
  v_summary := jsonb_build_object('games_played', v_games, 'matches_played', v_games, 'wins', v_wins, 'losses', v_losses, 'win_pct', v_win_pct, 'elo_rating', round(coalesce(v_rating,1000)));
  return jsonb_build_object('player_name', v_name, 'badge', v_badge, 'summary', v_summary, 'matches', coalesce(v_matches, '[]'::jsonb));
end;
$fn$;

drop function if exists public.get_public_shared_player_stats(text, text);
create or replace function public.get_public_shared_player_stats(game_key_input text, player_name_input text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_bundle jsonb := public._gejast_public_game_bundle(game_key_input, player_name_input);
  v_recent_form text := '—';
  v_activity_30d integer := 0;
  v_results text[] := '{}'::text[];
begin
  select coalesce(array_agg(case when coalesce(m->>'player_result','') = 'win' then 'W' when coalesce(m->>'player_result','') = 'draw' then 'G' when coalesce(m->>'player_result','') = 'loss' then 'L' else '—' end), '{}'::text[])
    into v_results
  from jsonb_array_elements(coalesce(v_bundle->'matches', '[]'::jsonb)) with ordinality as rows(m, ord)
  where ord <= 5;

  select count(*)::int into v_activity_30d
  from jsonb_array_elements(coalesce(v_bundle->'matches', '[]'::jsonb)) as rows(m)
  where nullif(rows.m->>'finished_at','')::timestamptz >= now() - interval '30 days';

  if coalesce(array_length(v_results,1),0) > 0 then
    v_recent_form := array_to_string(v_results, '');
  end if;

  return jsonb_build_object('recent_form', v_recent_form, 'activity_30d', coalesce(v_activity_30d,0), 'biggest_gain', 0, 'biggest_drop', 0, 'volatility', 0);
end;
$fn$;

drop function if exists public.get_public_player_game_insights(text, text);
create or replace function public.get_public_player_game_insights(game_key_input text, player_name_input text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_bundle jsonb := public._gejast_public_game_bundle(game_key_input, player_name_input);
  v_cards jsonb := '[]'::jsonb;
  v_last jsonb;
  v_best_score text := '—';
  v_total_wins integer := coalesce((v_bundle->'summary'->>'wins')::integer, 0);
  v_total_games integer := coalesce((v_bundle->'summary'->>'games_played')::integer, 0);
begin
  select m into v_last from jsonb_array_elements(coalesce(v_bundle->'matches', '[]'::jsonb)) as rows(m) limit 1;
  if lower(coalesce(game_key_input,'')) = 'boerenbridge' then
    select coalesce(max(nullif(m->>'scoreline','')), '—') into v_best_score from jsonb_array_elements(coalesce(v_bundle->'matches', '[]'::jsonb)) as rows(m);
  elsif lower(coalesce(game_key_input,'')) = 'klaverjas' then
    select coalesce(max(nullif(m->>'scoreline','')), '—') into v_best_score from jsonb_array_elements(coalesce(v_bundle->'matches', '[]'::jsonb)) as rows(m);
  elsif lower(coalesce(game_key_input,'')) = 'beerpong' then
    v_best_score := coalesce(v_bundle->'summary'->>'elo_rating', '1000');
  end if;
  v_cards := jsonb_build_array(
    jsonb_build_object('label', 'Laatste resultaat', 'value', coalesce(v_last->>'player_result','—')),
    jsonb_build_object('label', 'Totaal winst', 'value', v_total_wins),
    jsonb_build_object('label', 'Gespeeld', 'value', v_total_games),
    jsonb_build_object('label', case when lower(coalesce(game_key_input,'')) = 'beerpong' then 'Huidige rating' else 'Beste scorelijn' end, 'value', v_best_score)
  );
  return jsonb_build_object('cards', v_cards);
end;
$fn$;

create or replace function public.get_public_shared_player_stats_scoped(game_key_input text, player_name_input text, site_scope_input text default 'friends')
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
begin
  return case when lower(trim(coalesce(site_scope_input,'friends'))) = 'family'
    then public.get_public_shared_player_stats(game_key_input, player_name_input)
    else public.get_public_shared_player_stats(game_key_input, player_name_input)
  end;
end;
$fn$;

create or replace function public.get_public_player_game_insights_scoped(game_key_input text, player_name_input text, site_scope_input text default 'friends')
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
begin
  return case when lower(trim(coalesce(site_scope_input,'friends'))) = 'family'
    then public.get_public_player_game_insights(game_key_input, player_name_input)
    else public.get_public_player_game_insights(game_key_input, player_name_input)
  end;
end;
$fn$;

grant execute on function public.get_public_shared_player_stats(text, text) to anon, authenticated;
grant execute on function public.get_public_player_game_insights(text, text) to anon, authenticated;
grant execute on function public.get_public_shared_player_stats_scoped(text, text, text) to anon, authenticated;
grant execute on function public.get_public_player_game_insights_scoped(text, text, text) to anon, authenticated;

commit;
