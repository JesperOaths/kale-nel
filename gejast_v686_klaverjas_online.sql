-- v686 - Kalenel Klaverjas online mode
-- Apply in Supabase SQL editor before using klaverjas_online.html.

create extension if not exists pgcrypto;

create table if not exists public.klaverjas_online_games (
  id uuid primary key default gen_random_uuid(),
  lobby_code text not null unique,
  site_scope text not null default 'friends',
  status text not null default 'lobby',
  dealer_index integer not null default 0,
  created_by_player_id bigint null references public.players(id) on delete set null,
  created_by_player_name text null,
  state jsonb not null default '{}'::jsonb,
  saved_jas_game_id bigint null references public.jas_games(id) on delete set null,
  action_deadline_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz null
);

create index if not exists klaverjas_online_games_scope_status_idx on public.klaverjas_online_games(site_scope, status, updated_at desc);
create index if not exists klaverjas_online_games_lobby_idx on public.klaverjas_online_games(upper(lobby_code));

alter table public.klaverjas_online_games add column if not exists action_deadline_at timestamptz null;

create table if not exists public.klaverjas_online_player_stats (
  player_name text primary key,
  games_played integer not null default 0,
  games_won integer not null default 0,
  kruipen integer not null default 0,
  naakt_kruipen integer not null default 0,
  caused_kruipen integer not null default 0,
  caused_naakt_kruipen integer not null default 0,
  last_game_at timestamptz null,
  updated_at timestamptz not null default now()
);

create or replace function public._klaverjas_online_code()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out_code text := '';
  i integer;
begin
  for i in 1..5 loop
    out_code := out_code || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
  end loop;
  return out_code;
end;
$$;

