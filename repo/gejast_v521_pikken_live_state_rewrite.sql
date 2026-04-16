-- GEJAST v521 — dedicated public pikken live state reader
begin;

create or replace function public.pikken_get_live_state_public(
  game_id_input uuid default null,
  lobby_code_input text default null,
  site_scope_input text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  g public.pikken_games%rowtype;
  st jsonb;
  current_round_no int;
  players jsonb := '[]'::jsonb;
  votes jsonb := '[]'::jsonb;
  totals jsonb;
  r record;
  scope_key text := case
    when site_scope_input is null or btrim(site_scope_input) = '' then null
    else public._scope_norm(site_scope_input)
  end;
begin
  if game_id_input is not null then
    select * into g
    from public.pikken_games
    where id = game_id_input
      and (scope_key is null or public._scope_norm(site_scope) = scope_key)
    limit 1;
  elsif lobby_code_input is not null and btrim(lobby_code_input) <> '' then
    select * into g
    from public.pikken_games
    where upper(coalesce(lobby_code,'')) = upper(btrim(lobby_code_input))
      and (scope_key is null or public._scope_norm(site_scope) = scope_key)
    order by updated_at desc nulls last
    limit 1;
  end if;

  if g.id is null then
    raise exception 'Pikken game niet gevonden.';
  end if;

  st := coalesce(g.state, '{}'::jsonb);
  current_round_no := coalesce(nullif(st->>'round_no','')::int,0);

  for r in
    select seat_index, player_name, ready, dice_count, (eliminated_at is null) as alive
    from public.pikken_game_players
    where game_id = g.id
    order by seat_index
  loop
    players := players || jsonb_build_array(jsonb_build_object(
      'seat', r.seat_index,
      'name', r.player_name,
      'ready', r.ready,
      'dice_count', r.dice_count,
      'alive', r.alive
    ));
  end loop;

  if lower(coalesce(st->>'phase','')) = 'voting' and current_round_no > 0 then
    for r in
      select
        gp.seat_index,
        gp.player_name,
        (
          select v.vote
          from public.pikken_round_votes v
          where v.game_id = g.id
            and v.round_no = current_round_no
            and v.player_id = gp.player_id
        ) as vote_value
      from public.pikken_game_players gp
      where gp.game_id = g.id
        and gp.eliminated_at is null
      order by gp.seat_index
    loop
      votes := votes || jsonb_build_array(jsonb_build_object(
        'seat', r.seat_index,
        'name', r.player_name,
        'status', case when r.vote_value is true then 'approved' when r.vote_value is false then 'rejected' else 'waiting' end
      ));
    end loop;
  end if;

  totals := jsonb_build_object(
    'start_total', (select count(*)*6 from public.pikken_game_players where game_id = g.id),
    'current_total', (select coalesce(sum(dice_count),0) from public.pikken_game_players where game_id = g.id),
    'lost_total', greatest(
      (select count(*)*6 from public.pikken_game_players where game_id = g.id)
      - (select coalesce(sum(dice_count),0) from public.pikken_game_players where game_id = g.id),
      0
    )
  );

  return jsonb_build_object(
    'ok', true,
    'game', jsonb_build_object(
      'id', g.id,
      'lobby_code', g.lobby_code,
      'site_scope', g.site_scope,
      'status', g.status,
      'config', coalesce(g.config, '{}'::jsonb),
      'state', coalesce(g.state, '{}'::jsonb),
      'state_version', g.state_version,
      'updated_at', g.updated_at,
      'finished_at', g.finished_at,
      'last_reveal', coalesce(g.state->'last_reveal', 'null'::jsonb)
    ),
    'players', players,
    'votes', votes,
    'dice_totals', totals
  );
end;
$function$;

grant execute on function public.pikken_get_live_state_public(uuid, text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
