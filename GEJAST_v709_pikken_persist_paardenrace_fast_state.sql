-- GEJAST v709: persist completed Pikken matches and fix Paardenrace ready/state RPC order.

begin;

do $drop$
declare
  rec record;
begin
  for rec in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('get_paardenrace_room_state_fast_v687','pikken_record_completed_match_v709')
  loop
    execute format('drop function if exists %I.%I(%s) cascade', rec.nspname, rec.proname, rec.args);
  end loop;
end
$drop$;

create table if not exists public.pikken_match_archive_v709 (
  game_id uuid primary key,
  lobby_code text,
  site_scope text not null default 'friends',
  status text,
  started_at timestamptz,
  finished_at timestamptz,
  winner_player_id bigint,
  winner_name text,
  round_count integer not null default 0,
  player_count integer not null default 0,
  final_state jsonb not null default '{}'::jsonb,
  players jsonb not null default '[]'::jsonb,
  reveal jsonb not null default '{}'::jsonb,
  saved_at timestamptz not null default now()
);

create table if not exists public.pikken_player_stats_v709 (
  site_scope text not null default 'friends',
  player_id bigint not null,
  player_name text not null,
  games_played integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  dice_lost integer not null default 0,
  rounds_played integer not null default 0,
  last_game_id uuid,
  last_played_at timestamptz not null default now(),
  primary key(site_scope, player_id)
);

