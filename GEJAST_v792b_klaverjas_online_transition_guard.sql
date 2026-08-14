-- GEJAST v792b — Online Klaverjas state-transition integrity guard
-- SQL-only repair. Frontend VERSION intentionally remains v792.
--
-- Purpose:
--   v792a established the privacy boundary around hidden human hands, but the generic
--   klaverjas_online_save_state RPC still accepted most caller-supplied state fields.
--   This repair keeps the existing client-driven bot architecture while making all-human
--   tables enforce actor ownership and structural state transitions server-side.
--
-- Design constraints:
--   * Bot rooms remain test-only and client-driven; their broad bot automation is preserved.
--   * Human-only rooms get strict action ownership and card-movement invariants.
--   * A deal_nonce can change only for a legitimate start/redeal/next-round boundary.
--   * Existing roster immutability and v792a hidden-hand merging remain intact.

begin;

create or replace function public._klaverjas_online_full_deal_valid(state_input jsonb)
returns boolean
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  hands jsonb := state_input -> 'hands';
  all_cards jsonb := '[]'::jsonb;
  hand_item jsonb;
  card_item jsonb;
  card_id text;
  seen_ids text[] := array[]::text[];
begin
  if jsonb_typeof(hands) <> 'array' or jsonb_array_length(hands) <> 4 then
    return false;
  end if;

  for hand_item in select * from jsonb_array_elements(hands)
  loop
    if jsonb_typeof(hand_item) <> 'array' or jsonb_array_length(hand_item) <> 8 then
      return false;
    end if;
    for card_item in select * from jsonb_array_elements(hand_item)
    loop
      card_id := nullif(card_item ->> 'id', '');
      if card_id is null or card_id = any(seen_ids) then
        return false;
      end if;
      if nullif(card_item ->> 'suit','') not in ('clubs','spades','hearts','diamonds')
         or nullif(card_item ->> 'rank','') not in ('A','10','K','Q','J','9','8','7') then
        return false;
      end if;
      if card_id <> (card_item ->> 'suit') || '-' || (card_item ->> 'rank') then
        return false;
      end if;
      seen_ids := array_append(seen_ids, card_id);
      all_cards := all_cards || jsonb_build_array(card_item);
    end loop;
  end loop;

  return array_length(seen_ids, 1) = 32;
end;
$function$;

create or replace function public._klaverjas_online_human_transition_valid(
  stored_state jsonb,
  next_state jsonb,
  viewer_seat integer
)
returns boolean
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  stored_phase text := coalesce(nullif(stored_state ->> 'phase',''), 'lobby');
  next_phase text := coalesce(nullif(next_state ->> 'phase',''), stored_phase);
  stored_nonce text := coalesce(stored_state ->> 'deal_nonce','');
  next_nonce text := coalesce(next_state ->> 'deal_nonce','');
  stored_turn integer;
  stored_bidder integer;
  stored_pending jsonb := stored_state -> 'pending_trick';
  next_pending jsonb := next_state -> 'pending_trick';
  stored_trick jsonb := coalesce(stored_state -> 'trick', '[]'::jsonb);
  next_trick jsonb := coalesce(next_state -> 'trick', '[]'::jsonb);
  stored_hands jsonb := stored_state -> 'hands';
  next_hands jsonb := next_state -> 'hands';
  stored_hand jsonb;
  next_hand jsonb;
  removed_card jsonb;
  last_play jsonb;
  idx integer;
  stored_taken_len integer := case when jsonb_typeof(stored_state -> 'taken')='array' then jsonb_array_length(stored_state -> 'taken') else 0 end;
  next_taken_len integer := case when jsonb_typeof(next_state -> 'taken')='array' then jsonb_array_length(next_state -> 'taken') else 0 end;
