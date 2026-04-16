-- GEJAST v553 - Pikken lobby cleanup + leave RPC
begin;

create or replace function public._pikken_prune_empty_lobbies()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_deleted integer := 0;
begin
  with doomed as (
    select g.id
    from public.pikken_games g
    where lower(coalesce(g.status,'')) = 'lobby'
      and not exists (
        select 1
        from public.pikken_game_players p
        where p.game_id = g.id
      )
  ),
  deleted as (
    delete from public.pikken_games g
    using doomed d
    where g.id = d.id
    returning 1
  )
  select count(*) into v_deleted from deleted;

  return coalesce(v_deleted, 0);
end;
$fn$;

create or replace function public.pikken_leave_lobby_scoped(
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
  v_remaining integer := 0;
  v_new_host_id bigint := null;
  v_new_host_name text := null;
begin
  select * into p from public._gejast_player_from_session(session_token);
  if p.id is null then
    raise exception 'Niet ingelogd.';
  end if;

  perform public._pikken_prune_empty_lobbies();

  select * into g
  from public.pikken_games
  where id = game_id_input
  for update;

  if g.id is null then
    return jsonb_build_object('ok', true, 'left', true, 'game_deleted', true, 'deleted_lobbies', 0);
  end if;

  if lower(coalesce(g.status,'')) <> 'lobby' then
    raise exception 'Deze lobby is al gestart.';
  end if;

  delete from public.pikken_game_players
  where game_id = g.id
    and player_id = p.id;

  if not found then
    raise exception 'Je zit niet in deze lobby.';
  end if;

  select count(*) into v_remaining
  from public.pikken_game_players
  where game_id = g.id;

  if v_remaining <= 0 then
    delete from public.pikken_games where id = g.id;
    return jsonb_build_object(
      'ok', true,
      'left', true,
      'game_deleted', true,
      'deleted_lobbies', 1
    );
  end if;

  if g.created_by_player_id is distinct from p.id then
    v_new_host_id := g.created_by_player_id;
    v_new_host_name := g.created_by_player_name;
  else
    select gp.player_id, gp.player_name
      into v_new_host_id, v_new_host_name
    from public.pikken_game_players gp
    where gp.game_id = g.id
    order by gp.seat_index
    limit 1;
  end if;

  update public.pikken_games
     set created_by_player_id = v_new_host_id,
         created_by_player_name = v_new_host_name,
         state_version = state_version + 1,
         updated_at = now()
   where id = g.id;

  perform public._pikken_publish_spectator_summary(session_token, g.id);

  return jsonb_build_object(
    'ok', true,
    'left', true,
    'game_deleted', false,
    'remaining_players', v_remaining,
    'game_id', g.id,
    'lobby_code', g.lobby_code,
    'new_host_player_id', v_new_host_id,
    'new_host_name', v_new_host_name
  );
end;
$fn$;

grant execute on function public.pikken_leave_lobby_scoped(text, uuid) to anon, authenticated;

do $fn$
begin
  perform public._pikken_prune_empty_lobbies();
end;
$fn$;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
