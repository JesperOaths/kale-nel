-- Deterministic semantics proof for the three Paardenrace RPCs reconstructed from
-- read-only production catalog evidence. Runs only against an isolated CI database.

insert into public.paardenrace_rooms (id, room_code, stage, host_name, updated_at)
values (1, 'TEST', 'lobby', 'Host', now());

insert into public.paardenrace_room_players
  (room_id, player_name, selected_suit, wager_bakken, wager_verified, wager_saved_at, is_ready, updated_at)
values
  (1, 'Host', null, null, false, null, true, now()),
  (1, 'Guest', null, null, true, null, true, now());

-- Stats is intentionally a stable empty response, but it must normalize scope and
-- preserve the deployed response contract.
do $test$
declare
  v_state jsonb;
begin
  v_state := public.get_paardenrace_stats_fast_v687('  club  ', 99);
  if v_state->>'version' <> 'v687a' then
    raise exception 'stats version mismatch: %', v_state;
  end if;
  if v_state->>'site_scope' <> 'club' then
    raise exception 'stats scope normalization mismatch: %', v_state;
  end if;
  if v_state->'leaderboard' <> '[]'::jsonb or v_state->'recent' <> '[]'::jsonb then
    raise exception 'stats arrays must remain empty: %', v_state;
  end if;

  v_state := public.get_paardenrace_stats_fast_v687('', 1);
  if v_state->>'site_scope' <> 'friends' then
    raise exception 'stats empty scope must default to friends: %', v_state;
  end if;
end
$test$;

-- Missing room must reject before any player state can change.
do $test$
begin
  begin
    perform public.update_paardenrace_room_choice_safe('guest-token', null, 'MISSING', 'hearts', 3, true, 'friends');
    raise exception 'expected missing-room rejection';
  exception when others then
    if position('Room niet gevonden.' in sqlerrm) = 0 then raise; end if;
  end;
end
$test$;

-- Choice mutation is lobby-only.
do $test$
begin
  update public.paardenrace_rooms set stage = 'running' where id = 1;
  begin
    perform public.update_paardenrace_room_choice_safe('guest-token', null, 'TEST', 'hearts', 3, true, 'friends');
    raise exception 'expected non-lobby rejection';
  exception when others then
    if position('Je kunt je inzet alleen in de lobby aanpassen.' in sqlerrm) = 0 then raise; end if;
  end;
  update public.paardenrace_rooms set stage = 'lobby' where id = 1;
end
$test$;

-- Only the four canonical horse suits are accepted.
do $test$
begin
  begin
    perform public.update_paardenrace_room_choice_safe('guest-token', null, 'TEST', 'joker', 3, true, 'friends');
    raise exception 'expected invalid-suit rejection';
  exception when others then
    if position('Kies eerst een paard/suit.' in sqlerrm) = 0 then raise; end if;
  end;
end
$test$;

-- Wager must be strictly positive.
do $test$
begin
  begin
    perform public.update_paardenrace_room_choice_safe('guest-token', null, 'TEST', 'hearts', 0, true, 'friends');
    raise exception 'expected nonpositive-wager rejection';
  exception when others then
    if position('Vul eerst een inzet in Bakken in.' in sqlerrm) = 0 then raise; end if;
  end;
end
$test$;

-- A valid choice lowercases the suit, stores the wager and deliberately clears both
-- prior verification and ready state regardless of the ready_input compatibility arg.
do $test$
declare
  v_row public.paardenrace_room_players%rowtype;
begin
  update public.paardenrace_room_players
     set wager_verified = true, is_ready = true
   where room_id = 1 and player_name = 'Guest';

  perform public.update_paardenrace_room_choice_safe('guest-token', null, ' test ', ' HeArTs ', 3, true, 'friends');

  select * into v_row
    from public.paardenrace_room_players
   where room_id = 1 and player_name = 'Guest';

  if v_row.selected_suit <> 'hearts' then raise exception 'choice suit mismatch: %', v_row.selected_suit; end if;
  if v_row.wager_bakken <> 3 then raise exception 'choice wager mismatch: %', v_row.wager_bakken; end if;
  if coalesce(v_row.wager_verified, true) then raise exception 'choice must clear wager_verified'; end if;
  if coalesce(v_row.is_ready, true) then raise exception 'choice must clear is_ready'; end if;
  if v_row.wager_saved_at is null then raise exception 'choice must stamp wager_saved_at'; end if;
end
$test$;

-- Verification is host-only.
do $test$
begin
  begin
    perform public.verify_paardenrace_wager_safe('guest-token', null, 'TEST', 'Guest', 'friends');
    raise exception 'expected host-only verification rejection';
  exception when others then
    if position('Alleen de host mag wagers verifiëren.' in sqlerrm) = 0 then raise; end if;
  end;
end
$test$;

-- A player without both a positive wager and selected suit has no verifiable wager.
do $test$
begin
  begin
    perform public.verify_paardenrace_wager_safe('host-token', null, 'TEST', 'Host', 'friends');
    raise exception 'expected missing-open-wager rejection';
  exception when others then
    if position('Geen open wager gevonden voor deze speler.' in sqlerrm) = 0 then raise; end if;
  end;
end
$test$;

-- Host verification marks the selected target verified and clears ready state.
do $test$
declare
  v_verified boolean;
  v_ready boolean;
begin
  update public.paardenrace_room_players
     set is_ready = true
   where room_id = 1 and player_name = 'Guest';

  perform public.verify_paardenrace_wager_safe('host-token', null, 'TEST', 'Guest', 'friends');

  select wager_verified, is_ready into v_verified, v_ready
    from public.paardenrace_room_players
   where room_id = 1 and player_name = 'Guest';

  if v_verified is distinct from true then raise exception 'verification must set wager_verified=true'; end if;
  if coalesce(v_ready, true) then raise exception 'verification must clear is_ready'; end if;
end
$test$;

-- Omitting target_player_name defaults verification to the host themself.
do $test$
declare
  v_verified boolean;
  v_ready boolean;
begin
  perform public.update_paardenrace_room_choice_safe('host-token', null, 'TEST', 'diamonds', 4, true, 'friends');
  update public.paardenrace_room_players
     set is_ready = true
   where room_id = 1 and player_name = 'Host';

  perform public.verify_paardenrace_wager_safe('host-token', null, 'TEST', null, 'friends');

  select wager_verified, is_ready into v_verified, v_ready
    from public.paardenrace_room_players
   where room_id = 1 and player_name = 'Host';

  if v_verified is distinct from true then raise exception 'default host target must be verified'; end if;
  if coalesce(v_ready, true) then raise exception 'default host verification must clear is_ready'; end if;
end
$test$;

select 'Paardenrace reconstructed RPC semantics PASS' as result;
