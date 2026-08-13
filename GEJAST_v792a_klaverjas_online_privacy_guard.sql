-- GEJAST v792a — Online Klaverjas private-state and destructive-RPC hardening
-- SQL-only repair. Frontend VERSION intentionally remains v792.
--
-- Proven owners addressed here:
-- 1. _klaverjas_online_public redacted only state.hands, while current clients also persist
--    recovery_snapshot.hands with the complete deal.
-- 2. bot hands were returned even to non-participants.
-- 3. klaverjas_online_save_state allowed a participant to retype an existing human as a bot,
--    which could turn that player's stored hand into a subsequently visible "bot" hand.
-- 4. klaverjas_online_cleanup_rooms(text,boolean) was SECURITY DEFINER, unauthenticated,
--    executable by web roles, and close_all=true could close every active room in a scope.
-- 5. raw SELECT on klaverjas_online_games would bypass every RPC redaction rule.

begin;

create or replace function public._klaverjas_online_public(
  game_row public.klaverjas_online_games,
  session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  session_player public.players%rowtype;
  players_json jsonb;
  viewer_json jsonb := null;
  viewer_seat integer := null;
  redacted_state jsonb;
  redacted_hands jsonb := null;
  recovery_json jsonb;
  recovery_hands jsonb;
  redacted_recovery_hands jsonb := null;
  hand_item jsonb;
  hand_player jsonb;
  hand_idx integer;
  p jsonb;
begin
  players_json := coalesce(game_row.state -> 'players', '[]'::jsonb);

  if coalesce(trim(session_token), '') <> '' then
    begin
      session_player := public._jas_session_player(session_token);
      for p in select * from jsonb_array_elements(players_json)
      loop
        if lower(coalesce(p ->> 'name','')) = lower(coalesce(session_player.display_name,'')) then
          viewer_seat := nullif(p ->> 'seat','')::integer;
          viewer_json := jsonb_build_object(
            'name', session_player.display_name,
            'seat', viewer_seat,
            'team', nullif(p ->> 'team','')::integer
          );
          exit;
        end if;
      end loop;
    exception when others then
      viewer_json := null;
      viewer_seat := null;
    end;
  end if;

  redacted_state := coalesce(game_row.state, '{}'::jsonb);

  -- Never reveal another human hand. Bot hands are needed by the current client-driven bot
  -- engine, but only an actual seated participant may receive them.
  if jsonb_typeof(redacted_state -> 'hands') = 'array' then
    redacted_hands := '[]'::jsonb;
    hand_idx := 0;
    for hand_item in select * from jsonb_array_elements(redacted_state -> 'hands')
    loop
      hand_player := null;
      select item into hand_player
        from jsonb_array_elements(players_json) as roster(item)
       where nullif(item ->> 'seat','')::integer = hand_idx
       limit 1;

      redacted_hands := redacted_hands || jsonb_build_array(
        case
          when viewer_seat is not null
           and (
             hand_idx = viewer_seat
             or coalesce((hand_player ->> 'is_bot')::boolean, false)
           )
          then hand_item
          else '[]'::jsonb
        end
      );
      hand_idx := hand_idx + 1;
    end loop;
    redacted_state := jsonb_set(redacted_state, '{hands}', redacted_hands, true);
  end if;

  -- The v751+ client stores a second copy of all hands in recovery_snapshot.hands on every
  -- save. Redact that copy independently; top-level redaction alone is not a privacy boundary.
  recovery_json := redacted_state -> 'recovery_snapshot';
  if jsonb_typeof(recovery_json) = 'object'
     and jsonb_typeof(recovery_json -> 'hands') = 'array' then
    recovery_hands := recovery_json -> 'hands';
    redacted_recovery_hands := '[]'::jsonb;
    hand_idx := 0;
    for hand_item in select * from jsonb_array_elements(recovery_hands)
    loop
      hand_player := null;
      select item into hand_player
        from jsonb_array_elements(players_json) as roster(item)
       where nullif(item ->> 'seat','')::integer = hand_idx
       limit 1;

      redacted_recovery_hands := redacted_recovery_hands || jsonb_build_array(
        case
          when viewer_seat is not null
           and (
             hand_idx = viewer_seat
             or coalesce((hand_player ->> 'is_bot')::boolean, false)
           )
          then hand_item
          else '[]'::jsonb
        end
      );
      hand_idx := hand_idx + 1;
    end loop;
    recovery_json := jsonb_set(recovery_json, '{hands}', redacted_recovery_hands, true);
    redacted_state := jsonb_set(redacted_state, '{recovery_snapshot}', recovery_json, true);
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
$function$;

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
as $function$
declare
  session_player public.players%rowtype;
  game_row public.klaverjas_online_games%rowtype;
  participant jsonb;
  stored_player jsonb;
  input_player jsonb;
  matching_player jsonb;
  stored_players jsonb;
  input_players jsonb;
  stored_phase text;
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
  select * into game_row
    from public.klaverjas_online_games
   where id = game_id_input
   for update;
  if not found then raise exception 'Klaverjas room niet gevonden'; end if;
  if game_row.status = 'closed' then raise exception 'Deze klaverjastafel is gesloten'; end if;

  stored_players := coalesce(game_row.state -> 'players', '[]'::jsonb);
  input_players := coalesce(state_input -> 'players', stored_players);
  stored_phase := coalesce(nullif(game_row.state ->> 'phase',''), game_row.status, 'lobby');

  if jsonb_typeof(stored_players) <> 'array' or jsonb_typeof(input_players) <> 'array' then
    raise exception 'klaverjas_online_roster_invalid';
  end if;
  if jsonb_array_length(input_players) > 4 then
    raise exception 'klaverjas_online_roster_too_large';
  end if;

  -- Authenticate against the already-stored roster, never against caller-supplied state.
  for participant in select * from jsonb_array_elements(stored_players)
  loop
    if coalesce((participant ->> 'is_bot')::boolean, false) then
      has_bots := true;
    end if;
    if lower(coalesce(participant ->> 'name','')) = lower(coalesce(session_player.display_name,'')) then
      is_participant := true;
      viewer_seat := nullif(participant ->> 'seat','')::integer;
    end if;
  end loop;
  if not is_participant then raise exception 'Je zit niet aan deze klaverjastafel'; end if;

  -- Existing seats are immutable through the generic state-save RPC. This closes the privacy
  -- escalation where a human seat could be rewritten as is_bot=true and then receive bot-hand
  -- visibility from the public-state projection.
  for stored_player in select * from jsonb_array_elements(stored_players)
  loop
    matching_player := null;
    select item into matching_player
      from jsonb_array_elements(input_players) as incoming(item)
     where nullif(item ->> 'seat','')::integer = nullif(stored_player ->> 'seat','')::integer
     limit 1;

    if matching_player is null
       or lower(coalesce(matching_player ->> 'name','')) <> lower(coalesce(stored_player ->> 'name',''))
       or coalesce((matching_player ->> 'team')::integer, 0) <> coalesce((stored_player ->> 'team')::integer, 0)
       or coalesce((matching_player ->> 'is_bot')::boolean, false) <> coalesce((stored_player ->> 'is_bot')::boolean, false)
       or coalesce(matching_player ->> 'player_type', case when coalesce((matching_player ->> 'is_bot')::boolean,false) then 'bot' else 'human' end)
          <> coalesce(stored_player ->> 'player_type', case when coalesce((stored_player ->> 'is_bot')::boolean,false) then 'bot' else 'human' end)
    then
      raise exception 'klaverjas_online_roster_mutation_rejected';
    end if;
  end loop;

  -- Human seats must be created by klaverjas_online_join, which authenticates the joining
  -- player. The state-save RPC may only append bots while the table is still in the lobby.
  for input_player in select * from jsonb_array_elements(input_players)
  loop
    matching_player := null;
    select item into matching_player
      from jsonb_array_elements(stored_players) as stored(item)
     where nullif(item ->> 'seat','')::integer = nullif(input_player ->> 'seat','')::integer
     limit 1;

    if matching_player is null then
      if stored_phase <> 'lobby'
         or not coalesce((input_player ->> 'is_bot')::boolean, false)
         or nullif(input_player ->> 'seat','')::integer not between 0 and 3
         or coalesce((input_player ->> 'team')::integer, 0) <> case when nullif(input_player ->> 'seat','')::integer in (0,2) then 1 else 2 end
      then
        raise exception 'klaverjas_online_roster_addition_rejected';
      end if;
      has_bots := true;
    end if;
  end loop;

  -- A duplicated seat is never a valid roster.
  if exists (
    select 1
      from (
        select nullif(item ->> 'seat','')::integer as seat_no, count(*) as n
          from jsonb_array_elements(input_players) as roster(item)
         group by nullif(item ->> 'seat','')::integer
      ) d
     where d.seat_no is null or d.seat_no not between 0 and 3 or d.n <> 1
  ) then
    raise exception 'klaverjas_online_roster_seat_invalid';
  end if;

  next_state := coalesce(state_input, '{}'::jsonb);
  next_state := jsonb_set(next_state, '{players}', input_players, true);
  stored_hands := game_row.state -> 'hands';
  input_hands := next_state -> 'hands';

  if jsonb_typeof(stored_hands) = 'array'
     and jsonb_typeof(input_hands) = 'array'
     and viewer_seat is not null
     and coalesce(next_state ->> 'deal_nonce', '') = coalesce(game_row.state ->> 'deal_nonce', '') then
    merged_hands := '[]'::jsonb;
    for idx in 0..3 loop
      merge_player := null;
      select item into merge_player
        from jsonb_array_elements(input_players) as roster(item)
       where nullif(item ->> 'seat','')::integer = idx
       limit 1;
      merged_hands := merged_hands || jsonb_build_array(
        case
          when idx = viewer_seat or coalesce((merge_player ->> 'is_bot')::boolean, false)
          then coalesce(input_hands -> idx, '[]'::jsonb)
          else coalesce(stored_hands -> idx, '[]'::jsonb)
        end
      );
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
    for stat_participant in select * from jsonb_array_elements(input_players)
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
$function$;

-- The table stores the authoritative unredacted deal. Web clients must only see it through
-- the redacting SECURITY DEFINER RPCs; direct SELECT would bypass that boundary.
alter table public.klaverjas_online_games enable row level security;
revoke select on table public.klaverjas_online_games from public, anon, authenticated;

-- Generic write RPC is session-guarded; do not leave implicit PUBLIC execution behind.
revoke execute on function public.klaverjas_online_save_state(text,uuid,jsonb,jsonb,jsonb) from public;
grant execute on function public.klaverjas_online_save_state(text,uuid,jsonb,jsonb,jsonb) to anon, authenticated;

-- Internal helpers contain raw state / roster lookup and never need direct browser execution.
revoke execute on function public._klaverjas_online_public(public.klaverjas_online_games,text) from public, anon, authenticated;
revoke execute on function public._klaverjas_online_player_active_room(text,text,uuid) from public, anon, authenticated;

-- The old live-test cleanup endpoint is destructive and unauthenticated. Keep it available only
-- to the Supabase service role for controlled maintenance; ordinary room closure stays host-only
-- through klaverjas_online_delete_room(session_token,...).
revoke execute on function public.klaverjas_online_cleanup_rooms(text,boolean) from public, anon, authenticated;
grant execute on function public.klaverjas_online_cleanup_rooms(text,boolean) to service_role;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
