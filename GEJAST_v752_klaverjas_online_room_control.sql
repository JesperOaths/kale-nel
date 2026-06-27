-- GEJAST v752: Klaverjas online room control.
-- Adds host close/delete support and blocks one human player from joining or
-- creating multiple active Klaverjas rooms at the same time.

begin;

create or replace function public._klaverjas_online_player_active_room(
  player_name_input text,
  site_scope_input text default 'friends',
  exclude_game_id uuid default null
)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select g.id
    from public.klaverjas_online_games g
   where g.site_scope = case when lower(coalesce(site_scope_input, 'friends')) = 'family' then 'family' else 'friends' end
     and g.status not in ('finished', 'closed')
     and (exclude_game_id is null or g.id <> exclude_game_id)
     and exists (
       select 1
         from jsonb_array_elements(coalesce(g.state -> 'players', '[]'::jsonb)) p
        where lower(p ->> 'name') = lower(coalesce(player_name_input, ''))
          and not coalesce((p ->> 'is_bot')::boolean, false)
     )
   order by g.updated_at desc
   limit 1
$fn$;

create or replace function public.klaverjas_online_create(session_token text, site_scope_input text default 'friends', settings_input jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  session_player public.players%rowtype;
  code text;
  dealer_out integer;
  game_row public.klaverjas_online_games%rowtype;
  use_scope text := case when lower(coalesce(site_scope_input, 'friends')) = 'family' then 'family' else 'friends' end;
  bot_count integer := greatest(0, least(3, coalesce((settings_input ->> 'bot_count')::integer, 0)));
  players_out jsonb;
  bot_roster jsonb := coalesce(settings_input -> 'bot_roster', '[]'::jsonb);
  bot_item jsonb;
  bot_seat integer;
  bot_difficulty text;
begin
  session_player := public._jas_session_player(session_token);
  if public._klaverjas_online_player_active_room(session_player.display_name, use_scope, null) is not null then
    raise exception 'Je zit al aan een actieve klaverjastafel. Open of sluit die tafel eerst.';
  end if;

  dealer_out := floor(random() * 4)::integer;
  loop
    code := public._klaverjas_online_code();
    exit when not exists (select 1 from public.klaverjas_online_games where upper(lobby_code) = upper(code));
  end loop;

  players_out := jsonb_build_array(jsonb_build_object('seat', 0, 'name', session_player.display_name, 'team', 1, 'is_bot', false, 'player_type', 'human'));
  if jsonb_typeof(bot_roster) = 'array' and jsonb_array_length(bot_roster) > 0 then
    for bot_item in select * from jsonb_array_elements(bot_roster)
    loop
      bot_seat := greatest(1, least(3, coalesce((bot_item ->> 'seat')::integer, jsonb_array_length(players_out))));
      bot_difficulty := case when lower(coalesce(bot_item ->> 'bot_difficulty', bot_item ->> 'difficulty', 'hard')) = 'easy' then 'easy' else 'hard' end;
      if not exists (select 1 from jsonb_array_elements(players_out) p where (p ->> 'seat')::integer = bot_seat) then
        players_out := players_out || jsonb_build_array(jsonb_build_object(
          'seat', bot_seat,
          'name', coalesce(nullif(bot_item ->> 'name', ''), case when bot_difficulty = 'easy' then 'Leerling Bot' else 'Scherpe Bot' end),
          'team', case when bot_seat in (0,2) then 1 else 2 end,
          'is_bot', true,
          'player_type', 'bot',
          'bot_difficulty', bot_difficulty
        ));
      end if;
    end loop;
  else
    if bot_count >= 1 then
      players_out := players_out || jsonb_build_array(jsonb_build_object('seat', 1, 'name', 'Scherpe Schoppen', 'team', 2, 'is_bot', true, 'player_type', 'bot', 'bot_difficulty', 'hard'));
    end if;
    if bot_count >= 2 then
      players_out := players_out || jsonb_build_array(jsonb_build_object('seat', 2, 'name', 'Scherpe Harten', 'team', 1, 'is_bot', true, 'player_type', 'bot', 'bot_difficulty', 'hard'));
    end if;
    if bot_count >= 3 then
      players_out := players_out || jsonb_build_array(jsonb_build_object('seat', 3, 'name', 'Scherpe Ruiten', 'team', 2, 'is_bot', true, 'player_type', 'bot', 'bot_difficulty', 'hard'));
    end if;
  end if;

  insert into public.klaverjas_online_games (
    lobby_code,
    site_scope,
    created_by_player_id,
    created_by_player_name,
    dealer_index,
    state
  )
  values (
    code,
    use_scope,
    session_player.id,
    session_player.display_name,
    dealer_out,
    jsonb_build_object(
      'phase', 'lobby',
      'dealer', dealer_out,
      'settings', coalesce(settings_input, '{}'::jsonb),
      'players', players_out,
      'totals', jsonb_build_array(0, 0),
      'rounds', jsonb_build_array()
    )
  )
  returning * into game_row;

  return public._klaverjas_online_public(game_row, session_token);
end;
$fn$;

create or replace function public.klaverjas_online_join(session_token text, lobby_code_input text, site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  session_player public.players%rowtype;
  game_row public.klaverjas_online_games%rowtype;
  players_json jsonb;
  next_seat integer := null;
  existing jsonb;
  seat_idx integer;
begin
  session_player := public._jas_session_player(session_token);
  select * into game_row from public.klaverjas_online_games where upper(lobby_code) = upper(trim(lobby_code_input)) for update;
  if not found then raise exception 'Klaverjas room niet gevonden'; end if;
  if game_row.status in ('finished', 'closed') then raise exception 'Deze klaverjastafel is al klaar'; end if;

  players_json := coalesce(game_row.state -> 'players', '[]'::jsonb);
  for existing in select * from jsonb_array_elements(players_json)
  loop
    if lower(existing ->> 'name') = lower(session_player.display_name) then
      return public._klaverjas_online_public(game_row, session_token);
    end if;
  end loop;

  if public._klaverjas_online_player_active_room(session_player.display_name, game_row.site_scope, game_row.id) is not null then
    raise exception 'Je zit al aan een andere actieve klaverjastafel. Open of sluit die tafel eerst.';
  end if;

  for seat_idx in 0..3 loop
    if not exists (select 1 from jsonb_array_elements(players_json) p where (p ->> 'seat')::integer = seat_idx) then
      next_seat := seat_idx;
      exit;
    end if;
  end loop;
  if next_seat is null then raise exception 'Deze klaverjastafel zit vol'; end if;

  players_json := players_json || jsonb_build_array(jsonb_build_object(
    'seat', next_seat,
    'name', session_player.display_name,
    'team', case when next_seat in (0,2) then 1 else 2 end,
    'is_bot', false,
    'player_type', 'human'
  ));

  update public.klaverjas_online_games
     set state = jsonb_set(game_row.state, '{players}', players_json, true),
         updated_at = now()
   where id = game_row.id
   returning * into game_row;

  return public._klaverjas_online_public(game_row, session_token);
end;
$fn$;

create or replace function public.klaverjas_online_delete_room(
  session_token text,
  game_id_input uuid default null,
  lobby_code_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  session_player public.players%rowtype;
  game_row public.klaverjas_online_games%rowtype;
begin
  session_player := public._jas_session_player(session_token);
  select * into game_row
    from public.klaverjas_online_games
   where (game_id_input is not null and id = game_id_input)
      or (coalesce(trim(lobby_code_input), '') <> '' and upper(lobby_code) = upper(trim(lobby_code_input)))
   order by updated_at desc
   limit 1
   for update;
  if not found then raise exception 'Klaverjas room niet gevonden'; end if;
  if not (
    game_row.created_by_player_id = session_player.id
    or lower(coalesce(game_row.created_by_player_name, '')) = lower(coalesce(session_player.display_name, ''))
  ) then
    raise exception 'Alleen de host kan deze klaverjastafel sluiten.';
  end if;

  update public.klaverjas_online_games
     set status = 'closed',
         state = jsonb_set(
           jsonb_set(coalesce(state, '{}'::jsonb), '{phase}', '"closed"', true),
           '{closed_by}',
           to_jsonb(session_player.display_name),
           true
         ),
         updated_at = now(),
         finished_at = coalesce(finished_at, now())
   where id = game_row.id
   returning * into game_row;

  return public._klaverjas_online_public(game_row, session_token);
end;
$fn$;

create or replace function public.klaverjas_online_list_open(session_token text default null, site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  use_scope text := case when lower(coalesce(site_scope_input, 'friends')) = 'family' then 'family' else 'friends' end;
  viewer public.players%rowtype;
  viewer_name text := null;
begin
  if coalesce(trim(session_token), '') <> '' then
    begin
      viewer := public._jas_session_player(session_token);
      viewer_name := viewer.display_name;
    exception when others then
      viewer_name := null;
    end;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id,
      'lobby_code', lobby_code,
      'status', status,
      'created_by_player_name', created_by_player_name,
      'is_host', viewer_name is not null and lower(coalesce(created_by_player_name, '')) = lower(viewer_name),
      'has_me', viewer_name is not null and exists (
        select 1 from jsonb_array_elements(coalesce(state -> 'players', '[]'::jsonb)) p
        where lower(p ->> 'name') = lower(viewer_name)
      ),
      'player_count', jsonb_array_length(coalesce(state -> 'players', '[]'::jsonb)),
      'human_count', (
        select count(*) from jsonb_array_elements(coalesce(state -> 'players', '[]'::jsonb)) p
        where not coalesce((p ->> 'is_bot')::boolean, false)
      ),
      'bot_count', (
        select count(*) from jsonb_array_elements(coalesce(state -> 'players', '[]'::jsonb)) p
        where coalesce((p ->> 'is_bot')::boolean, false)
      ),
      'action_deadline_at', coalesce(action_deadline_at, nullif(state ->> 'action_deadline_at', '')::timestamptz),
      'updated_at', updated_at
    ) order by
      case when viewer_name is not null and exists (
        select 1 from jsonb_array_elements(coalesce(state -> 'players', '[]'::jsonb)) p
        where lower(p ->> 'name') = lower(viewer_name)
      ) then 0 else 1 end,
      updated_at desc)
    from public.klaverjas_online_games
    where site_scope = use_scope and status not in ('finished', 'closed') and updated_at > now() - interval '90 days'
      and not (
        jsonb_array_length(coalesce(state -> 'players', '[]'::jsonb)) > 0
        and not exists (
          select 1 from jsonb_array_elements(coalesce(state -> 'players', '[]'::jsonb)) p
          where not coalesce((p ->> 'is_bot')::boolean, false)
        )
        and updated_at < now() - interval '1 hour'
      )
  ), '[]'::jsonb);
end;
$fn$;

grant execute on function public.klaverjas_online_create(text, text, jsonb) to anon, authenticated;
grant execute on function public.klaverjas_online_join(text, text, text) to anon, authenticated;
grant execute on function public.klaverjas_online_delete_room(text, uuid, text, text) to anon, authenticated;
grant execute on function public.klaverjas_online_list_open(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