create or replace function public._klaverjas_online_public(game_row public.klaverjas_online_games, session_token text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  session_player public.players%rowtype;
  players_json jsonb;
  viewer_json jsonb := null;
  viewer_seat integer := null;
  redacted_state jsonb;
  redacted_hands jsonb := null;
  hand_item jsonb;
  hand_idx integer := 0;
  hand_player jsonb;
  p jsonb;
begin
  players_json := coalesce(game_row.state -> 'players', '[]'::jsonb);
  if coalesce(trim(session_token), '') <> '' then
    begin
      session_player := public._jas_session_player(session_token);
      for p in select * from jsonb_array_elements(players_json)
      loop
        if lower(p ->> 'name') = lower(session_player.display_name) then
          viewer_seat := (p ->> 'seat')::integer;
          viewer_json := jsonb_build_object('name', session_player.display_name, 'seat', (p ->> 'seat')::integer, 'team', (p ->> 'team')::integer);
        end if;
      end loop;
    exception when others then
      viewer_json := null;
    end;
  end if;
  redacted_state := coalesce(game_row.state, '{}'::jsonb);
  if jsonb_typeof(redacted_state -> 'hands') = 'array' then
    redacted_hands := '[]'::jsonb;
    hand_idx := 0;
    for hand_item in select * from jsonb_array_elements(redacted_state -> 'hands')
    loop
      hand_player := players_json -> hand_idx;
      redacted_hands := redacted_hands || jsonb_build_array(case when (viewer_seat is not null and hand_idx = viewer_seat) or coalesce((hand_player ->> 'is_bot')::boolean, false) then hand_item else '[]'::jsonb end);
      hand_idx := hand_idx + 1;
    end loop;
    redacted_state := jsonb_set(redacted_state, '{hands}', redacted_hands, true);
  end if;

  return jsonb_build_object(
    'game', jsonb_build_object(
      'id', game_row.id,
      'lobby_code', game_row.lobby_code,
      'site_scope', game_row.site_scope,
      'status', game_row.status,
      'dealer_index', game_row.dealer_index,
      'created_by_player_name', game_row.created_by_player_name,
      'state', redacted_state,
      'saved_jas_game_id', game_row.saved_jas_game_id,
      'action_deadline_at', game_row.action_deadline_at,
      'created_at', game_row.created_at,
      'updated_at', game_row.updated_at,
      'finished_at', game_row.finished_at
    ),
    'players', players_json,
    'viewer', viewer_json
  );
end;
$$;

create or replace function public.klaverjas_online_create(session_token text, site_scope_input text default 'friends', settings_input jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  session_player public.players%rowtype;
  code text;
  dealer_out integer;
  game_row public.klaverjas_online_games%rowtype;
  use_scope text := case when lower(coalesce(site_scope_input, 'friends')) = 'family' then 'family' else 'friends' end;
  bot_count integer := greatest(0, least(3, coalesce((settings_input ->> 'bot_count')::integer, 0)));
  players_out jsonb;
begin
  session_player := public._jas_session_player(session_token);
  dealer_out := floor(random() * 4)::integer;
  loop
    code := public._klaverjas_online_code();
    exit when not exists (select 1 from public.klaverjas_online_games where upper(lobby_code) = upper(code));
  end loop;
  players_out := jsonb_build_array(jsonb_build_object('seat', 0, 'name', session_player.display_name, 'team', 1, 'is_bot', false, 'player_type', 'human'));
  if bot_count >= 1 then
    players_out := players_out || jsonb_build_array(jsonb_build_object('seat', 1, 'name', 'Schoppen Bot', 'team', 2, 'is_bot', true, 'player_type', 'bot'));
  end if;
  if bot_count >= 2 then
    players_out := players_out || jsonb_build_array(jsonb_build_object('seat', 2, 'name', 'Harten Bot', 'team', 1, 'is_bot', true, 'player_type', 'bot'));
  end if;
  if bot_count >= 3 then
    players_out := players_out || jsonb_build_array(jsonb_build_object('seat', 3, 'name', 'Ruiten Bot', 'team', 2, 'is_bot', true, 'player_type', 'bot'));
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
$$;

create or replace function public.klaverjas_online_join(session_token text, lobby_code_input text, site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  session_player public.players%rowtype;
  game_row public.klaverjas_online_games%rowtype;
  players_json jsonb;
  player_count integer;
  next_seat integer;
  existing jsonb;
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

  player_count := jsonb_array_length(players_json);
  if player_count >= 4 then raise exception 'Deze klaverjastafel zit vol'; end if;
  next_seat := player_count;
  players_json := players_json || jsonb_build_array(jsonb_build_object('seat', next_seat, 'name', session_player.display_name, 'team', case when next_seat in (0,2) then 1 else 2 end));

  update public.klaverjas_online_games
     set state = jsonb_set(game_row.state, '{players}', players_json, true),
         updated_at = now()
   where id = game_row.id
   returning * into game_row;

  return public._klaverjas_online_public(game_row, session_token);
end;
$$;

create or replace function public.klaverjas_online_get_state(
  session_token text default null,
  game_id_input uuid default null,
  lobby_code_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  game_row public.klaverjas_online_games%rowtype;
begin
  select * into game_row
    from public.klaverjas_online_games
   where (game_id_input is not null and id = game_id_input)
      or (coalesce(trim(lobby_code_input), '') <> '' and upper(lobby_code) = upper(trim(lobby_code_input)))
   order by updated_at desc
   limit 1;
  if not found then raise exception 'Klaverjas room niet gevonden'; end if;
  return public._klaverjas_online_public(game_row, session_token);
end;
$$;

create or replace function public.klaverjas_online_save_state(
  session_token text,
  game_id_input uuid,
  state_input jsonb,
  summary_payload jsonb default null,
  final_jas_payload jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  session_player public.players%rowtype;
  game_row public.klaverjas_online_games%rowtype;
  participant jsonb;
  is_participant boolean := false;
  viewer_seat integer := null;
  next_status text;
  next_state jsonb;
  stored_hands jsonb;
  input_hands jsonb;
  merged_hands jsonb := null;
  idx integer;
  merge_player jsonb;
  saved_result jsonb;
  stat_participant jsonb;
  stat_winner_team integer;
  stat_kruip text;
  has_bots boolean := false;
begin
  session_player := public._jas_session_player(session_token);
  select * into game_row from public.klaverjas_online_games where id = game_id_input for update;
  if not found then raise exception 'Klaverjas room niet gevonden'; end if;
  if game_row.status = 'closed' then raise exception 'Deze klaverjastafel is gesloten'; end if;

  for participant in select * from jsonb_array_elements(coalesce(game_row.state -> 'players', state_input -> 'players', '[]'::jsonb))
  loop
    if coalesce((participant ->> 'is_bot')::boolean, false) then
      has_bots := true;
    end if;
    if lower(participant ->> 'name') = lower(session_player.display_name) then
      is_participant := true;
      viewer_seat := (participant ->> 'seat')::integer;
    end if;
  end loop;
  if not is_participant then raise exception 'Je zit niet aan deze klaverjastafel'; end if;

  next_state := coalesce(state_input, '{}'::jsonb);
  stored_hands := game_row.state -> 'hands';
  input_hands := next_state -> 'hands';
  if jsonb_typeof(stored_hands) = 'array'
     and jsonb_typeof(input_hands) = 'array'
     and viewer_seat is not null
     and coalesce(next_state ->> 'deal_nonce', '') = coalesce(game_row.state ->> 'deal_nonce', '') then
    merged_hands := '[]'::jsonb;
    for idx in 0..3 loop
      merge_player := coalesce(game_row.state -> 'players' -> idx, state_input -> 'players' -> idx);
      merged_hands := merged_hands || jsonb_build_array(case when idx = viewer_seat or coalesce((merge_player ->> 'is_bot')::boolean, false) then coalesce(input_hands -> idx, '[]'::jsonb) else coalesce(stored_hands -> idx, '[]'::jsonb) end);
    end loop;
    next_state := jsonb_set(next_state, '{hands}', merged_hands, true);
  end if;

  next_status := coalesce(nullif(next_state ->> 'phase', ''), game_row.status, 'lobby');

  if next_status = 'finished' and not has_bots and game_row.saved_jas_game_id is null and final_jas_payload is not null then
    saved_result := public.create_jas_game(session_token, final_jas_payload);
    stat_winner_team := nullif(next_state #>> '{summary,winner_team}', '')::integer;
    if stat_winner_team is null then
      if coalesce((next_state #>> '{totals,0}')::integer, 0) > coalesce((next_state #>> '{totals,1}')::integer, 0) then stat_winner_team := 1;
      elsif coalesce((next_state #>> '{totals,1}')::integer, 0) > coalesce((next_state #>> '{totals,0}')::integer, 0) then stat_winner_team := 2;
      end if;
    end if;
    stat_kruip := nullif(next_state ->> 'kruip', '');
    for stat_participant in select * from jsonb_array_elements(coalesce(next_state -> 'players', '[]'::jsonb))
    loop
      insert into public.klaverjas_online_player_stats(player_name, games_played, games_won, kruipen, naakt_kruipen, caused_kruipen, caused_naakt_kruipen, last_game_at)
      values (
        stat_participant ->> 'name',
        1,
        case when stat_winner_team = (stat_participant ->> 'team')::integer then 1 else 0 end,
        case when stat_kruip = 'kruipen' and stat_winner_team <> (stat_participant ->> 'team')::integer then 1 else 0 end,
        case when stat_kruip = 'naakt_kruipen' and stat_winner_team <> (stat_participant ->> 'team')::integer then 1 else 0 end,
        case when stat_kruip = 'kruipen' and stat_winner_team = (stat_participant ->> 'team')::integer then 1 else 0 end,
        case when stat_kruip = 'naakt_kruipen' and stat_winner_team = (stat_participant ->> 'team')::integer then 1 else 0 end,
        now()
      )
      on conflict (player_name) do update set
        games_played = public.klaverjas_online_player_stats.games_played + excluded.games_played,
        games_won = public.klaverjas_online_player_stats.games_won + excluded.games_won,
        kruipen = public.klaverjas_online_player_stats.kruipen + excluded.kruipen,
        naakt_kruipen = public.klaverjas_online_player_stats.naakt_kruipen + excluded.naakt_kruipen,
        caused_kruipen = public.klaverjas_online_player_stats.caused_kruipen + excluded.caused_kruipen,
        caused_naakt_kruipen = public.klaverjas_online_player_stats.caused_naakt_kruipen + excluded.caused_naakt_kruipen,
        last_game_at = now(),
        updated_at = now();
    end loop;
  end if;

  update public.klaverjas_online_games
     set state = next_state,
         status = next_status,
         updated_at = now(),
         action_deadline_at = nullif(next_state ->> 'action_deadline_at', '')::timestamptz,
         finished_at = case when next_status = 'finished' then coalesce(finished_at, now()) else finished_at end,
         saved_jas_game_id = coalesce(saved_jas_game_id, nullif(saved_result ->> 'game_id', '')::bigint)
   where id = game_row.id
   returning * into game_row;

  if summary_payload is not null and not has_bots then
    begin
      perform public.save_game_match_summary_scoped(session_token, 'klaverjas', game_row.id::text, summary_payload, game_row.site_scope);
    exception when undefined_function then
      begin
        perform public.save_game_match_summary(session_token, 'klaverjas', game_row.id::text, summary_payload);
      exception when others then
        null;
      end;
    when others then
      null;
    end;
  end if;

  return public._klaverjas_online_public(game_row, session_token);
end;
$$;

create or replace function public.klaverjas_online_list_open(session_token text default null, site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  use_scope text := case when lower(coalesce(site_scope_input, 'friends')) = 'family' then 'family' else 'friends' end;
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id,
      'lobby_code', lobby_code,
      'status', status,
      'player_count', jsonb_array_length(coalesce(state -> 'players', '[]'::jsonb)),
      'action_deadline_at', coalesce(action_deadline_at, nullif(state ->> 'action_deadline_at', '')::timestamptz),
      'updated_at', updated_at
    ) order by updated_at desc)
    from public.klaverjas_online_games
    where site_scope = use_scope and status not in ('finished', 'closed') and updated_at > now() - interval '90 days'
  ), '[]'::jsonb);
end;
$$;

create or replace view public.klaverjas_online_kruip_stats as
select * from public.klaverjas_online_player_stats;

create or replace function public.get_klaverjas_online_stats_public(site_scope_input text default 'friends')
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'player_name', player_name,
    'games_played', games_played,
    'games_won', games_won,
    'kruipen', kruipen,
    'naakt_kruipen', naakt_kruipen,
    'caused_kruipen', caused_kruipen,
    'caused_naakt_kruipen', caused_naakt_kruipen,
    'last_game_at', last_game_at
  ) order by (kruipen + naakt_kruipen + caused_kruipen + caused_naakt_kruipen) desc, games_played desc, player_name), '[]'::jsonb)
  from public.klaverjas_online_player_stats;
$$;

comment on function public.klaverjas_online_create(text,text,jsonb) is 'Creates a 4-player online Amsterdam klaverjas room.';
comment on function public.klaverjas_online_join(text,text,text) is 'Joins a registered player to a klaverjas online room.';
comment on function public.klaverjas_online_save_state(text,uuid,jsonb,jsonb,jsonb) is 'Persists online klaverjas state and stores finished games in jas_games/jas_game_entries via create_jas_game.';
