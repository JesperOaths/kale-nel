-- GEJAST v705: Pikken reveal animation hands/counts, Paardenrace ready repair, central VERSION sync.

begin;

drop function if exists public._gejast_scope_norm_v702(text);

create or replace function public._gejast_scope_norm_v702(site_scope_input text default 'friends')
returns text
language sql
stable
as $fn$
  select case when lower(coalesce(site_scope_input, 'friends')) in ('family','familie') then 'family' else 'friends' end
$fn$;

do $drop$
declare
  rec record;
begin
  for rec in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'set_paardenrace_ready_safe',
        '_pikken_count_bid_hits',
        '_pikken_next_alive_seat_v702',
        '_pikken_deal_round_v702',
        '_pikken_finish_vote_v702',
        'pikken_reject_bid_scoped',
        'pikken_cast_vote_scoped',
        'pikken_leave_game_scoped'
      )
  loop
    execute format('drop function if exists %I.%I(%s) cascade', rec.nspname, rec.proname, rec.args);
  end loop;
end
$drop$;

create or replace function public._pikken_count_bid_hits(dice_input integer[], face_input integer)
returns integer
language sql
immutable
as $fn$
  select coalesce(sum(case when d = face_input or d = 1 then 1 else 0 end), 0)::integer
  from unnest(coalesce(dice_input, array[]::integer[])) as d
$fn$;

create or replace function public._pikken_next_alive_seat_v702(
  game_id_input uuid,
  after_seat_input integer,
  exclude_player_id_input bigint default null
)
returns integer
language sql
stable
as $fn$
  with alive as (
    select seat_index
    from public.pikken_game_players
    where game_id = game_id_input
      and eliminated_at is null
      and (exclude_player_id_input is null or player_id is distinct from exclude_player_id_input)
    order by seat_index
  )
  select coalesce(
    (select seat_index from alive where seat_index > coalesce(after_seat_input, 0) order by seat_index limit 1),
    (select seat_index from alive order by seat_index limit 1),
    after_seat_input
  )
$fn$;

