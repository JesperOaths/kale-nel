-- GEJAST v700: remove Paardenrace ready overloads and complete the Pikken live action pipeline.

begin;

drop function if exists public._gejast_scope_norm_v700(text);

create or replace function public._gejast_scope_norm_v700(site_scope_input text default 'friends')
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
        'pikken_set_ready_scoped',
        'pikken_place_bid_scoped',
        'pikken_reject_bid_scoped',
        'pikken_cast_vote_scoped',
        'pikken_leave_game_scoped'
      )
  loop
    execute format('drop function if exists %I.%I(%s) cascade', rec.nspname, rec.proname, rec.args);
  end loop;
end
$drop$;

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
begin
  if to_regprocedure('public.update_paardenrace_room_choice_safe(text,text,text,text,integer,boolean)') is not null then
    return public.update_paardenrace_room_choice_safe(session_token, session_token_input, room_code_input, null, null, ready_input);
  end if;
  if to_regprocedure('public.get_paardenrace_room_state_safe(text,text,text)') is not null then
    return public.get_paardenrace_room_state_safe(session_token, session_token_input, room_code_input);
  end if;
  raise exception 'paardenrace_ready_backend_missing';
end
$fn$;

create or replace function public._pikken_next_alive_seat_v700(game_id_input uuid, after_seat_input integer)
returns integer
language sql
stable
as $fn$
  with alive as (
    select seat_index
    from public.pikken_game_players
    where game_id = game_id_input
      and eliminated_at is null
    order by seat_index
  )
  select coalesce(
    (select seat_index from alive where seat_index > coalesce(after_seat_input, 0) order by seat_index limit 1),
    (select seat_index from alive order by seat_index limit 1),
    after_seat_input
  )
$fn$;

create or replace function public._pikken_round_no_v700(g public.pikken_games)
returns integer
language sql
stable
as $fn$
  select greatest(1, coalesce(nullif(coalesce(g.state,'{}'::jsonb)->>'round_no','')::integer, 1))
$fn$;

