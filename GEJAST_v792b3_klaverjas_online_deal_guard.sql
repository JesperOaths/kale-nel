-- GEJAST v792b3 — isolated deal/nonce integrity guard.
-- SQL-only follow-up; frontend VERSION remains v792.

begin;

create or replace function public._klaverjas_online_deal_guard_v792b3(
  stored_state jsonb,
  next_state jsonb,
  actor_seat integer
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
  old_rounds integer := case when jsonb_typeof(stored_state -> 'rounds')='array' then jsonb_array_length(stored_state -> 'rounds') else 0 end;
  new_rounds integer := case when jsonb_typeof(next_state -> 'rounds')='array' then jsonb_array_length(next_state -> 'rounds') else 0 end;
  action_seat integer;
  action_player jsonb;
  action_is_bot boolean := false;
begin
  if actor_seat is null or actor_seat not between 0 and 3 then
    raise exception 'klaverjas_online_actor_seat_invalid';
  end if;
  if new_phase not in ('lobby','bidding','playing','roundOver','finished') then
    raise exception 'klaverjas_online_phase_invalid';
  end if;
  if old_phase in ('finished','closed') then
    raise exception 'klaverjas_online_finished_state_mutation_rejected';
  end if;

  if new_nonce is distinct from old_nonce then
    if new_nonce = ''
       or jsonb_typeof(next_state -> 'players') <> 'array'
       or jsonb_array_length(next_state -> 'players') <> 4
       or new_phase <> 'bidding'
       or new_rounds <> old_rounds
       or coalesce(next_state -> 'totals','[0,0]'::jsonb) is distinct from coalesce(stored_state -> 'totals','[0,0]'::jsonb)
       or coalesce((next_state ->> 'dealer')::integer,-1) <> coalesce((stored_state ->> 'dealer')::integer,-2)
       or coalesce((next_state ->> 'bidder_turn')::integer,-1) <> (coalesce((next_state ->> 'dealer')::integer,0) + 1) % 4
       or next_state -> 'turn' is not null
       or coalesce((next_state ->> 'passes_since_bid')::integer,-1) <> 0
       or next_state -> 'current_bid' is not null
       or next_state -> 'accepted_bid' is not null
       or coalesce(next_state -> 'trick','[]'::jsonb) <> '[]'::jsonb
       or next_state -> 'pending_trick' is not null
       or coalesce(next_state -> 'taken','[]'::jsonb) <> '[]'::jsonb
       or coalesce(next_state -> 'roem_by_team','[0,0]'::jsonb) <> '[0,0]'::jsonb
    then
      raise exception 'klaverjas_online_deal_replacement_rejected';
    end if;

    if old_phase = 'lobby' then
      if actor_seat <> 0 then raise exception 'klaverjas_online_deal_replacement_rejected'; end if;
    elsif old_phase = 'roundOver' then
      null;
    elsif old_phase = 'bidding' then
      action_seat := nullif(stored_state ->> 'bidder_turn','')::integer;
      select item into action_player
        from jsonb_array_elements(coalesce(stored_state -> 'players','[]'::jsonb)) roster(item)
       where nullif(item ->> 'seat','')::integer = action_seat
       limit 1;
      action_is_bot := coalesce((action_player ->> 'is_bot')::boolean,false);
      if stored_state -> 'current_bid' is not null
         or coalesce((stored_state ->> 'passes_since_bid')::integer,0) <> 3
         or (not action_is_bot and actor_seat <> action_seat) then
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

  if old_phase = 'lobby' then
    if new_phase <> 'lobby' then raise exception 'klaverjas_online_phase_transition_rejected'; end if;
    return;
  end if;

  if old_nonce = '' or not public._klaverjas_online_state_has_canonical_deck(next_state) then
    raise exception 'klaverjas_online_card_conservation_rejected';
  end if;
  if coalesce(next_state -> 'settings','{}'::jsonb) is distinct from coalesce(stored_state -> 'settings','{}'::jsonb) then
    raise exception 'klaverjas_online_settings_mutation_rejected';
  end if;
  if old_phase in ('playing','roundOver')
     and coalesce(next_state -> 'accepted_bid','null'::jsonb) is distinct from coalesce(stored_state -> 'accepted_bid','null'::jsonb) then
    raise exception 'klaverjas_online_accepted_bid_mutation_rejected';
  end if;

  if new_rounds = old_rounds then
    if coalesce(next_state -> 'dealer','null'::jsonb) is distinct from coalesce(stored_state -> 'dealer','null'::jsonb) then
      raise exception 'klaverjas_online_dealer_mutation_rejected';
    end if;
  elsif new_rounds = old_rounds + 1 then
    if coalesce((next_state ->> 'dealer')::integer,-1) <> (coalesce((stored_state ->> 'dealer')::integer,0) + 1) % 4 then
      raise exception 'klaverjas_online_dealer_advance_rejected';
    end if;
  else
    raise exception 'klaverjas_online_round_history_rewrite_rejected';
  end if;
end;
$function$;

revoke execute on function public._klaverjas_online_deal_guard_v792b3(jsonb,jsonb,integer) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;