create or replace function public._pikken_deal_round_v702(game_id_input uuid, round_no_input integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  r record;
begin
  delete from public.pikken_round_hands
  where game_id = game_id_input
    and round_no = round_no_input;

  for r in
    select player_id, greatest(0, coalesce(dice_count,0)) as dice_count
    from public.pikken_game_players
    where game_id = game_id_input
      and eliminated_at is null
    order by seat_index
  loop
    insert into public.pikken_round_hands(game_id, round_no, player_id, dice_values, created_at)
    select game_id_input, round_no_input, r.player_id,
           coalesce(array_agg((1 + floor(random()*6))::integer), array[]::integer[]),
           now()
    from generate_series(1, r.dice_count);
  end loop;
end
$fn$;

create or replace function public.set_paardenrace_ready_safe(
  session_token text default null,
  session_token_input text default null,
  room_code_input text default null,
  ready_input boolean default false,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  p public.players%rowtype;
  v_room_id bigint;
  v_name text;
  v_name_alt text;
  v_updated integer := 0;
begin
  select * into p from public._gejast_player_from_session(coalesce(session_token_input, session_token));
  if p.id is null then raise exception 'Niet ingelogd.'; end if;

  v_name := coalesce(to_jsonb(p)->>'display_name', to_jsonb(p)->>'name', to_jsonb(p)->>'username', to_jsonb(p)->>'login_name', to_jsonb(p)->>'email', '');
  v_name_alt := coalesce(to_jsonb(p)->>'name', to_jsonb(p)->>'display_name', to_jsonb(p)->>'username', to_jsonb(p)->>'login_name', to_jsonb(p)->>'email', '');

  select r.id into v_room_id
  from public.paardenrace_rooms r
  where upper(trim(coalesce(r.room_code,''))) = upper(trim(coalesce(room_code_input,'')))
  order by r.updated_at desc nulls last, r.id desc
  limit 1;

  if v_room_id is null then raise exception 'Room niet gevonden.'; end if;

  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='paardenrace_room_players' and column_name='is_ready') then
    execute 'update public.paardenrace_room_players set is_ready = $1, updated_at = now() where room_id = $2 and (player_id::text = $3::text or lower(coalesce(player_name,'''')) in (lower($4), lower($5)))'
      using coalesce(ready_input,false), v_room_id, p.id, v_name, v_name_alt;
  elsif exists(select 1 from information_schema.columns where table_schema='public' and table_name='paardenrace_room_players' and column_name='ready') then
    execute 'update public.paardenrace_room_players set ready = $1, updated_at = now() where room_id = $2 and (player_id::text = $3::text or lower(coalesce(player_name,'''')) in (lower($4), lower($5)))'
      using coalesce(ready_input,false), v_room_id, p.id, v_name, v_name_alt;
  else
    raise exception 'paardenrace_ready_column_missing';
  end if;

  get diagnostics v_updated = row_count;
  if coalesce(v_updated,0) <= 0 then raise exception 'Je zit niet in deze Paardenrace room.'; end if;
  update public.paardenrace_rooms set updated_at = now() where id = v_room_id;

  if to_regprocedure('public.get_paardenrace_room_state_fast_v687(text,text,text,text)') is not null then
    return public.get_paardenrace_room_state_fast_v687(session_token, session_token_input, room_code_input, site_scope_input);
  end if;
  if to_regprocedure('public.get_paardenrace_room_state_safe(text,text,text)') is not null then
    return public.get_paardenrace_room_state_safe(session_token, session_token_input, room_code_input);
  end if;
  return jsonb_build_object('ok', true, 'ready', coalesce(ready_input,false), 'room_id', v_room_id);
end
$fn$;

create or replace function public._pikken_insert_vote_v702(game_id_input uuid, round_no_input integer, player_id_input bigint, vote_input boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  delete from public.pikken_round_votes
  where game_id = game_id_input and round_no = round_no_input and player_id = player_id_input;

  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='pikken_round_votes' and column_name='voted_at') then
    execute 'insert into public.pikken_round_votes(game_id, round_no, player_id, vote, voted_at) values ($1,$2,$3,$4,now())'
      using game_id_input, round_no_input, player_id_input, coalesce(vote_input,false);
  else
    insert into public.pikken_round_votes(game_id, round_no, player_id, vote)
    values (game_id_input, round_no_input, player_id_input, coalesce(vote_input,false));
  end if;
end
$fn$;

create or replace function public.pikken_reject_bid_scoped(
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
  p public.players%rowtype;
  gp public.pikken_game_players%rowtype;
  g public.pikken_games%rowtype;
  v_round integer;
  v_bidder_id bigint;
begin
  select * into p from public._gejast_player_from_session(coalesce(session_token_input, session_token));
  if p.id is null then raise exception 'Niet ingelogd.'; end if;

  select * into g
  from public.pikken_games
  where id = game_id_input
    and public._gejast_scope_norm_v702(site_scope)=public._gejast_scope_norm_v702(site_scope_input)
  for update;
  if g.id is null then raise exception 'Pikken game niet gevonden.'; end if;

  select * into gp
  from public.pikken_game_players
  where game_id = g.id and player_id = p.id and eliminated_at is null;
  if gp.player_id is null then raise exception 'Je bent niet actief in deze Pikken match.'; end if;

  if g.state->'bid' is null or jsonb_typeof(g.state->'bid') <> 'object' then
    raise exception 'Er is nog geen bod om af te keuren.';
  end if;
  v_bidder_id := nullif(g.state->'bid'->>'bidder_id','')::bigint;
  if v_bidder_id is not null and v_bidder_id = p.id then
    raise exception 'Je mag je eigen bod niet afkeuren.';
  end if;

  v_round := greatest(1, coalesce(nullif(coalesce(g.state,'{}'::jsonb)->>'round_no','')::integer, 1));
  delete from public.pikken_round_votes where game_id = g.id and round_no = v_round;
  perform public._pikken_insert_vote_v702(g.id, v_round, p.id, false);

  update public.pikken_games
     set status = 'voting',
         state = coalesce(state,'{}'::jsonb)
           || jsonb_build_object(
             'phase','voting',
             'vote_turn_seat', public._pikken_next_alive_seat_v702(g.id, gp.seat_index, v_bidder_id),
             'challenger_id', p.id,
             'challenger_name', gp.player_name,
             'challenger_seat', gp.seat_index
           ),
         state_version = coalesce(state_version,0)+1,
         updated_at = now()
   where id = g.id;

  return public._pikken_finish_vote_v702(g.id, coalesce(session_token_input, session_token), site_scope_input);
end
$fn$;

create or replace function public._pikken_finish_vote_v702(game_id_input uuid, session_token_input text, site_scope_input text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  g public.pikken_games%rowtype;
  v_round integer;
  v_eligible integer;
  v_votes integer;
  v_bid jsonb;
  v_bidder_id bigint;
  v_challenger_id bigint;
  v_count integer;
  v_face integer;
  v_total integer;
  v_bid_true boolean;
  v_mode text;
  v_loser_id bigint;
  v_loser_seat integer;
  v_loser_name text;
  v_loser_dice_after integer;
  v_next_round integer;
  v_next_seat integer;
  v_alive_after integer;
  v_loser_alive boolean;
  v_reveal jsonb;
  v_reveal_hands jsonb := '[]'::jsonb;
begin
  select * into g from public.pikken_games where id = game_id_input for update;
  if g.id is null then raise exception 'Pikken game niet gevonden.'; end if;

  v_round := greatest(1, coalesce(nullif(coalesce(g.state,'{}'::jsonb)->>'round_no','')::integer, 1));
  v_bid := g.state->'bid';
  if v_bid is null or jsonb_typeof(v_bid) <> 'object' then
    raise exception 'Geen actief bod om te beoordelen.';
  end if;

  v_bidder_id := nullif(v_bid->>'bidder_id','')::bigint;
  v_challenger_id := nullif(g.state->>'challenger_id','')::bigint;
  v_count := coalesce((v_bid->>'count')::integer, 0);
  v_face := coalesce((v_bid->>'face')::integer, 0);
  if v_bidder_id is null or v_challenger_id is null or v_count <= 0 or v_face not between 1 and 6 then
    raise exception 'Pikken stemstatus is ongeldig; plaats of keur het bod opnieuw af.';
  end if;

  select count(*) into v_eligible
  from public.pikken_game_players
  where game_id = g.id and eliminated_at is null and player_id is distinct from v_bidder_id;

  select count(*) into v_votes
  from public.pikken_round_votes
  where game_id = g.id
    and round_no = v_round
    and player_id in (
      select player_id from public.pikken_game_players
      where game_id = g.id and eliminated_at is null and player_id is distinct from v_bidder_id
    );

  if v_votes < greatest(1, v_eligible) then
    update public.pikken_games
       set state = coalesce(state,'{}'::jsonb)
             || jsonb_build_object('vote_turn_seat', public._pikken_next_alive_seat_v702(g.id, coalesce((g.state->>'vote_turn_seat')::integer,0), v_bidder_id)),
           state_version = coalesce(state_version,0)+1,
           updated_at = now()
     where id = g.id;
    return public._pikken_build_state_v695(g.id, session_token_input, site_scope_input);
  end if;

  select coalesce(sum(public._pikken_count_bid_hits(h.dice_values, v_face)),0)
    into v_total
  from public.pikken_round_hands h
  where h.game_id = g.id and h.round_no = v_round;

  v_bid_true := v_total >= v_count;
  v_mode := lower(coalesce(g.config->>'penalty_mode', 'wrong_loses'));
  v_loser_id := case
    when v_mode in ('right_loses','goed_verliest','fair') then case when v_bid_true then v_bidder_id else v_challenger_id end
    else case when v_bid_true then v_challenger_id else v_bidder_id end
  end;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'seat', gp.seat_index,
      'name', gp.player_name,
      'loser', gp.player_id = v_loser_id,
      'dice', coalesce((
        select jsonb_agg(jsonb_build_object('value', d, 'counted', (d = v_face or d = 1)) order by case when d = 1 then 7 else d end)
        from unnest(coalesce(h.dice_values, array[]::integer[])) as d
      ), '[]'::jsonb)
    )
    order by gp.seat_index
  ), '[]'::jsonb)
    into v_reveal_hands
  from public.pikken_round_hands h
  join public.pikken_game_players gp on gp.game_id = h.game_id and gp.player_id = h.player_id
  where h.game_id = g.id and h.round_no = v_round;

  select seat_index, player_name into v_loser_seat, v_loser_name
  from public.pikken_game_players
  where game_id = g.id and player_id = v_loser_id;

  update public.pikken_game_players
     set dice_count = greatest(0, coalesce(dice_count,0)-1),
         eliminated_at = case when greatest(0, coalesce(dice_count,0)-1) <= 0 then now() else eliminated_at end
   where game_id = g.id and player_id = v_loser_id
   returning dice_count into v_loser_dice_after;

  if v_loser_dice_after is null then
    raise exception 'Pikken kon de verliezer niet bijwerken.';
  end if;

  select count(*) into v_alive_after
  from public.pikken_game_players
  where game_id = g.id and eliminated_at is null;

  v_reveal := jsonb_build_object(
    'round_no', v_round,
    'bid', v_bid,
    'bid_true', v_bid_true,
    'counted_total', v_total,
    'loser_id', v_loser_id,
    'loser_name', v_loser_name,
    'loser_seat', v_loser_seat,
    'loser_dice_after', v_loser_dice_after,
    'penalty_mode', v_mode,
    'dice_private', false,
    'hands', v_reveal_hands
  );

  if v_alive_after <= 1 then
    update public.pikken_games
       set status = 'finished',
           finished_at = now(),
           state = coalesce(state,'{}'::jsonb) || jsonb_build_object('phase','finished','last_reveal',v_reveal),
           state_version = coalesce(state_version,0)+1,
           updated_at = now()
     where id = g.id;
    return public._pikken_build_state_v695(g.id, session_token_input, site_scope_input);
  end if;

  v_next_round := v_round + 1;
  select exists(
    select 1 from public.pikken_game_players
    where game_id = g.id and player_id = v_loser_id and eliminated_at is null
  ) into v_loser_alive;
  v_next_seat := case when v_loser_alive then v_loser_seat else public._pikken_next_alive_seat_v702(g.id, coalesce(v_loser_seat,0), null) end;
  perform public._pikken_deal_round_v702(g.id, v_next_round);
  delete from public.pikken_round_votes where game_id = g.id and round_no <= v_round;

  update public.pikken_games
     set status = 'bidding',
         state = jsonb_build_object(
           'phase','bidding',
           'round_no',v_next_round,
           'current_turn_seat',v_next_seat,
           'last_reveal', v_reveal || jsonb_build_object('next_round',v_next_round,'next_starter_seat',v_next_seat)
         ),
         state_version = coalesce(state_version,0)+1,
         updated_at = now()
   where id = g.id;

  return public._pikken_build_state_v695(g.id, session_token_input, site_scope_input);
