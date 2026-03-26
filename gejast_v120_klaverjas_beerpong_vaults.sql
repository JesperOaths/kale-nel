begin;

-- -----------------------------
-- KLAVERJAS ADMIN ANALYSIS
-- -----------------------------
create or replace function public.get_jas_leaderboard(limit_count integer default 100)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_limit integer := greatest(coalesce(limit_count, 100), 1);
  leaderboard jsonb;
  recent_games jsonb;
  v_summary jsonb;
  v_top_points jsonb;
  v_top_wins jsonb;
  v_top_form jsonb;
  v_daily jsonb;
  v_monthly jsonb;
  v_points_history jsonb;
  v_player_breakdowns jsonb;
begin
  with entry_rows as (
    select
      p.id as player_id,
      p.display_name,
      e.id as entry_id,
      e.game_id,
      e.total_points,
      e.is_winner,
      e.seat_no,
      e.team_no,
      g.played_at,
      g.created_at,
      row_number() over (partition by p.id order by g.played_at desc, g.created_at desc, e.id desc) as rn_desc,
      row_number() over (partition by p.id order by g.played_at, g.created_at, e.id) as rn_asc,
      row_number() over (partition by p.id, e.is_winner order by g.played_at, g.created_at, e.id) as rn_by_result
    from public.players p
    left join public.jas_game_entries e on e.player_id = p.id
    left join public.jas_games g on g.id = e.game_id
    where coalesce(p.active, false) is true
  ),
  streak_groups as (
    select player_id, display_name, is_winner, played_at, total_points, rn_asc - rn_by_result as grp
    from entry_rows
    where entry_id is not null
  ),
  streak_lengths as (
    select player_id, is_winner, grp, count(*)::int as streak_len
    from streak_groups
    group by player_id, is_winner, grp
  ),
  current_streak as (
    select player_id, count(*)::int as current_win_streak
    from entry_rows er
    where er.entry_id is not null
      and er.is_winner is true
      and not exists (
        select 1
        from entry_rows later
        where later.player_id = er.player_id
          and later.entry_id is not null
          and (later.played_at, later.created_at, later.entry_id) > (er.played_at, er.created_at, er.entry_id)
          and later.is_winner is false
      )
    group by player_id
  ),
  longest_streak as (
    select player_id, max(streak_len)::int as longest_win_streak
    from streak_lengths
    where is_winner is true
    group by player_id
  ),
  recent_form as (
    select player_id,
           array_agg(case when is_winner then 'W' else 'V' end order by played_at desc, created_at desc, entry_id desc) as recent_form
    from entry_rows
    where entry_id is not null and rn_desc <= 5
    group by player_id
  ),
  month_stats as (
    select
      p.id as player_id,
      count(e.id)::int as games_this_month,
      coalesce(sum(e.total_points),0)::int as points_this_month
    from public.players p
    left join public.jas_game_entries e on e.player_id = p.id
    left join public.jas_games g on g.id = e.game_id
    where g.played_at >= date_trunc('month', current_date)::date
      and g.played_at < (date_trunc('month', current_date) + interval '1 month')::date
      and coalesce(p.active, false) is true
    group by p.id
  ),
  base as (
    select
      p.id as player_id,
      p.display_name,
      coalesce(count(e.id), 0)::int as games_played,
      coalesce(sum(case when e.is_winner then 1 else 0 end), 0)::int as games_won,
      coalesce(sum(e.total_points), 0)::int as total_points,
      round(coalesce(avg(e.total_points), 0)::numeric, 1) as avg_points,
      round(case when count(e.id)=0 then 0 else (sum(case when e.is_winner then 1 else 0 end)::numeric / count(e.id)::numeric) * 100 end, 1) as win_rate,
      max(g.played_at)::date as last_played_at,
      coalesce(max(e.total_points), 0)::int as best_game_points,
      coalesce(min(e.total_points), 0)::int as worst_game_points,
      coalesce(cs.current_win_streak, 0)::int as current_win_streak,
      coalesce(ls.longest_win_streak, 0)::int as longest_win_streak,
      coalesce(ms.games_this_month, 0)::int as games_this_month,
      coalesce(ms.points_this_month, 0)::int as points_this_month,
      coalesce(rf.recent_form, array[]::text[]) as recent_form,
      coalesce(sum(case when e.seat_no in (1,3) then e.total_points else 0 end),0)::int as points_as_wij,
      coalesce(sum(case when e.seat_no in (2,4) then e.total_points else 0 end),0)::int as points_as_zij
    from public.players p
    left join public.jas_game_entries e on e.player_id = p.id
    left join public.jas_games g on g.id = e.game_id
    left join current_streak cs on cs.player_id = p.id
    left join longest_streak ls on ls.player_id = p.id
    left join month_stats ms on ms.player_id = p.id
    left join recent_form rf on rf.player_id = p.id
    where coalesce(p.active, false) is true
    group by p.id, p.display_name, cs.current_win_streak, ls.longest_win_streak, ms.games_this_month, ms.points_this_month, rf.recent_form
  )
  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.games_won desc, row_data.total_points desc, row_data.display_name asc), '[]'::jsonb)
  into leaderboard
  from (
    select * from base where games_played > 0 order by games_won desc, total_points desc, display_name asc limit v_limit
  ) row_data;

  select coalesce(jsonb_agg(game_row order by played_at desc, created_at desc), '[]'::jsonb)
    into recent_games
    from (
      select
        g.id,
        g.title,
        g.played_at,
        g.variant,
        g.scoreboard_mode,
        g.created_at,
        coalesce((select jsonb_agg(e.display_name order by e.seat_no, e.id) from public.jas_game_entries e where e.game_id = g.id), '[]'::jsonb) as players,
        coalesce((select jsonb_agg(e.display_name order by e.seat_no, e.id) from public.jas_game_entries e where e.game_id = g.id and e.is_winner = true), '[]'::jsonb) as winners,
        coalesce((select jsonb_agg(jsonb_build_object('display_name', e.display_name, 'total_points', e.total_points, 'seat_no', e.seat_no, 'team_no', e.team_no, 'is_winner', e.is_winner) order by e.seat_no, e.id) from public.jas_game_entries e where e.game_id = g.id), '[]'::jsonb) as entries
      from public.jas_games g
      order by g.played_at desc, g.created_at desc
      limit 30
    ) game_row;

  with daily as (
    select d::date as day_date,
           to_char(d::date, 'DD Mon') as day_label,
           coalesce(count(g.id),0)::int as games
    from generate_series(current_date - interval '13 day', current_date, interval '1 day') d
    left join public.jas_games g on g.played_at = d::date
    group by d
    order by d
  )
  select coalesce(jsonb_agg(jsonb_build_object('day', to_char(day_date,'YYYY-MM-DD'),'day_label', day_label,'games', games) order by day_date), '[]'::jsonb)
    into v_daily
  from daily;

  with months as (
    select generate_series(date_trunc('month', current_date) - interval '11 month', date_trunc('month', current_date), interval '1 month')::date as month_start
  ),
  month_counts as (
    select date_trunc('month', g.played_at)::date as month_start, count(*)::int as games
    from public.jas_games g
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m.month_start,'YYYY-MM'),'label', to_char(m.month_start,'Mon YY'),'games', coalesce(mc.games,0)) order by m.month_start), '[]'::jsonb)
    into v_monthly
  from months m left join month_counts mc on mc.month_start = m.month_start;

  with top_players as (
    select * from jsonb_to_recordset(leaderboard) as x(
      player_id bigint, display_name text, games_played integer, games_won integer, total_points integer, avg_points numeric, win_rate numeric,
      last_played_at date, best_game_points integer, worst_game_points integer, current_win_streak integer, longest_win_streak integer,
      games_this_month integer, points_this_month integer, recent_form text[], points_as_wij integer, points_as_zij integer
    )
    order by games_won desc, total_points desc, display_name asc
    limit 8
  ),
  histories as (
    select tp.player_id, tp.display_name, e.total_points, g.played_at, g.created_at,
           row_number() over (partition by tp.player_id order by g.played_at desc, g.created_at desc, e.id desc) as rn,
           sum(e.total_points) over (partition by tp.player_id order by g.played_at, g.created_at, e.id rows between unbounded preceding and current row) as running_points
    from top_players tp
    join public.jas_game_entries e on e.player_id = tp.player_id
    join public.jas_games g on g.id = e.game_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'display_name', h.display_name,
      'series', (
        select coalesce(jsonb_agg(jsonb_build_object('label', to_char(x.played_at,'DD Mon'),'points', x.total_points,'running_points', x.running_points) order by x.played_at, x.created_at), '[]'::jsonb)
        from (select * from histories hh where hh.player_id = h.player_id and hh.rn <= 20 order by hh.played_at, hh.created_at) x
      )
    ) order by h.display_name), '[]'::jsonb)
  into v_points_history
  from (select distinct player_id, display_name from histories) h;

  with base_summary as (
    select * from jsonb_to_recordset(leaderboard) as x(
      player_id bigint, display_name text, games_played integer, games_won integer, total_points integer, avg_points numeric, win_rate numeric,
      last_played_at date, best_game_points integer, worst_game_points integer, current_win_streak integer, longest_win_streak integer,
      games_this_month integer, points_this_month integer, recent_form text[], points_as_wij integer, points_as_zij integer
    )
  )
  select jsonb_build_object(
    'players', coalesce((select count(*) from base_summary),0),
    'games', coalesce((select count(*) from public.jas_games),0),
    'leader', coalesce((select display_name from base_summary order by games_won desc, total_points desc, display_name asc limit 1), '-'),
    'avg_points', coalesce((select round(avg(avg_points),1) from base_summary),0),
    'best_streak', coalesce((select max(longest_win_streak) from base_summary),0),
    'month_games', coalesce((select count(*) from public.jas_games g where g.played_at >= date_trunc('month', current_date)::date and g.played_at < (date_trunc('month', current_date) + interval '1 month')::date),0),
    'daily_games', v_daily,
    'monthly_games', v_monthly
  ) into v_summary;

  with ranked as (
    select * from jsonb_to_recordset(leaderboard) as x(
      player_id bigint, display_name text, games_played integer, games_won integer, total_points integer, avg_points numeric, win_rate numeric,
      last_played_at date, best_game_points integer, worst_game_points integer, current_win_streak integer, longest_win_streak integer,
      games_this_month integer, points_this_month integer, recent_form text[], points_as_wij integer, points_as_zij integer
    )
  )
  select coalesce(jsonb_agg(to_jsonb(t) order by t.total_points desc, t.display_name asc), '[]'::jsonb) into v_top_points
  from (select display_name, total_points from ranked order by total_points desc, display_name asc limit 8) t;

  with ranked as (
    select * from jsonb_to_recordset(leaderboard) as x(
      player_id bigint, display_name text, games_played integer, games_won integer, total_points integer, avg_points numeric, win_rate numeric,
      last_played_at date, best_game_points integer, worst_game_points integer, current_win_streak integer, longest_win_streak integer,
      games_this_month integer, points_this_month integer, recent_form text[], points_as_wij integer, points_as_zij integer
    )
  )
  select coalesce(jsonb_agg(to_jsonb(t) order by t.games_won desc, t.display_name asc), '[]'::jsonb) into v_top_wins
  from (select display_name, games_won from ranked order by games_won desc, display_name asc limit 8) t;

  with ranked as (
    select * from jsonb_to_recordset(leaderboard) as x(
      player_id bigint, display_name text, games_played integer, games_won integer, total_points integer, avg_points numeric, win_rate numeric,
      last_played_at date, best_game_points integer, worst_game_points integer, current_win_streak integer, longest_win_streak integer,
      games_this_month integer, points_this_month integer, recent_form text[], points_as_wij integer, points_as_zij integer
    )
  )
  select coalesce(jsonb_agg(to_jsonb(t) order by t.current_win_streak desc, t.longest_win_streak desc, t.display_name asc), '[]'::jsonb) into v_top_form
  from (select display_name, current_win_streak, longest_win_streak from ranked order by current_win_streak desc, longest_win_streak desc, display_name asc limit 8) t;

  with ranked as (
    select * from jsonb_to_recordset(leaderboard) as x(
      player_id bigint, display_name text, games_played integer, games_won integer, total_points integer, avg_points numeric, win_rate numeric,
      last_played_at date, best_game_points integer, worst_game_points integer, current_win_streak integer, longest_win_streak integer,
      games_this_month integer, points_this_month integer, recent_form text[], points_as_wij integer, points_as_zij integer
    )
  )
  select coalesce(jsonb_agg(to_jsonb(t) order by t.games_played desc, t.display_name asc), '[]'::jsonb) into v_player_breakdowns
  from (
    select display_name, games_played, games_won, total_points, avg_points, win_rate, best_game_points, worst_game_points, games_this_month, points_this_month, points_as_wij, points_as_zij, current_win_streak, longest_win_streak, recent_form
    from ranked order by games_played desc, total_points desc, display_name asc limit 20
  ) t;

  return jsonb_build_object(
    'leaderboard', leaderboard,
    'recent_games', recent_games,
    'summary', v_summary,
    'top_points', v_top_points,
    'top_wins', v_top_wins,
    'top_form', v_top_form,
    'player_histories', v_points_history,
    'player_breakdowns', v_player_breakdowns
  );
