-- GEJAST v792b — Online Klaverjas state-transition integrity guard
-- SQL-only repair. Frontend VERSION intentionally remains v792.
--
-- v792a closes the private-hand/recovery leaks and roster-type escalation. This follow-up
-- keeps the existing client-driven bot architecture, but prevents an ordinary participant
-- from replacing the current deal or rewriting completed progress through the generic
-- whole-state save RPC.

begin;

create or replace function public._klaverjas_online_state_has_canonical_deck(state_input jsonb)
returns boolean
language sql
immutable
security definer
set search_path to 'public'
as $function$
  with cards as (
    select trim(both '"' from card_id::text) as id
      from jsonb_path_query(coalesce(state_input, '{}'::jsonb), '$.hands[*][*].id') card_id
    union all
    select trim(both '"' from card_id::text) as id
      from jsonb_path_query(coalesce(state_input, '{}'::jsonb), '$.trick[*].card.id') card_id
    union all
    select trim(both '"' from card_id::text) as id
      from jsonb_path_query(coalesce(state_input, '{}'::jsonb), '$.pending_trick.cards[*].card.id') card_id
    union all
    select trim(both '"' from card_id::text) as id
      from jsonb_path_query(coalesce(state_input, '{}'::jsonb), '$.taken[*].cards[*].card.id') card_id
  )
  select count(*) = 32
     and count(distinct id) = 32
     and coalesce(bool_and(id ~ '^(clubs|spades|hearts|diamonds)-(A|10|K|Q|J|9|8|7)$'), false)
    from cards
$function$;

