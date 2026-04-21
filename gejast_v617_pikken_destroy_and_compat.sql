-- GEJAST v617 - Pikken destroy + compatibility wrappers
begin;

create or replace function public.pikken_destroy_lobby_scoped(
  session_token text,
  game_id_input uuid
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
  select * into p from public._gejast_player_from_session(session_token);
  if p.id is null then
    raise exception 'Niet ingelogd.';
  end if;

  select * into g
  from public.pikken_games
  where id = game_id_input
  for update;

  if g.id is null then
    return jsonb_build_object('ok', true, 'destroyed', true, 'already_missing', true);
  end if;

  if lower(coalesce(g.status,'')) <> 'lobby' then
    raise exception 'Deze lobby is al gestart.';
  end if;

  if g.created_by_player_id is distinct from p.id then
    raise exception 'Alleen de host mag deze lobby verwijderen.';
  end if;

  delete from public.pikken_round_votes where game_id = g.id;
  delete from public.pikken_game_players where game_id = g.id;
  delete from public.pikken_games where id = g.id;

  return jsonb_build_object('ok', true, 'destroyed', true, 'game_id', game_id_input);
end;
$fn$;

grant execute on function public.pikken_destroy_lobby_scoped(text, uuid) to anon, authenticated;

create or replace function public.pikken_destroy_game_scoped(
  session_token text,
  game_id_input uuid
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
  select public.pikken_destroy_lobby_scoped(session_token, game_id_input);
$fn$;

grant execute on function public.pikken_destroy_game_scoped(text, uuid) to anon, authenticated;

create or replace function public.pikken_leave_game_scoped(
  session_token text,
  game_id_input uuid
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
  select public.pikken_leave_lobby_scoped(session_token, game_id_input);
$fn$;

grant execute on function public.pikken_leave_game_scoped(text, uuid) to anon, authenticated;

create or replace function public.pikken_kick_player_scoped(
  game_id_input uuid,
  seat_index_input integer,
  seat_input text,
  session_token text,
  target_seat_input text
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
  select public.pikken_kick_player_scoped(
    session_token => session_token,
    game_id_input => game_id_input,
    seat_index_input => seat_index_input,
    player_name_input => nullif(coalesce(target_seat_input, seat_input), ''),
    site_scope_input => 'friends'
  );
$fn$;

grant execute on function public.pikken_kick_player_scoped(uuid, integer, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
