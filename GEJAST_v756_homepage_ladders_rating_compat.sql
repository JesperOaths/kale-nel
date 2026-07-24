begin;

-- v756: Homepage ladder RPC rating-column compatibility.
-- Fixes live failure: get_homepage_ladders_public_scoped -> get_homepage_ladders_public
-- raised "column r.rating does not exist" when beerpong_player_ratings only has elo_rating.
-- This replacement chooses the available beerpong rating column before composing SQL,
-- so PostgreSQL never parses a reference to a missing column.

create or replace function public.get_homepage_ladders_public()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_klaverjas jsonb := '[]'::jsonb;
  v_boerenbridge jsonb := '[]'::jsonb;
  v_beerpong jsonb := '[]'::jsonb;
  v_beerpong_rating_col text := null;
begin
  if to_regclass('public.game_elo_ratings') is not null
     and to_regclass('public.jas_game_entries') is not null
     and to_regclass('public.jas_games') is not null then
    execute $$
      with name_pool as (
        select distinct lower(trim(coalesce(e.display_name,''))) as name_norm
        from public.jas_game_entries e
        join public.jas_games j on j.id = e.game_id
        where j.deleted_at is null
          and nullif(trim(coalesce(e.display_name,'')), '') is not null
      )
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'player_name', x.player_name,
            'display_name', x.player_name,
            'elo_rating', round(x.elo_rating,2),
            'rating', round(x.elo_rating,2),
            'games_played', coalesce(x.games_played,0),
            'wins', coalesce(x.wins,0)
          ) order by x.elo_rating desc, x.wins desc, lower(x.player_name)
        ),
        '[]'::jsonb
      )
      from (
        select r.*
        from public.game_elo_ratings r
        join name_pool np on np.name_norm = lower(trim(coalesce(r.player_name,'')))
        where r.game_key = 'klaverjas'
          and coalesce(r.games_played,0) > 0
          and public._is_public_site_name(r.player_name)
        order by r.elo_rating desc, r.wins desc, lower(r.player_name)
        limit 5
      ) x$$ into v_klaverjas;
  end if;

  if to_regclass('public.boerenbridge_matches') is not null then
    if to_regclass('public.game_elo_ratings') is not null then
      execute $$
        with name_pool as (
          select distinct lower(trim(coalesce(pv->>'name', pv->>'display_name', pv->>'player_name', ''))) as name_norm
          from public.boerenbridge_matches m
          cross join lateral jsonb_array_elements(coalesce(m.payload->'players', m.payload#>'{raw_payload,players}', '[]'::jsonb)) pv
          where m.deleted_at is null
            and coalesce(lower(m.match_status),'')='finished'
            and nullif(trim(coalesce(pv->>'name', pv->>'display_name', pv->>'player_name', '')), '') is not null
        )
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'player_name', x.player_name,
              'display_name', x.player_name,
              'elo_rating', round(x.elo_rating,2),
              'rating', round(x.elo_rating,2),
              'games_played', coalesce(x.games_played,0),
              'wins', coalesce(x.wins,0)
            ) order by x.elo_rating desc, x.wins desc, lower(x.player_name)
          ),
          '[]'::jsonb
        )
        from (
          select r.*
          from public.game_elo_ratings r
          join name_pool np on np.name_norm = lower(trim(coalesce(r.player_name,'')))
          where r.game_key = 'boerenbridge'
            and coalesce(r.games_played,0) > 0
            and public._is_public_site_name(r.player_name)
          order by r.elo_rating desc, r.wins desc, lower(r.player_name)
          limit 5
        ) x$$ into v_boerenbridge;
    elsif to_regclass('public.boerenbridge_player_ratings') is not null then
      execute $$
        with name_pool as (
          select distinct lower(trim(coalesce(pv->>'name', pv->>'display_name', pv->>'player_name', ''))) as name_norm
          from public.boerenbridge_matches m
          cross join lateral jsonb_array_elements(coalesce(m.payload->'players', m.payload#>'{raw_payload,players}', '[]'::jsonb)) pv
          where m.deleted_at is null
            and coalesce(lower(m.match_status),'')='finished'
            and nullif(trim(coalesce(pv->>'name', pv->>'display_name', pv->>'player_name', '')), '') is not null
        )
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'player_name', x.player_name,
              'display_name', x.player_name,
              'elo_rating', round(x.elo_rating,2),
              'rating', round(x.elo_rating,2),
              'games_played', coalesce(x.games_played,0),
              'wins', coalesce(x.wins,0)
            ) order by x.elo_rating desc, x.wins desc, lower(x.player_name)
          ),
          '[]'::jsonb
        )
        from (
          select r.*
          from public.boerenbridge_player_ratings r
          join name_pool np on np.name_norm = lower(trim(coalesce(r.player_name,'')))
          where coalesce(r.games_played,0) > 0
            and public._is_public_site_name(r.player_name)
          order by r.elo_rating desc, r.wins desc, lower(r.player_name)
          limit 5
        ) x$$ into v_boerenbridge;
    end if;
  end if;

  if to_regclass('public.beerpong_matches') is not null
     and to_regclass('public.beerpong_player_ratings') is not null then
    select case
      when exists (
        select 1 from information_schema.columns
        where table_schema='public' and table_name='beerpong_player_ratings' and column_name='elo_rating'
      ) then 'elo_rating'
      when exists (
        select 1 from information_schema.columns
        where table_schema='public' and table_name='beerpong_player_ratings' and column_name='rating'
      ) then 'rating'
      else null
    end into v_beerpong_rating_col;

    if v_beerpong_rating_col is not null then
      execute format($sql$
        with name_pool as (
          select distinct lower(trim(v.name)) as name_norm
          from public.beerpong_matches m
          cross join lateral unnest(coalesce(m.team_a_player_names,'{}'::text[]) || coalesce(m.team_b_player_names,'{}'::text[])) as v(name)
          where m.deleted_at is null
            and nullif(trim(v.name), '') is not null
        )
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'player_name', x.player_name,
              'display_name', x.player_name,
              'elo_rating', round(x.rating_value,2),
              'rating', round(x.rating_value,2),
              'games_played', coalesce(x.games_played,0),
              'wins', coalesce(x.wins,0)
            ) order by x.rating_value desc, x.wins desc, lower(x.player_name)
          ),
          '[]'::jsonb
        )
        from (
          select r.player_name,
                 r.%1$I as rating_value,
                 r.games_played,
                 r.wins
          from public.beerpong_player_ratings r
          join name_pool np on np.name_norm = lower(trim(coalesce(r.player_name,'')))
          where coalesce(r.games_played,0) > 0
            and public._is_public_site_name(r.player_name)
          order by r.%1$I desc, r.wins desc, lower(r.player_name)
          limit 5
        ) x$sql$, v_beerpong_rating_col) into v_beerpong;
    end if;
  end if;

  return jsonb_build_object(
    'klaverjas', coalesce(v_klaverjas,'[]'::jsonb),
    'boerenbridge', coalesce(v_boerenbridge,'[]'::jsonb),
    'beerpong', coalesce(v_beerpong,'[]'::jsonb)
  );
end;
$fn$;

grant execute on function public.get_homepage_ladders_public() to anon, authenticated;

commit;