begin
  if viewer_seat is null or viewer_seat not between 0 and 3 then return false; end if;
  if next_phase not in ('lobby','bidding','playing','roundOver','finished') then return false; end if;

  -- Once play has started, immutable match identity/settings cannot be rewritten through state-save.
  if stored_phase <> 'lobby' then
    if coalesce(next_state -> 'settings','{}'::jsonb) <> coalesce(stored_state -> 'settings','{}'::jsonb) then return false; end if;
    if coalesce(next_state ->> 'dealer','') <> coalesce(stored_state ->> 'dealer','')
       and stored_phase not in ('roundOver') then return false; end if;
  end if;

  -- Deal replacement is a privileged structural boundary, never an arbitrary escape hatch.
  if next_nonce <> stored_nonce then
    if next_nonce = '' or not public._klaverjas_online_full_deal_valid(next_state) then return false; end if;

    -- Initial start: creator/seat 0 starts a full four-seat lobby.
    if stored_phase = 'lobby' then
      return viewer_seat = 0
         and next_phase = 'bidding'
         and jsonb_array_length(coalesce(next_state -> 'players','[]'::jsonb)) = 4
         and coalesce(next_state -> 'totals','[0,0]'::jsonb) = coalesce(stored_state -> 'totals','[0,0]'::jsonb)
         and coalesce(next_state -> 'rounds','[]'::jsonb) = coalesce(stored_state -> 'rounds','[]'::jsonb);
    end if;

    -- Four passes with no bid: only the actual bidder-turn actor may redeal, same dealer/history.
    if stored_phase = 'bidding'
       and coalesce(stored_state -> 'current_bid','null'::jsonb) = 'null'::jsonb
       and coalesce((stored_state ->> 'passes_since_bid')::integer,0) >= 3 then
      stored_bidder := nullif(stored_state ->> 'bidder_turn','')::integer;
      return viewer_seat = stored_bidder
         and next_phase = 'bidding'
         and coalesce(next_state ->> 'dealer','') = coalesce(stored_state ->> 'dealer','')
         and coalesce(next_state -> 'totals','[0,0]'::jsonb) = coalesce(stored_state -> 'totals','[0,0]'::jsonb)
         and coalesce(next_state -> 'rounds','[]'::jsonb) = coalesce(stored_state -> 'rounds','[]'::jsonb);
    end if;

    -- Normal next round: any seated participant may trigger the UI's shared next-round action,
    -- but totals/round history must carry forward unchanged into a fresh bidding deal.
    if stored_phase = 'roundOver' then
      return next_phase = 'bidding'
         and coalesce(next_state -> 'totals','[0,0]'::jsonb) = coalesce(stored_state -> 'totals','[0,0]'::jsonb)
         and coalesce(next_state -> 'rounds','[]'::jsonb) = coalesce(stored_state -> 'rounds','[]'::jsonb);
    end if;

    return false;
  end if;

  -- No active deal yet: remaining in lobby may only preserve score/history state.
  if stored_phase = 'lobby' then
    return next_phase = 'lobby'
       and coalesce(next_state -> 'totals','[0,0]'::jsonb) = coalesce(stored_state -> 'totals','[0,0]'::jsonb)
       and coalesce(next_state -> 'rounds','[]'::jsonb) = coalesce(stored_state -> 'rounds','[]'::jsonb);
  end if;

  -- Bidding is owned by bidder_turn and cannot mutate dealt cards or accumulated score/history.
  if stored_phase = 'bidding' then
    stored_bidder := nullif(stored_state ->> 'bidder_turn','')::integer;
    if viewer_seat <> stored_bidder then return false; end if;
    if next_phase not in ('bidding','playing') then return false; end if;
    if coalesce(next_hands,'[]'::jsonb) <> coalesce(stored_hands,'[]'::jsonb) then return false; end if;
    if coalesce(next_state -> 'taken','[]'::jsonb) <> coalesce(stored_state -> 'taken','[]'::jsonb) then return false; end if;
    if coalesce(next_state -> 'trick','[]'::jsonb) <> coalesce(stored_state -> 'trick','[]'::jsonb) then return false; end if;
    if coalesce(next_state -> 'totals','[0,0]'::jsonb) <> coalesce(stored_state -> 'totals','[0,0]'::jsonb) then return false; end if;
    if coalesce(next_state -> 'rounds','[]'::jsonb) <> coalesce(stored_state -> 'rounds','[]'::jsonb) then return false; end if;
    return true;
  end if;

  if stored_phase = 'playing' then
    -- Card play: only turn owner, exactly one card leaves that actor's hand, other hands stay put.
    if stored_pending is null or stored_pending = 'null'::jsonb then
      stored_turn := nullif(stored_state ->> 'turn','')::integer;
      if viewer_seat <> stored_turn or next_phase <> 'playing' then return false; end if;
      if jsonb_typeof(stored_hands) <> 'array' or jsonb_typeof(next_hands) <> 'array'
         or jsonb_array_length(stored_hands) <> 4 or jsonb_array_length(next_hands) <> 4 then return false; end if;

      for idx in 0..3 loop
        stored_hand := coalesce(stored_hands -> idx, '[]'::jsonb);
        next_hand := coalesce(next_hands -> idx, '[]'::jsonb);
        if idx <> viewer_seat and next_hand <> stored_hand then return false; end if;
      end loop;

      stored_hand := coalesce(stored_hands -> viewer_seat, '[]'::jsonb);
      next_hand := coalesce(next_hands -> viewer_seat, '[]'::jsonb);
      if jsonb_array_length(next_hand) <> jsonb_array_length(stored_hand) - 1 then return false; end if;
      if not (stored_hand @> next_hand) then return false; end if;

      select card into removed_card
        from jsonb_array_elements(stored_hand) as cards(card)
       where not exists (
         select 1 from jsonb_array_elements(next_hand) incoming
          where incoming ->> 'id' = card ->> 'id'
       )
       limit 1;
      if removed_card is null then return false; end if;

      -- First three cards append to trick. Fourth card atomically becomes pending_trick.
      if jsonb_array_length(stored_trick) < 3 then
        if jsonb_array_length(next_trick) <> jsonb_array_length(stored_trick) + 1 then return false; end if;
        if (next_trick - (jsonb_array_length(next_trick)-1)) <> stored_trick then return false; end if;
        last_play := next_trick -> (jsonb_array_length(next_trick)-1);
        if nullif(last_play ->> 'player','')::integer <> viewer_seat or last_play -> 'card' <> removed_card then return false; end if;
        if next_pending is not null and next_pending <> 'null'::jsonb then return false; end if;
      elsif jsonb_array_length(stored_trick) = 3 then
        if jsonb_array_length(next_trick) <> 0 then return false; end if;
        if jsonb_typeof(next_pending) <> 'object' or jsonb_typeof(next_pending -> 'cards') <> 'array'
           or jsonb_array_length(next_pending -> 'cards') <> 4 then return false; end if;
        if ((next_pending -> 'cards') - 3) <> stored_trick then return false; end if;
        last_play := next_pending -> 'cards' -> 3;
        if nullif(last_play ->> 'player','')::integer <> viewer_seat or last_play -> 'card' <> removed_card then return false; end if;
      else
        return false;
      end if;

      if next_taken_len <> stored_taken_len then return false; end if;
      if coalesce(next_state -> 'totals','[0,0]'::jsonb) <> coalesce(stored_state -> 'totals','[0,0]'::jsonb) then return false; end if;
      if coalesce(next_state -> 'rounds','[]'::jsonb) <> coalesce(stored_state -> 'rounds','[]'::jsonb) then return false; end if;
      return true;
    end if;

    -- Pending trick: only winner's team may klop/collect. A collect may close the round after
    -- the eighth trick; before that it must append exactly the stored pending trick to taken.
    if nullif(stored_pending ->> 'winner','') is null then return false; end if;
    if (viewer_seat % 2) <> ((stored_pending ->> 'winner')::integer % 2) then return false; end if;

    if next_pending is not null and next_pending <> 'null'::jsonb then
      -- Klop-only transition: cards/taken/score/history unchanged, only pending metadata/roem may advance.
      if next_phase <> 'playing' then return false; end if;
      if coalesce(next_hands,'[]'::jsonb) <> coalesce(stored_hands,'[]'::jsonb) then return false; end if;
      if next_taken_len <> stored_taken_len then return false; end if;
      if next_pending -> 'cards' <> stored_pending -> 'cards' then return false; end if;
      if coalesce(next_state -> 'totals','[0,0]'::jsonb) <> coalesce(stored_state -> 'totals','[0,0]'::jsonb) then return false; end if;
      if coalesce(next_state -> 'rounds','[]'::jsonb) <> coalesce(stored_state -> 'rounds','[]'::jsonb) then return false; end if;
      return true;
    end if;

    if next_taken_len <> stored_taken_len + 1 then return false; end if;
    if (next_state -> 'taken' -> stored_taken_len) -> 'cards' <> stored_pending -> 'cards' then return false; end if;
    if next_phase = 'playing' then
      if stored_taken_len >= 7 then return false; end if;
      if coalesce(next_state -> 'totals','[0,0]'::jsonb) <> coalesce(stored_state -> 'totals','[0,0]'::jsonb) then return false; end if;
      if coalesce(next_state -> 'rounds','[]'::jsonb) <> coalesce(stored_state -> 'rounds','[]'::jsonb) then return false; end if;
      return true;
    end if;
    if next_phase in ('roundOver','finished') then
      return stored_taken_len = 7
         and jsonb_array_length(coalesce(next_state -> 'rounds','[]'::jsonb)) = jsonb_array_length(coalesce(stored_state -> 'rounds','[]'::jsonb)) + 1;
    end if;
    return false;
  end if;

  if stored_phase = 'roundOver' then
    return next_phase in ('roundOver','finished')
       and coalesce(next_state -> 'hands','[]'::jsonb) = coalesce(stored_state -> 'hands','[]'::jsonb)
       and coalesce(next_state -> 'totals','[0,0]'::jsonb) = coalesce(stored_state -> 'totals','[0,0]'::jsonb)
       and coalesce(next_state -> 'rounds','[]'::jsonb) = coalesce(stored_state -> 'rounds','[]'::jsonb);
  end if;

  if stored_phase = 'finished' then
    return next_state = stored_state;
  end if;

  return false;