create or replace function public.get_paardenrace_room_state_fast_v687(
  session_token text default null,
  session_token_input text default null,
  room_code_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  p public.players%rowtype;
  r public.paardenrace_rooms%rowtype;
  v_token text := coalesce(session_token_input, session_token);
  v_players jsonb := '[]'::jsonb;
  v_viewer jsonb := '{}'::jsonb;
  v_pending jsonb := '[]'::jsonb;
  v_player_count integer := 0;
  v_ready_count integer := 0;
  v_verified_count integer := 0;
  v_pot integer := 0;
begin
  if nullif(trim(coalesce(room_code_input,'')), '') is null then
    return jsonb_build_object('room', null, 'players', '[]'::jsonb, 'viewer', '{}'::jsonb, 'pending_verifications', '[]'::jsonb);
  end if;

  begin
    select * into p from public._gejast_player_from_session(v_token);
  exception when others then
    null;
  end;

  select *
    into r
  from public.paardenrace_rooms
  where upper(trim(coalesce(room_code,''))) = upper(trim(room_code_input))
    and coalesce(stage,'lobby') not in ('closed','deleted','archived')
  order by updated_at desc nulls last, id desc
  limit 1;

  if r.id is null then
    return jsonb_build_object('room', null, 'players', '[]'::jsonb, 'viewer', '{}'::jsonb, 'pending_verifications', '[]'::jsonb);
  end if;

  update public.paardenrace_rooms
     set updated_at = greatest(coalesce(updated_at, now()), now() - interval '2 seconds')
   where id = r.id;

  with rows as (
    select
      rp.*,
      case lower(coalesce(rp.selected_suit,''))
        when 'hearts' then 'Harten'
        when 'harten' then 'Harten'
        when 'diamonds' then 'Ruiten'
        when 'ruiten' then 'Ruiten'
        when 'clubs' then 'Klaveren'
        when 'klaveren' then 'Klaveren'
        when 'spades' then 'Schoppen'
        when 'schoppen' then 'Schoppen'
        else coalesce(rp.selected_suit,'-')
      end as selected_suit_label,
      (rp.player_id is not distinct from p.id
        or lower(coalesce(rp.player_name,'')) = lower(coalesce(to_jsonb(p)->>'display_name', to_jsonb(p)->>'name', to_jsonb(p)->>'email', ''))) as is_viewer
    from public.paardenrace_room_players rp
    where rp.room_id = r.id
    order by rp.joined_at nulls first, rp.id
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'player_id', player_id,
      'player_name', player_name,
      'selected_suit', selected_suit,
      'selected_suit_label', selected_suit_label,
      'wager_bakken', coalesce(wager_bakken,0),
      'wager_verified', coalesce(wager_verified,false),
      'is_ready', coalesce(is_ready,false),
      'is_host', player_id is not distinct from r.host_player_id or lower(player_name)=lower(coalesce(r.host_name,''))
    ) order by joined_at nulls first, id), '[]'::jsonb),
    count(*)::integer,
    count(*) filter (where coalesce(is_ready,false))::integer,
    count(*) filter (where coalesce(wager_verified,false))::integer,
    coalesce(sum(coalesce(wager_bakken,0)),0)::integer
  into v_players, v_player_count, v_ready_count, v_verified_count, v_pot
  from rows;

  select coalesce(jsonb_build_object(
      'player_id', rp.player_id,
      'player_name', rp.player_name,
      'selected_suit', rp.selected_suit,
      'selected_suit_label', case lower(coalesce(rp.selected_suit,''))
        when 'hearts' then 'Harten'
        when 'harten' then 'Harten'
        when 'diamonds' then 'Ruiten'
        when 'ruiten' then 'Ruiten'
        when 'clubs' then 'Klaveren'
        when 'klaveren' then 'Klaveren'
        when 'spades' then 'Schoppen'
        when 'schoppen' then 'Schoppen'
        else coalesce(rp.selected_suit,'-')
      end,
      'wager_bakken', coalesce(rp.wager_bakken,0),
      'wager_verified', coalesce(rp.wager_verified,false),
      'is_ready', coalesce(rp.is_ready,false),
      'is_host', rp.player_id is not distinct from r.host_player_id or lower(rp.player_name)=lower(coalesce(r.host_name,'')),
      'has_locked_choice', rp.selected_suit is not null and coalesce(rp.wager_bakken,0) > 0
    ), '{}'::jsonb)
    into v_viewer
  from public.paardenrace_room_players rp
  where rp.room_id = r.id
    and (rp.player_id is not distinct from p.id
      or lower(coalesce(rp.player_name,'')) = lower(coalesce(to_jsonb(p)->>'display_name', to_jsonb(p)->>'name', to_jsonb(p)->>'email', '')))
  order by rp.joined_at nulls first, rp.id
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'player_id', rp.player_id,
    'player_name', rp.player_name,
    'selected_suit', rp.selected_suit,
    'selected_suit_label', case lower(coalesce(rp.selected_suit,''))
      when 'hearts' then 'Harten'
      when 'harten' then 'Harten'
      when 'diamonds' then 'Ruiten'
      when 'ruiten' then 'Ruiten'
      when 'clubs' then 'Klaveren'
      when 'klaveren' then 'Klaveren'
      when 'spades' then 'Schoppen'
      when 'schoppen' then 'Schoppen'
      else coalesce(rp.selected_suit,'-')
    end,
    'wager_bakken', coalesce(rp.wager_bakken,0),
    'wager_verified', coalesce(rp.wager_verified,false)
  ) order by rp.joined_at nulls first, rp.id), '[]'::jsonb)
    into v_pending
  from public.paardenrace_room_players rp
  where rp.room_id = r.id
    and coalesce(rp.wager_bakken,0) > 0
    and not coalesce(rp.wager_verified,false);

  return jsonb_build_object(
    'room', jsonb_build_object(
      'id', r.id,
      'room_code', r.room_code,
      'stage', coalesce(r.stage,'lobby'),
      'stage_label', initcap(coalesce(r.stage,'lobby')),
      'host_player_id', r.host_player_id,
      'host_name', r.host_name,
      'pot_bakken', v_pot,
      'can_start', v_player_count >= 2 and v_ready_count = v_player_count and v_verified_count = v_player_count
    ),
    'players', v_players,
    'viewer', v_viewer,
    'pending_verifications', v_pending,
    '_ready_override', jsonb_build_object('ready', v_ready_count, 'total', v_player_count),
    '_pot_override', v_pot
  );
end
$fn$;