end;
$fn$;

comment on function public.get_jas_leaderboard(integer)
is 'Returns enriched admin-only klaverjas leaderboard stats, histories, trends, and recent games for leaderboard.html.';

grant execute on function public.get_jas_leaderboard(integer) to anon, authenticated;

-- -----------------------------
-- BEERPONG VAULT + ELO HISTORY
-- -----------------------------
create table if not exists public.beerpong_player_rating_history (
  id bigint generated by default as identity primary key,
  match_id bigint references public.beerpong_matches(id) on delete cascade,
  player_name text not null,
  rating_before numeric(10,2) not null,
  rating_after numeric(10,2) not null,
  created_at timestamptz not null default now()
);

create index if not exists beerpong_player_rating_history_player_idx on public.beerpong_player_rating_history (lower(player_name), created_at desc);
create index if not exists beerpong_player_rating_history_match_idx on public.beerpong_player_rating_history (match_id);

drop function if exists public.save_beerpong_match(text, text, jsonb);

create function public.save_beerpong_match(
  session_token text default null,
  client_match_id text default null,
  payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_player public.players%rowtype;
  v_match_id bigint;
  v_match_format text := lower(trim(coalesce(payload->>'match_format', '1v1')));
  v_team_a text[] := coalesce((select array_agg(value::text) from jsonb_array_elements_text(coalesce(payload->'team_a_player_names', '[]'::jsonb))), '{}'::text[]);
  v_team_b text[] := coalesce((select array_agg(value::text) from jsonb_array_elements_text(coalesce(payload->'team_b_player_names', '[]'::jsonb))), '{}'::text[]);
  v_winner_team text := nullif(lower(trim(coalesce(payload->>'winner_team', ''))), '');
  v_team_a_cups_left integer := nullif(payload->>'team_a_cups_left', '')::integer;
  v_team_b_cups_left integer := nullif(payload->>'team_b_cups_left', '')::integer;
  v_finished_at timestamptz := coalesce(nullif(payload->>'finished_at', '')::timestamptz, now());
  v_stats_applied boolean := false;
  v_existing_applied_at timestamptz;
  v_k_factor numeric := 32.0;
  v_team_a_avg numeric;
  v_team_b_avg numeric;
  v_expected_a numeric;
  v_expected_b numeric;
  v_actual_a numeric;
  v_actual_b numeric;
  v_delta_a numeric;
  v_delta_b numeric;
  v_name text;
  v_before numeric;
  v_after numeric;
begin
  if nullif(trim(coalesce(client_match_id, '')), '') is null then
    raise exception 'client_match_id ontbreekt';
  end if;
  if v_match_format not in ('1v1', '2v2') then
    raise exception 'match_format ongeldig';
  end if;
  if coalesce(array_length(v_team_a, 1), 0) not in (1, 2) then
    raise exception 'team A ongeldig';
  end if;
  if coalesce(array_length(v_team_b, 1), 0) not in (1, 2) then
    raise exception 'team B ongeldig';
  end if;
  if v_winner_team not in ('a', 'b', 'team_a', 'team_b') then
    raise exception 'winner_team ongeldig';
  end if;
  if v_winner_team='team_a' then v_winner_team := 'a'; end if;
  if v_winner_team='team_b' then v_winner_team := 'b'; end if;

  begin
    if nullif(trim(coalesce(session_token, '')), '') is not null then
      select * into v_player from public._gejast_player_from_session(session_token);
    end if;
  exception when others then
    null;
  end;

  insert into public.beerpong_matches (
    client_match_id, created_by_player_id, match_format, team_a_player_names, team_b_player_names,
    winner_team, team_a_cups_left, team_b_cups_left, finished_at, payload, updated_at
  ) values (
    client_match_id, v_player.id, v_match_format, v_team_a, v_team_b,
    v_winner_team, v_team_a_cups_left, v_team_b_cups_left, v_finished_at, coalesce(payload, '{}'::jsonb), now()
  )
  on conflict (client_match_id)
  do update set
    created_by_player_id = coalesce(public.beerpong_matches.created_by_player_id, excluded.created_by_player_id),
    match_format = excluded.match_format,
    team_a_player_names = excluded.team_a_player_names,
    team_b_player_names = excluded.team_b_player_names,
    winner_team = excluded.winner_team,
    team_a_cups_left = excluded.team_a_cups_left,
    team_b_cups_left = excluded.team_b_cups_left,
    finished_at = excluded.finished_at,
    payload = excluded.payload,
    updated_at = now()
  returning id, nullif(public.beerpong_matches.payload->>'ratings_applied_at', '')::timestamptz
  into v_match_id, v_existing_applied_at;

  if v_existing_applied_at is null then
    foreach v_name in array v_team_a loop perform public._beerpong_ensure_rating_row(v_name); end loop;
    foreach v_name in array v_team_b loop perform public._beerpong_ensure_rating_row(v_name); end loop;

    select avg(r.elo_rating) into v_team_a_avg from public.beerpong_player_ratings r where r.player_name = any(v_team_a);
    select avg(r.elo_rating) into v_team_b_avg from public.beerpong_player_ratings r where r.player_name = any(v_team_b);

    v_expected_a := public._beerpong_expected_score(v_team_a_avg, v_team_b_avg);
    v_expected_b := public._beerpong_expected_score(v_team_b_avg, v_team_a_avg);
    v_actual_a := case when v_winner_team = 'a' then 1 else 0 end;
    v_actual_b := case when v_winner_team = 'b' then 1 else 0 end;
    v_delta_a := v_k_factor * (v_actual_a - v_expected_a);
    v_delta_b := v_k_factor * (v_actual_b - v_expected_b);

    foreach v_name in array v_team_a loop
      select r.elo_rating into v_before from public.beerpong_player_ratings r where r.player_name = v_name;
      update public.beerpong_player_ratings r
         set elo_rating = r.elo_rating + (v_delta_a / greatest(coalesce(array_length(v_team_a, 1), 1), 1)),
             games_played = r.games_played + 1,
             wins = r.wins + case when v_winner_team = 'a' then 1 else 0 end,
             losses = r.losses + case when v_winner_team = 'b' then 1 else 0 end,
             last_match_at = v_finished_at,
             updated_at = now()
       where r.player_name = v_name;
      select r.elo_rating into v_after from public.beerpong_player_ratings r where r.player_name = v_name;
      insert into public.beerpong_player_rating_history(match_id, player_name, rating_before, rating_after, created_at)
      values (v_match_id, v_name, coalesce(v_before,1000), coalesce(v_after,1000), v_finished_at);
    end loop;

    foreach v_name in array v_team_b loop
      select r.elo_rating into v_before from public.beerpong_player_ratings r where r.player_name = v_name;
      update public.beerpong_player_ratings r
         set elo_rating = r.elo_rating + (v_delta_b / greatest(coalesce(array_length(v_team_b, 1), 1), 1)),
             games_played = r.games_played + 1,
             wins = r.wins + case when v_winner_team = 'b' then 1 else 0 end,
             losses = r.losses + case when v_winner_team = 'a' then 1 else 0 end,
             last_match_at = v_finished_at,
             updated_at = now()
       where r.player_name = v_name;
      select r.elo_rating into v_after from public.beerpong_player_ratings r where r.player_name = v_name;
      insert into public.beerpong_player_rating_history(match_id, player_name, rating_before, rating_after, created_at)
      values (v_match_id, v_name, coalesce(v_before,1000), coalesce(v_after,1000), v_finished_at);
    end loop;

    update public.beerpong_matches
       set payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{ratings_applied_at}', to_jsonb(now()::text), true),
           updated_at = now()
     where id = v_match_id;
    v_stats_applied := true;
  end if;

  return jsonb_build_object('ok', true, 'match_id', v_match_id, 'client_match_id', client_match_id, 'ratings_applied', v_stats_applied);
end;
$fn$;

create or replace function public.get_beerpong_vault_public(limit_count integer default 10)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_limit integer := greatest(coalesce(limit_count,10),1);
  v_leaderboard jsonb;
  v_recent jsonb;
  v_summary jsonb;
  v_elo_histories jsonb;
  v_fun_stats jsonb;
begin
  with board as (
    select
      r.player_name,
      round(r.elo_rating,2) as rating,
      r.games_played,
      r.wins,
      r.losses,
      case when r.games_played > 0 then round((100.0 * r.wins::numeric) / r.games_played::numeric, 1) else 0 end as winrate,
      r.last_match_at
    from public.beerpong_player_ratings r
    where exists (
      select 1 from public.players p where lower(p.display_name)=lower(r.player_name) and coalesce(p.active,false) is true
    )
    order by r.elo_rating desc, r.wins desc, lower(r.player_name)
    limit v_limit
  )
  select coalesce(jsonb_agg(to_jsonb(board) order by rating desc, wins desc, player_name), '[]'::jsonb) into v_leaderboard from board;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'created_at', m.created_at,
    'finished_at', m.finished_at,
    'match_format', m.match_format,
    'team_a_player_names', m.team_a_player_names,
    'team_b_player_names', m.team_b_player_names,
    'winner_team', m.winner_team,
    'team_a_cups_left', m.team_a_cups_left,
    'team_b_cups_left', m.team_b_cups_left,
    'winner_names', case when m.winner_team='a' then m.team_a_player_names else m.team_b_player_names end,
    'loser_names', case when m.winner_team='a' then m.team_b_player_names else m.team_a_player_names end,
    'margin', abs(coalesce(m.team_a_cups_left,0) - coalesce(m.team_b_cups_left,0))
  ) order by m.finished_at desc nulls last, m.created_at desc), '[]'::jsonb)
  into v_recent
  from (select * from public.beerpong_matches order by finished_at desc nulls last, created_at desc limit 30) m;

  with top_players as (
    select * from jsonb_to_recordset(v_leaderboard) as x(player_name text, rating numeric, games_played integer, wins integer, losses integer, winrate numeric, last_match_at timestamptz)
  ),
  histories as (
    select tp.player_name, h.created_at, h.rating_after,
           row_number() over (partition by tp.player_name order by h.created_at desc, h.id desc) as rn
    from top_players tp
    join public.beerpong_player_rating_history h on lower(h.player_name)=lower(tp.player_name)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'player_name', hh.player_name,
    'series', (
      select coalesce(jsonb_agg(jsonb_build_object('label', to_char(x.created_at,'DD Mon HH24:MI'),'rating', round(x.rating_after,2)) order by x.created_at), '[]'::jsonb)
      from (select * from histories hx where lower(hx.player_name)=lower(hh.player_name) and hx.rn <= 20 order by hx.created_at) x
    )
  ) order by hh.player_name), '[]'::jsonb)
  into v_elo_histories
  from (select distinct player_name from histories) hh;

  with recentm as (
    select * from public.beerpong_matches m order by finished_at desc nulls last, created_at desc limit 200
  )
  select jsonb_build_object(
    'players', coalesce((select count(*) from public.beerpong_player_ratings r where exists (select 1 from public.players p where lower(p.display_name)=lower(r.player_name) and coalesce(p.active,false) is true)),0),
    'matches', coalesce((select count(*) from public.beerpong_matches),0),
    'leader', coalesce((select player_name from public.beerpong_player_ratings r where exists (select 1 from public.players p where lower(p.display_name)=lower(r.player_name) and coalesce(p.active,false) is true) order by elo_rating desc, wins desc, lower(player_name) limit 1), '-'),
    'avg_elo', coalesce((select round(avg(elo_rating),1) from public.beerpong_player_ratings r where exists (select 1 from public.players p where lower(p.display_name)=lower(r.player_name) and coalesce(p.active,false) is true)),0),
    'top_winrate', coalesce((select max(case when games_played>0 then round((100.0 * wins::numeric) / games_played::numeric, 1) else 0 end) from public.beerpong_player_ratings),0)
  ) into v_summary;

  with stats as (
    select
      (select jsonb_build_object('label','Grootste zege','value', coalesce((select concat_ws(' + ', (case when winner_team='a' then team_a_player_names else team_b_player_names end)) from public.beerpong_matches order by abs(coalesce(team_a_cups_left,0)-coalesce(team_b_cups_left,0)) desc, finished_at desc nulls last limit 1), '-'), 'meta', coalesce((select abs(coalesce(team_a_cups_left,0)-coalesce(team_b_cups_left,0)) from public.beerpong_matches order by abs(coalesce(team_a_cups_left,0)-coalesce(team_b_cups_left,0)) desc, finished_at desc nulls last limit 1),0)) as biggest_blowout,
      (select jsonb_build_object('label','Meeste potjes','value', coalesce((select player_name from public.beerpong_player_ratings order by games_played desc, wins desc, lower(player_name) limit 1), '-'), 'meta', coalesce((select games_played from public.beerpong_player_ratings order by games_played desc, wins desc, lower(player_name) limit 1),0)) as grinder,
      (select jsonb_build_object('label','Beste vorm','value', coalesce((select player_name from public.beerpong_player_ratings where games_played>=3 order by (wins::numeric/nullif(games_played,0)) desc, games_played desc, lower(player_name) limit 1), '-'), 'meta', coalesce((select round((100.0*wins::numeric)/nullif(games_played,0),1) from public.beerpong_player_ratings where games_played>=3 order by (wins::numeric/nullif(games_played,0)) desc, games_played desc, lower(player_name) limit 1),0)) as best_form,
      (select jsonb_build_object('label','Hoogste ELO','value', coalesce((select player_name from public.beerpong_player_ratings order by elo_rating desc, wins desc, lower(player_name) limit 1), '-'), 'meta', coalesce((select round(elo_rating,1) from public.beerpong_player_ratings order by elo_rating desc, wins desc, lower(player_name) limit 1),0)) as peak_elo
  )
  select jsonb_build_object('biggest_blowout', biggest_blowout, 'grinder', grinder, 'best_form', best_form, 'peak_elo', peak_elo) into v_fun_stats from stats;

  return jsonb_build_object(
    'leaderboard', v_leaderboard,
    'recent_matches', coalesce(v_recent, '[]'::jsonb),
    'summary', v_summary,
    'elo_histories', coalesce(v_elo_histories, '[]'::jsonb),
    'fun_stats', v_fun_stats
  );
end;
$fn$;

grant execute on function public.save_beerpong_match(text, text, jsonb) to anon, authenticated;
grant execute on function public.get_beerpong_vault_public(integer) to anon, authenticated;

commit;