create or replace function public._klaverjas_online_state_transition_guard(
  stored_state jsonb,
  next_state jsonb,
  actor_seat integer,
  actor_is_host boolean default false
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  old_phase text := coalesce(nullif(stored_state ->> 'phase',''), 'lobby');
  new_phase text := coalesce(nullif(next_state ->> 'phase',''), old_phase);
  old_nonce text := coalesce(stored_state ->> 'deal_nonce','');
  new_nonce text := coalesce(next_state ->> 'deal_nonce','');
  old_round_count integer := case when jsonb_typeof(stored_state -> 'rounds') = 'array' then jsonb_array_length(stored_state -> 'rounds') else 0 end;
  new_round_count integer := case when jsonb_typeof(next_state -> 'rounds') = 'array' then jsonb_array_length(next_state -> 'rounds') else 0 end;
  old_taken_count integer := case when jsonb_typeof(stored_state -> 'taken') = 'array' then jsonb_array_length(stored_state -> 'taken') else 0 end;
  old_trick_count integer := case when jsonb_typeof(stored_state -> 'trick') = 'array' then jsonb_array_length(stored_state -> 'trick') else 0 end;
  old_action_seat integer;
  target_player jsonb;
  target_is_bot boolean := false;
  winner_seat integer;
  winner_player jsonb;
  winner_is_bot boolean := false;
  old_hand jsonb;
  new_hand jsonb;
  appended_play jsonb;
  idx integer;
begin
  if jsonb_typeof(coalesce(next_state, '{}'::jsonb)) <> 'object' then
    raise exception 'klaverjas_online_state_invalid';
  end if;
  if actor_seat is null or actor_seat not between 0 and 3 then
    raise exception 'klaverjas_online_actor_seat_invalid';
  end if;
  if new_phase not in ('lobby','bidding','playing','roundOver','finished') then
    raise exception 'klaverjas_online_phase_invalid';
  end if;

  -- Existing completed rounds are append-only. A generic save may finish at most one round.
  if new_round_count < old_round_count or new_round_count > old_round_count + 1 then
    raise exception 'klaverjas_online_round_history_rewrite_rejected';
  end if;
  for idx in 0..old_round_count - 1 loop
    if (next_state -> 'rounds' -> idx) is distinct from (stored_state -> 'rounds' -> idx) then
      raise exception 'klaverjas_online_round_history_rewrite_rejected';
    end if;
  end loop;
  if new_round_count = old_round_count
     and coalesce(next_state -> 'totals', '[0,0]'::jsonb) is distinct from coalesce(stored_state -> 'totals', '[0,0]'::jsonb) then
    raise exception 'klaverjas_online_totals_without_round_rejected';
  end if;
  if new_round_count = old_round_count + 1 then
    if old_phase <> 'playing'
       or stored_state -> 'pending_trick' is null
       or old_taken_count <> 7 then
      raise exception 'klaverjas_online_round_advance_rejected';
    end if;
    if coalesce(next_state -> 'rounds' -> (new_round_count - 1) -> 'totals', 'null'::jsonb)
       is distinct from coalesce(next_state -> 'totals', 'null'::jsonb) then
      raise exception 'klaverjas_online_round_totals_mismatch';
    end if;
  end if;

  -- Replacing a deal is the strongest whole-state operation. Permit only the three real UI
  -- owners: seat 0 starting a full lobby, the current bidder after the fourth all-pass, or a
  -- participant starting the next round from roundOver.
  if new_nonce is distinct from old_nonce then
    if new_nonce = '' or jsonb_array_length(coalesce(next_state -> 'players', '[]'::jsonb)) <> 4 then
      raise exception 'klaverjas_online_deal_replacement_rejected';
    end if;
    if old_phase = 'lobby' then
      if actor_seat <> 0 or new_phase <> 'bidding' then
        raise exception 'klaverjas_online_deal_replacement_rejected';
      end if;
    elsif old_phase = 'roundOver' then
      if new_phase <> 'bidding'
         or new_round_count <> old_round_count
         or coalesce(next_state -> 'totals', '[0,0]'::jsonb) is distinct from coalesce(stored_state -> 'totals', '[0,0]'::jsonb) then
        raise exception 'klaverjas_online_deal_replacement_rejected';
      end if;
    elsif old_phase = 'bidding' then
      old_action_seat := nullif(stored_state ->> 'bidder_turn','')::integer;
      select item into target_player
        from jsonb_array_elements(coalesce(stored_state -> 'players', '[]'::jsonb)) as roster(item)
       where nullif(item ->> 'seat','')::integer = old_action_seat
       limit 1;
      target_is_bot := coalesce((target_player ->> 'is_bot')::boolean, false);
      if new_phase <> 'bidding'
         or stored_state -> 'current_bid' is not null
         or coalesce((stored_state ->> 'passes_since_bid')::integer, 0) <> 3
         or (not target_is_bot and actor_seat <> old_action_seat)
         or new_round_count <> old_round_count
         or coalesce(next_state -> 'totals', '[0,0]'::jsonb) is distinct from coalesce(stored_state -> 'totals', '[0,0]'::jsonb)
      then
        raise exception 'klaverjas_online_deal_replacement_rejected';
      end if;
    else
      raise exception 'klaverjas_online_deal_replacement_rejected';
    end if;

    if not public._klaverjas_online_state_has_canonical_deck(next_state) then
      raise exception 'klaverjas_online_deal_invalid';
    end if;
    return;
  end if;

  -- Once a deal exists, its 32 cards must remain conserved across hands, current/pending trick
  -- and completed tricks. This catches card injection, duplication and deletion even on bot turns.
  if old_nonce <> '' and not public._klaverjas_online_state_has_canonical_deck(next_state) then
    raise exception 'klaverjas_online_card_conservation_rejected';
  end if;

  if old_phase in ('finished','closed') then
    raise exception 'klaverjas_online_finished_state_mutation_rejected';
  end if;

  if old_phase = 'lobby' then
    if new_phase <> 'lobby' then
      raise exception 'klaverjas_online_phase_transition_rejected';
    end if;
    return;
  end if;

  if old_phase = 'bidding' then
    old_action_seat := nullif(stored_state ->> 'bidder_turn','')::integer;
    select item into target_player
      from jsonb_array_elements(coalesce(stored_state -> 'players', '[]'::jsonb)) as roster(item)
     where nullif(item ->> 'seat','')::integer = old_action_seat
     limit 1;
    target_is_bot := coalesce((target_player ->> 'is_bot')::boolean, false);
    if not target_is_bot and actor_seat <> old_action_seat then
      raise exception 'klaverjas_online_bidder_turn_rejected';
    end if;
    if new_phase not in ('bidding','playing') then
      raise exception 'klaverjas_online_phase_transition_rejected';
    end if;
    -- Bidding cannot move cards or completed history.
    if coalesce(next_state -> 'hands', '[]'::jsonb) is distinct from coalesce(stored_state -> 'hands', '[]'::jsonb)
       or coalesce(next_state -> 'taken', '[]'::jsonb) is distinct from coalesce(stored_state -> 'taken', '[]'::jsonb)
       or coalesce(next_state -> 'trick', '[]'::jsonb) is distinct from coalesce(stored_state -> 'trick', '[]'::jsonb)
       or coalesce(next_state -> 'pending_trick', 'null'::jsonb) is distinct from coalesce(stored_state -> 'pending_trick', 'null'::jsonb)
    then
      raise exception 'klaverjas_online_bidding_card_mutation_rejected';
    end if;
    return;
  end if;

  if old_phase = 'playing' then
    if stored_state -> 'pending_trick' is not null then
      winner_seat := nullif(stored_state #>> '{pending_trick,winner}','')::integer;
      select item into winner_player
        from jsonb_array_elements(coalesce(stored_state -> 'players', '[]'::jsonb)) as roster(item)
       where nullif(item ->> 'seat','')::integer = winner_seat
       limit 1;
      winner_is_bot := coalesce((winner_player ->> 'is_bot')::boolean, false);
      if not winner_is_bot and (actor_seat % 2) <> (winner_seat % 2) then
        raise exception 'klaverjas_online_trick_owner_rejected';
      end if;
      if new_phase not in ('playing','roundOver','finished') then
        raise exception 'klaverjas_online_phase_transition_rejected';
      end if;
      -- Collect/klop never changes a hand directly. Bot batching after collection may do so only
      -- when the winner itself is a bot, which is already treated as a bot-controlled transition.
      if not winner_is_bot
         and coalesce(next_state -> 'hands', '[]'::jsonb) is distinct from coalesce(stored_state -> 'hands', '[]'::jsonb) then
        raise exception 'klaverjas_online_trick_hand_mutation_rejected';
      end if;
      return;
    end if;

    old_action_seat := nullif(stored_state ->> 'turn','')::integer;
    select item into target_player
      from jsonb_array_elements(coalesce(stored_state -> 'players', '[]'::jsonb)) as roster(item)
     where nullif(item ->> 'seat','')::integer = old_action_seat
     limit 1;
    target_is_bot := coalesce((target_player ->> 'is_bot')::boolean, false);
    if not target_is_bot and actor_seat <> old_action_seat then
      raise exception 'klaverjas_online_turn_owner_rejected';
    end if;
    if new_phase <> 'playing' then
      raise exception 'klaverjas_online_phase_transition_rejected';
    end if;

    -- A human turn is exactly one card from that human hand into the current trick (or into a
    -- newly completed pending trick). Bot turns may still batch because that is how the current
    -- client-side bot controller operates; bot games are already excluded from persistent stats.
    if not target_is_bot then
      old_hand := coalesce(stored_state -> 'hands' -> old_action_seat, '[]'::jsonb);
      new_hand := coalesce(next_state -> 'hands' -> old_action_seat, '[]'::jsonb);
      if jsonb_array_length(new_hand) <> jsonb_array_length(old_hand) - 1 then
        raise exception 'klaverjas_online_human_card_count_rejected';
      end if;
      if old_trick_count < 3 then
        if jsonb_array_length(coalesce(next_state -> 'trick', '[]'::jsonb)) <> old_trick_count + 1
           or coalesce(next_state -> 'trick' -> (old_trick_count - 1), 'null'::jsonb) is distinct from coalesce(stored_state -> 'trick' -> (old_trick_count - 1), 'null'::jsonb)
        then
          raise exception 'klaverjas_online_human_play_shape_rejected';
        end if;
        appended_play := next_state -> 'trick' -> old_trick_count;
      else
        if coalesce(next_state -> 'trick', '[]'::jsonb) <> '[]'::jsonb
           or jsonb_array_length(coalesce(next_state #> '{pending_trick,cards}', '[]'::jsonb)) <> 4
        then
          raise exception 'klaverjas_online_human_play_shape_rejected';
        end if;
        appended_play := next_state #> '{pending_trick,cards,3}';
      end if;
      if nullif(appended_play ->> 'player','')::integer <> actor_seat
         or not exists (
           select 1 from jsonb_array_elements(old_hand) c
            where c ->> 'id' = appended_play #>> '{card,id}'
         )
      then
        raise exception 'klaverjas_online_human_play_card_rejected';
      end if;
    end if;
    return;
  end if;

  if old_phase = 'roundOver' then
    if new_phase not in ('roundOver','finished') then
      raise exception 'klaverjas_online_phase_transition_rejected';
    end if;
    return;
  end if;

  raise exception 'klaverjas_online_phase_transition_rejected';
end;
$function$;

-- Preserve the proven v792a implementation as an internal worker, then put the transition
-- boundary in front of it. This avoids duplicating the privacy/statistics implementation.
alter function public.klaverjas_online_save_state(text,uuid,jsonb,jsonb,jsonb)
  rename to _klaverjas_online_save_state_v792a;

revoke execute on function public._klaverjas_online_save_state_v792a(text,uuid,jsonb,jsonb,jsonb)
  from public, anon, authenticated;

create function public.klaverjas_online_save_state(
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
  actor_seat integer := null;
  actor_is_host boolean := false;
begin
  session_player := public._jas_session_player(session_token);
  select * into game_row
    from public.klaverjas_online_games
   where id = game_id_input
   for update;
  if not found then raise exception 'Klaverjas room niet gevonden'; end if;
  if game_row.status = 'closed' then raise exception 'Deze klaverjastafel is gesloten'; end if;

  for participant in select * from jsonb_array_elements(coalesce(game_row.state -> 'players', '[]'::jsonb))
  loop
    if not coalesce((participant ->> 'is_bot')::boolean, false)
       and lower(coalesce(participant ->> 'name','')) = lower(coalesce(session_player.display_name,'')) then
      actor_seat := nullif(participant ->> 'seat','')::integer;
      exit;
    end if;
  end loop;
  if actor_seat is null then raise exception 'Je zit niet aan deze klaverjastafel'; end if;

  actor_is_host := game_row.created_by_player_id = session_player.id
    or lower(coalesce(game_row.created_by_player_name,'')) = lower(coalesce(session_player.display_name,''));

  perform public._klaverjas_online_state_transition_guard(
    coalesce(game_row.state, '{}'::jsonb),
    coalesce(state_input, '{}'::jsonb),
    actor_seat,
    actor_is_host
  );

  return public._klaverjas_online_save_state_v792a(
    session_token,
    game_id_input,
    state_input,
    summary_payload,
    final_jas_payload
  );
end;
$function$;

revoke execute on function public._klaverjas_online_state_has_canonical_deck(jsonb) from public, anon, authenticated;
revoke execute on function public._klaverjas_online_state_transition_guard(jsonb,jsonb,integer,boolean) from public, anon, authenticated;
revoke execute on function public.klaverjas_online_save_state(text,uuid,jsonb,jsonb,jsonb) from public;
grant execute on function public.klaverjas_online_save_state(text,uuid,jsonb,jsonb,jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;