create or replace function public.pikken_set_ready_scoped(
  session_token text default null,
  session_token_input text default null,
  game_id_input uuid default null,
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
  g public.pikken_games%rowtype;
begin
  select * into p from public._gejast_player_from_session(coalesce(session_token_input, session_token));
  if p.id is null then raise exception 'Niet ingelogd.'; end if;

  select * into g
  from public.pikken_games
  where id = game_id_input
    and public._gejast_scope_norm_v700(site_scope) = public._gejast_scope_norm_v700(site_scope_input)
  for update;
  if g.id is null then raise exception 'Pikken game niet gevonden.'; end if;

  update public.pikken_game_players
     set ready = coalesce(ready_input, false)
   where game_id = g.id
     and player_id = p.id;

  if not found then raise exception 'Je zit niet in deze Pikken lobby.'; end if;

  update public.pikken_games set updated_at = now(), state_version = coalesce(state_version,0)+1 where id = g.id;
  return public._pikken_build_state_v695(g.id, coalesce(session_token_input, session_token), site_scope_input);
end
$fn$;

create or replace function public.pikken_place_bid_scoped(
  session_token text default null,
  session_token_input text default null,
  game_id_input uuid default null,
  bid_count_input integer default null,
  bid_face_input integer default null,
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
  v_count integer := greatest(1, coalesce(bid_count_input, 0));
  v_face integer := coalesce(bid_face_input, 0);
  v_next integer;
begin
  if v_face not between 1 and 6 then raise exception 'Ongeldige biedwaarde.'; end if;
  select * into p from public._gejast_player_from_session(coalesce(session_token_input, session_token));
  if p.id is null then raise exception 'Niet ingelogd.'; end if;

  select * into g from public.pikken_games where id = game_id_input and public._gejast_scope_norm_v700(site_scope)=public._gejast_scope_norm_v700(site_scope_input) for update;
  if g.id is null then raise exception 'Pikken game niet gevonden.'; end if;
  select * into gp from public.pikken_game_players where game_id = g.id and player_id = p.id and eliminated_at is null;
  if gp.player_id is null then raise exception 'Je bent niet actief in deze Pikken match.'; end if;
  if lower(coalesce(g.status,'')) not in ('bidding','live','active') and lower(coalesce(g.state->>'phase','')) <> 'bidding' then
    raise exception 'Er kan nu niet geboden worden.';
  end if;
  if coalesce((g.state->>'current_turn_seat')::integer, gp.seat_index) <> gp.seat_index then
    raise exception 'Je bent niet aan de beurt.';
  end if;

  v_round := public._pikken_round_no_v700(g);
  v_next := public._pikken_next_alive_seat_v700(g.id, gp.seat_index);

  update public.pikken_games
     set status = 'bidding',
         state = coalesce(state,'{}'::jsonb)
           || jsonb_build_object(
             'phase','bidding',
             'round_no',v_round,
             'current_turn_seat',v_next,
             'bid',jsonb_build_object('count',v_count,'face',v_face,'bidder_id',p.id,'bidder_name',gp.player_name,'bidder_seat',gp.seat_index)
           ),
         state_version = coalesce(state_version,0)+1,
         updated_at = now()
   where id = g.id;

  return public._pikken_build_state_v695(g.id, coalesce(session_token_input, session_token), site_scope_input);
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
begin
  select * into p from public._gejast_player_from_session(coalesce(session_token_input, session_token));
  if p.id is null then raise exception 'Niet ingelogd.'; end if;
  select * into g from public.pikken_games where id = game_id_input and public._gejast_scope_norm_v700(site_scope)=public._gejast_scope_norm_v700(site_scope_input) for update;
  if g.id is null then raise exception 'Pikken game niet gevonden.'; end if;
  select * into gp from public.pikken_game_players where game_id = g.id and player_id = p.id and eliminated_at is null;
  if gp.player_id is null then raise exception 'Je bent niet actief in deze Pikken match.'; end if;
  if g.state->'bid' is null then raise exception 'Er is nog geen bod om af te keuren.'; end if;
  v_round := public._pikken_round_no_v700(g);
  delete from public.pikken_round_votes where game_id = g.id and round_no = v_round;
  update public.pikken_games
     set status = 'voting',
         state = coalesce(state,'{}'::jsonb) || jsonb_build_object('phase','voting','vote_turn_seat',public._pikken_next_alive_seat_v700(g.id, gp.seat_index),'challenger_id',p.id,'challenger_name',gp.player_name,'challenger_seat',gp.seat_index),
         state_version = coalesce(state_version,0)+1,
         updated_at = now()
   where id = g.id;
  return public._pikken_build_state_v695(g.id, coalesce(session_token_input, session_token), site_scope_input);
end
$fn$;

create or replace function public._pikken_finish_vote_v700(
  game_id_input uuid,
  session_token_input text,
  site_scope_input text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  g public.pikken_games%rowtype;
  v_round integer;
  v_alive integer;
  v_votes integer;
  v_bid jsonb;
  v_count integer;
  v_face integer;
  v_total integer;
  v_bid_true boolean;
  v_loser_id bigint;
  v_next integer;
begin
  select * into g from public.pikken_games where id = game_id_input for update;
  v_round := public._pikken_round_no_v700(g);
  select count(*) into v_alive from public.pikken_game_players where game_id = g.id and eliminated_at is null;
  select count(*) into v_votes from public.pikken_round_votes where game_id = g.id and round_no = v_round;
  if v_votes < v_alive then
    update public.pikken_games
       set state = coalesce(state,'{}'::jsonb) || jsonb_build_object('vote_turn_seat', public._pikken_next_alive_seat_v700(g.id, coalesce((g.state->>'vote_turn_seat')::integer,0))),
           state_version = coalesce(state_version,0)+1,
           updated_at = now()
     where id = g.id;
    return public._pikken_build_state_v695(g.id, session_token_input, site_scope_input);
  end if;

  v_bid := g.state->'bid';
  v_count := coalesce((v_bid->>'count')::integer, 0);
  v_face := coalesce((v_bid->>'face')::integer, 0);
  select coalesce(sum(public._pikken_count_bid_hits(h.dice_values, v_face)),0)
    into v_total
  from public.pikken_round_hands h
  where h.game_id = g.id and h.round_no = v_round;
  v_bid_true := v_total >= v_count;
  v_loser_id := case when v_bid_true then nullif(g.state->>'challenger_id','')::bigint else nullif(v_bid->>'bidder_id','')::bigint end;

  if v_loser_id is not null then
    update public.pikken_game_players
       set dice_count = greatest(0, coalesce(dice_count,0)-1),
           eliminated_at = case when greatest(0, coalesce(dice_count,0)-1) <= 0 then now() else eliminated_at end
     where game_id = g.id and player_id = v_loser_id;
  end if;

  select min(seat_index) into v_next from public.pikken_game_players where game_id = g.id and eliminated_at is null;
  update public.pikken_games
     set status = 'bidding',
         state = coalesce(state,'{}'::jsonb)
           || jsonb_build_object('phase','bidding','current_turn_seat',coalesce(v_next,1),'last_reveal',jsonb_build_object('bid',v_bid,'bid_true',v_bid_true,'counted_total',v_total,'loser_id',v_loser_id),'bid',null),
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
begin
  select * into p from public._gejast_player_from_session(coalesce(session_token_input, session_token));
  if p.id is null then raise exception 'Niet ingelogd.'; end if;
  select * into g from public.pikken_games where id = game_id_input and public._gejast_scope_norm_v700(site_scope)=public._gejast_scope_norm_v700(site_scope_input) for update;
  if g.id is null then raise exception 'Pikken game niet gevonden.'; end if;
  select * into gp from public.pikken_game_players where game_id = g.id and player_id = p.id and eliminated_at is null;
  if gp.player_id is null then raise exception 'Je bent niet actief in deze Pikken match.'; end if;
  v_round := public._pikken_round_no_v700(g);
  delete from public.pikken_round_votes where game_id = g.id and round_no = v_round and player_id = p.id;
  insert into public.pikken_round_votes(game_id, round_no, player_id, vote)
  values (g.id, v_round, p.id, coalesce(vote_input,false));
  return public._pikken_finish_vote_v700(g.id, coalesce(session_token_input, session_token), site_scope_input);
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
begin
  select * into p from public._gejast_player_from_session(coalesce(session_token_input, session_token));
  if p.id is null then raise exception 'Niet ingelogd.'; end if;
  delete from public.pikken_game_players where game_id = game_id_input and player_id = p.id;
  update public.pikken_games set updated_at = now(), state_version = coalesce(state_version,0)+1 where id = game_id_input;
  return jsonb_build_object('ok', true, 'left', true, 'game_id', game_id_input);
end
$fn$;

grant execute on function public.set_paardenrace_ready_safe(text,text,text,boolean,text) to anon, authenticated;
grant execute on function public.pikken_set_ready_scoped(text,text,uuid,boolean,text) to anon, authenticated;
grant execute on function public.pikken_place_bid_scoped(text,text,uuid,integer,integer,text) to anon, authenticated;
grant execute on function public.pikken_reject_bid_scoped(text,text,uuid,text) to anon, authenticated;
grant execute on function public.pikken_cast_vote_scoped(text,text,uuid,boolean,text) to anon, authenticated;
grant execute on function public.pikken_leave_game_scoped(text,text,uuid,text) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