create or replace function public.pikken_record_completed_match_v709(
  session_token text default null,
  session_token_input text default null,
  game_id_input uuid default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  g public.pikken_games%rowtype;
  v_scope text := coalesce(nullif(site_scope_input,''),'friends');
  v_players jsonb := '[]'::jsonb;
  v_reveal jsonb := '{}'::jsonb;
  v_winner_id bigint;
  v_winner_name text;
  v_round_count integer := 0;
  v_player_count integer := 0;
begin
  if game_id_input is null then
    raise exception 'Pikken game_id ontbreekt.';
  end if;

  select * into g
  from public.pikken_games
  where id = game_id_input
  limit 1;

  if g.id is null then
    raise exception 'Pikken game niet gevonden.';
  end if;

  if coalesce(g.status, g.state->>'phase', '') not in ('finished','deleted','closed') then
    return jsonb_build_object('ok', false, 'saved', false, 'reason', 'not_finished');
  end if;

  v_scope := coalesce(nullif(g.site_scope,''), v_scope, 'friends');
  v_reveal := coalesce(g.state->'last_reveal', '{}'::jsonb);
  v_round_count := greatest(0, coalesce(nullif(v_reveal->>'round_no','')::integer, nullif(g.state->>'round_no','')::integer, 0));

  select gp.player_id, gp.player_name
    into v_winner_id, v_winner_name
  from public.pikken_game_players gp
  where gp.game_id = g.id
    and gp.eliminated_at is null
    and coalesce(gp.dice_count,0) > 0
  order by coalesce(gp.dice_count,0) desc, gp.seat_index
  limit 1;

  select count(*)::integer,
         coalesce(jsonb_agg(to_jsonb(gp) order by gp.seat_index), '[]'::jsonb)
    into v_player_count, v_players
  from public.pikken_game_players gp
  where gp.game_id = g.id;

  insert into public.pikken_match_archive_v709(
    game_id, lobby_code, site_scope, status, started_at, finished_at,
    winner_player_id, winner_name, round_count, player_count, final_state, players, reveal, saved_at
  )
  values (
    g.id, g.lobby_code, v_scope, coalesce(g.status, g.state->>'phase'), g.created_at, coalesce(g.finished_at, now()),
    v_winner_id, v_winner_name, v_round_count, v_player_count, coalesce(g.state,'{}'::jsonb), v_players, v_reveal, now()
  )
  on conflict (game_id) do update set
    status = excluded.status,
    finished_at = excluded.finished_at,
    winner_player_id = excluded.winner_player_id,
    winner_name = excluded.winner_name,
    round_count = excluded.round_count,
    player_count = excluded.player_count,
    final_state = excluded.final_state,
    players = excluded.players,
    reveal = excluded.reveal,
    saved_at = now();

  insert into public.pikken_player_stats_v709(
    site_scope, player_id, player_name, games_played, wins, losses, dice_lost, rounds_played, last_game_id, last_played_at
  )
  select
    v_scope,
    gp.player_id,
    gp.player_name,
    1,
    case when gp.player_id is not distinct from v_winner_id then 1 else 0 end,
    case when gp.player_id is distinct from v_winner_id then 1 else 0 end,
    greatest(0, coalesce((g.config->>'start_dice')::integer, 6) - coalesce(gp.dice_count,0)),
    v_round_count,
    g.id,
    now()
  from public.pikken_game_players gp
  where gp.game_id = g.id
    and gp.player_id is not null
  on conflict (site_scope, player_id) do update set
    player_name = excluded.player_name,
    games_played = public.pikken_player_stats_v709.games_played + 1,
    wins = public.pikken_player_stats_v709.wins + excluded.wins,
    losses = public.pikken_player_stats_v709.losses + excluded.losses,
    dice_lost = public.pikken_player_stats_v709.dice_lost + excluded.dice_lost,
    rounds_played = public.pikken_player_stats_v709.rounds_played + excluded.rounds_played,
    last_game_id = excluded.last_game_id,
    last_played_at = now();

  return jsonb_build_object(
    'ok', true,
    'saved', true,
    'game_id', g.id,
    'winner_player_id', v_winner_id,
    'winner_name', v_winner_name,
    'round_count', v_round_count,
    'player_count', v_player_count
  );
end
$fn$;

grant execute on function public.get_paardenrace_room_state_fast_v687(text,text,text,text) to anon, authenticated;
grant execute on function public.pikken_record_completed_match_v709(text,text,uuid,text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
