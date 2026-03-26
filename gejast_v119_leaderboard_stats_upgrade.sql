begin;

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
begin
  with entry_rows as (
    select
      p.id as player_id,
      p.display_name,
      e.id as entry_id,
      e.game_id,
      e.total_points,
      e.is_winner,
      g.played_at,
      g.created_at,
      row_number() over (partition by p.id order by g.played_at desc, g.created_at desc, e.id desc) as rn_desc,
      row_number() over (partition by p.id order by g.played_at, g.created_at, e.id) as rn_asc,
      row_number() over (partition by p.id, e.is_winner order by g.played_at, g.created_at, e.id) as rn_by_result
    from public.players p
    left join public.jas_game_entries e on e.player_id = p.id
    left join public.jas_games g on g.id = e.game_id
  ),
  streak_groups as (
    select
      player_id,
      display_name,
      is_winner,
      played_at,
      total_points,
      rn_asc - rn_by_result as grp
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
    from entry_rows
    where entry_id is not null
      and is_winner is true
      and not exists (
        select 1
        from entry_rows later
        where later.player_id = entry_rows.player_id
          and later.entry_id is not null
          and (later.played_at, later.created_at, later.entry_id) > (entry_rows.played_at, entry_rows.created_at, entry_rows.entry_id)
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
      coalesce(rf.recent_form, array[]::text[]) as recent_form
    from public.players p
    left join public.jas_game_entries e on e.player_id = p.id
    left join public.jas_games g on g.id = e.game_id
    left join current_streak cs on cs.player_id = p.id
    left join longest_streak ls on ls.player_id = p.id
    left join month_stats ms on ms.player_id = p.id
    left join recent_form rf on rf.player_id = p.id
    group by p.id, p.display_name, cs.current_win_streak, ls.longest_win_streak, ms.games_this_month, ms.points_this_month, rf.recent_form
  )
  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.games_won desc, row_data.total_points desc, row_data.display_name asc), '[]'::jsonb)
  into leaderboard
  from (
    select *
    from base
    where games_played > 0
    order by games_won desc, total_points desc, display_name asc
    limit v_limit
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
        coalesce((select jsonb_agg(e.display_name order by e.seat_no, e.id) from public.jas_game_entries e where e.game_id = g.id and e.is_winner = true), '[]'::jsonb) as winners
      from public.jas_games g
      order by g.played_at desc, g.created_at desc
      limit 20
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

  with ranked as (
    select * from jsonb_to_recordset(leaderboard) as x(
      player_id bigint,
      display_name text,
      games_played integer,
      games_won integer,
      total_points integer,
      avg_points numeric,
      win_rate numeric,
      last_played_at date,
      best_game_points integer,
      worst_game_points integer,
      current_win_streak integer,
      longest_win_streak integer,
      games_this_month integer,
      points_this_month integer,
      recent_form text[]
    )
  )
  select coalesce(jsonb_agg(to_jsonb(t) order by t.total_points desc, t.display_name asc), '[]'::jsonb)
    into v_top_points
  from (select display_name, total_points from ranked order by total_points desc, display_name asc limit 8) t;

  with ranked as (
    select * from jsonb_to_recordset(leaderboard) as x(
      player_id bigint,
      display_name text,
      games_played integer,
      games_won integer,
      total_points integer,
      avg_points numeric,
      win_rate numeric,
      last_played_at date,
      best_game_points integer,
      worst_game_points integer,
      current_win_streak integer,
      longest_win_streak integer,
      games_this_month integer,
      points_this_month integer,
      recent_form text[]
    )
  )
  select coalesce(jsonb_agg(to_jsonb(t) order by t.games_won desc, t.display_name asc), '[]'::jsonb)
    into v_top_wins
  from (select display_name, games_won from ranked order by games_won desc, display_name asc limit 8) t;

  with ranked as (
    select * from jsonb_to_recordset(leaderboard) as x(
      player_id bigint,
      display_name text,
      games_played integer,
      games_won integer,
      total_points integer,
      avg_points numeric,
      win_rate numeric,
      last_played_at date,
      best_game_points integer,
      worst_game_points integer,
      current_win_streak integer,
      longest_win_streak integer,
      games_this_month integer,
      points_this_month integer,
      recent_form text[]
    )
  )
  select coalesce(jsonb_agg(to_jsonb(t) order by t.current_win_streak desc, t.longest_win_streak desc, t.display_name asc), '[]'::jsonb)
    into v_top_form
  from (select display_name, current_win_streak from ranked order by current_win_streak desc, longest_win_streak desc, display_name asc limit 8) t;

  with base_summary as (
    select * from jsonb_to_recordset(leaderboard) as x(
      player_id bigint,
      display_name text,
      games_played integer,
      games_won integer,
      total_points integer,
      avg_points numeric,
      win_rate numeric,
      last_played_at date,
      best_game_points integer,
      worst_game_points integer,
      current_win_streak integer,
      longest_win_streak integer,
      games_this_month integer,
      points_this_month integer,
      recent_form text[]
    )
  )
  select jsonb_build_object(
    'players', coalesce((select count(*) from base_summary),0),
    'games', coalesce((select count(*) from public.jas_games),0),
    'leader', coalesce((select display_name from base_summary order by games_won desc, total_points desc, display_name asc limit 1), '-'),
    'avg_points', coalesce((select round(avg(avg_points),1) from base_summary),0),
    'best_streak', coalesce((select max(longest_win_streak) from base_summary),0),
    'month_games', coalesce((select count(*) from public.jas_games g where g.played_at >= date_trunc('month', current_date)::date and g.played_at < (date_trunc('month', current_date) + interval '1 month')::date),0),
    'daily_games', v_daily
  ) into v_summary;

  return jsonb_build_object(
    'leaderboard', leaderboard,
    'recent_games', recent_games,
    'summary', v_summary,
    'top_points', v_top_points,
    'top_wins', v_top_wins,
    'top_form', v_top_form
  );
end;
$fn$;

comment on function public.get_jas_leaderboard(integer)
is 'Returns enriched registered-player klaverjas leaderboard stats, streaks, daily activity, and recent games for leaderboard.html.';

grant execute on function public.get_jas_leaderboard(integer) to anon, authenticated;

commit;