end;
$function$;

-- Patch the v792a save RPC in-place: insert integrity validation immediately after the existing
-- hidden-hand merge has produced next_state, but before status/stat/table writes.
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
  select * into game_row from public.klaverjas_online_games where id = game_id_input for update;
  if not found then raise exception 'Klaverjas room niet gevonden'; end if;
  if game_row.status = 'closed' then raise exception 'Deze klaverjastafel is gesloten'; end if;

  stored_players := coalesce(game_row.state -> 'players', '[]'::jsonb);
  input_players := coalesce(state_input -> 'players', stored_players);
  stored_phase := coalesce(nullif(game_row.state ->> 'phase',''), game_row.status, 'lobby');
  if jsonb_typeof(stored_players) <> 'array' or jsonb_typeof(input_players) <> 'array' then raise exception 'klaverjas_online_roster_invalid'; end if;
  if jsonb_array_length(input_players) > 4 then raise exception 'klaverjas_online_roster_too_large'; end if;

  for participant in select * from jsonb_array_elements(stored_players)
  loop
    if coalesce((participant ->> 'is_bot')::boolean, false) then has_bots := true; end if;
    if lower(coalesce(participant ->> 'name','')) = lower(coalesce(session_player.display_name,'')) then
      is_participant := true;
      viewer_seat := nullif(participant ->> 'seat','')::integer;
    end if;
  end loop;
  if not is_participant then raise exception 'Je zit niet aan deze klaverjastafel'; end if;

  for stored_player in select * from jsonb_array_elements(stored_players)
  loop
    matching_player := null;
    select item into matching_player from jsonb_array_elements(input_players) as incoming(item)
     where nullif(item ->> 'seat','')::integer = nullif(stored_player ->> 'seat','')::integer limit 1;
    if matching_player is null
       or lower(coalesce(matching_player ->> 'name','')) <> lower(coalesce(stored_player ->> 'name',''))
       or coalesce((matching_player ->> 'team')::integer, 0) <> coalesce((stored_player ->> 'team')::integer, 0)
       or coalesce((matching_player ->> 'is_bot')::boolean, false) <> coalesce((stored_player ->> 'is_bot')::boolean, false)
       or coalesce(matching_player ->> 'player_type', case when coalesce((matching_player ->> 'is_bot')::boolean,false) then 'bot' else 'human' end)
          <> coalesce(stored_player ->> 'player_type', case when coalesce((stored_player ->> 'is_bot')::boolean,false) then 'bot' else 'human' end)
    then raise exception 'klaverjas_online_roster_mutation_rejected'; end if;
  end loop;

  for input_player in select * from jsonb_array_elements(input_players)
  loop
    matching_player := null;
    select item into matching_player from jsonb_array_elements(stored_players) as stored(item)
     where nullif(item ->> 'seat','')::integer = nullif(input_player ->> 'seat','')::integer limit 1;
    if matching_player is null then
      if stored_phase <> 'lobby'
         or not coalesce((input_player ->> 'is_bot')::boolean, false)
         or nullif(input_player ->> 'seat','')::integer not between 0 and 3
         or coalesce((input_player ->> 'team')::integer, 0) <> (case when nullif(input_player ->> 'seat','')::integer in (0,2) then 1 else 2 end)
      then raise exception 'klaverjas_online_roster_addition_rejected'; end if;
      has_bots := true;
    end if;
  end loop;

  if exists (
    select 1 from (
      select nullif(item ->> 'seat','')::integer as seat_no, count(*) as n
      from jsonb_array_elements(input_players) as roster(item)
      group by nullif(item ->> 'seat','')::integer
    ) d where d.seat_no is null or d.seat_no not between 0 and 3 or d.n <> 1
  ) then raise exception 'klaverjas_online_roster_seat_invalid'; end if;

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
      select item into merge_player from jsonb_array_elements(input_players) as roster(item)
       where nullif(item ->> 'seat','')::integer = idx limit 1;
      merged_hands := merged_hands || jsonb_build_array(
        case when idx = viewer_seat or coalesce((merge_player ->> 'is_bot')::boolean, false)
             then coalesce(input_hands -> idx, '[]'::jsonb)
             else coalesce(stored_hands -> idx, '[]'::jsonb) end
      );
    end loop;
    next_state := jsonb_set(next_state, '{hands}', merged_hands, true);
  end if;

  -- Human-only games feed persistent scores/stats, so they must satisfy the server-side
  -- transition contract. Bot rooms are explicitly non-persistent test rooms and retain the
  -- current client-driven multi-bot batching behavior.
  if not has_bots and not public._klaverjas_online_human_transition_valid(game_row.state, next_state, viewer_seat) then
    raise exception 'klaverjas_online_illegal_state_transition';
  end if;

  next_status := coalesce(nullif(next_state ->> 'phase', ''), game_row.status, 'lobby');
  if next_status not in ('lobby','bidding','playing','roundOver','finished') then
    raise exception 'klaverjas_online_phase_invalid';
  end if;

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
        stat_participant ->> 'name', 1,
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
        last_game_at = now(), updated_at = now();
    end loop;
  end if;

  update public.klaverjas_online_games
     set state = next_state,
         status = next_status,
         updated_at = now(),
         action_deadline_at = nullif(next_state ->> 'action_deadline_at', '')::timestamptz,
         finished_at = case when next_status = 'finished' then coalesce(finished_at, now()) else finished_at end,
         saved_jas_game_id = coalesce(saved_jas_game_id, nullif(saved_result ->> 'game_id', '')::bigint)
   where id = game_row.id returning * into game_row;

  if summary_payload is not null and not has_bots then
    begin
      perform public.save_game_match_summary_scoped(session_token, 'klaverjas', game_row.id::text, summary_payload, game_row.site_scope);
    exception when undefined_function then
      begin
        perform public.save_game_match_summary(session_token, 'klaverjas', game_row.id::text, summary_payload);
      exception when others then null;
      end;
    when others then null;
    end;
  end if;

  return public._klaverjas_online_public(game_row, session_token);
end;
$function$;

revoke execute on function public._klaverjas_online_full_deal_valid(jsonb) from public, anon, authenticated;
revoke execute on function public._klaverjas_online_human_transition_valid(jsonb,jsonb,integer) from public, anon, authenticated;
revoke execute on function public.klaverjas_online_save_state(text,uuid,jsonb,jsonb,jsonb) from public;
grant execute on function public.klaverjas_online_save_state(text,uuid,jsonb,jsonb,jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