end
$fn$;

create or replace function public.pikken_cast_vote_scoped(
  session_token text default null,
  session_token_input text default null,
  game_id_input uuid default null,
  vote_input boolean default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  p public.players%rowtype;
  gp public.pikken_game_players%rowtype;
  g public.pikken_games%rowtype;
  v_round integer;
  v_bidder_id bigint;
begin
  select * into p from public._gejast_player_from_session(coalesce(session_token_input, session_token));
  if p.id is null then raise exception 'Niet ingelogd.'; end if;

  select * into g
  from public.pikken_games
  where id = game_id_input
    and public._gejast_scope_norm_v702(site_scope)=public._gejast_scope_norm_v702(site_scope_input)
  for update;
  if g.id is null then raise exception 'Pikken game niet gevonden.'; end if;

  v_bidder_id := nullif(g.state->'bid'->>'bidder_id','')::bigint;
  if v_bidder_id is not null and v_bidder_id = p.id then
    raise exception 'Je mag niet stemmen op je eigen bod.';
  end if;

  select * into gp
  from public.pikken_game_players
  where game_id = g.id and player_id = p.id and eliminated_at is null;
  if gp.player_id is null then raise exception 'Je bent niet actief in deze Pikken match.'; end if;

  v_round := greatest(1, coalesce(nullif(coalesce(g.state,'{}'::jsonb)->>'round_no','')::integer, 1));
  perform public._pikken_insert_vote_v702(g.id, v_round, p.id, coalesce(vote_input,false));

  return public._pikken_finish_vote_v702(g.id, coalesce(session_token_input, session_token), site_scope_input);
end
$fn$;

create or replace function public.pikken_leave_game_scoped(
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
  p public.players%rowtype;
  g public.pikken_games%rowtype;
  v_alive integer;
  v_deleted boolean := false;
begin
  select * into p from public._gejast_player_from_session(coalesce(session_token_input, session_token));
  if p.id is null then raise exception 'Niet ingelogd.'; end if;

  select * into g
  from public.pikken_games
  where id = game_id_input
    and public._gejast_scope_norm_v702(site_scope)=public._gejast_scope_norm_v702(site_scope_input)
  for update;
  if g.id is null then
    return jsonb_build_object('ok', true, 'deleted', true, 'reason', 'game_not_found');
  end if;

  delete from public.pikken_round_votes where game_id = g.id and player_id = p.id;
  delete from public.pikken_round_hands where game_id = g.id and player_id = p.id;
  delete from public.pikken_game_players where game_id = g.id and player_id = p.id;

  select count(*) into v_alive
  from public.pikken_game_players
  where game_id = g.id and eliminated_at is null;

  if v_alive <= 1 then
    v_deleted := true;
    delete from public.pikken_round_votes where game_id = g.id;
    delete from public.pikken_round_hands where game_id = g.id;

    update public.pikken_games
       set status = 'finished',
           finished_at = coalesce(finished_at, now()),
           state = coalesce(state,'{}'::jsonb) || jsonb_build_object('phase','deleted','deleted_reason','not_enough_players'),
           state_version = coalesce(state_version,0)+1,
           updated_at = now()
     where id = g.id;

    if exists(select 1 from information_schema.columns where table_schema='public' and table_name='pikken_games' and column_name='deleted_at') then
      execute 'update public.pikken_games set deleted_at = coalesce(deleted_at, now()) where id = $1' using g.id;
    end if;
  else
    update public.pikken_games
       set state_version = coalesce(state_version,0)+1,
           updated_at = now()
     where id = g.id;
  end if;

  return jsonb_build_object('ok', true, 'deleted', v_deleted, 'remaining_active_players', v_alive);
end
$fn$;

grant execute on function public.set_paardenrace_ready_safe(text,text,text,boolean,text) to anon, authenticated;
grant execute on function public.pikken_reject_bid_scoped(text,text,uuid,text) to anon, authenticated;
grant execute on function public.pikken_cast_vote_scoped(text,text,uuid,boolean,text) to anon, authenticated;
grant execute on function public.pikken_leave_game_scoped(text,text,uuid,text) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;


