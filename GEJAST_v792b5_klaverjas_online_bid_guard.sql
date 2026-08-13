-- GEJAST v792b5 — validate single-human bidding transitions.
-- Bot-controlled saves may batch bot decisions; human turns may not.
-- SQL-only follow-up; frontend VERSION remains v792.

begin;

create or replace function public._klaverjas_online_bid_valid_v792b5(new_bid jsonb, old_bid jsonb)
returns boolean
language plpgsql
immutable
security definer
set search_path to 'public'
as $function$
declare
  mode text := lower(coalesce(new_bid ->> 'mode',''));
  suit text := lower(coalesce(new_bid ->> 'suit',''));
  kind text := lower(coalesce(new_bid ->> 'kind',''));
  points integer := nullif(new_bid ->> 'points','')::integer;
  old_mode text := lower(coalesce(old_bid ->> 'mode',''));
  old_kind text := lower(coalesce(old_bid ->> 'kind',''));
  old_points integer := coalesce(nullif(old_bid ->> 'points','')::integer,-1);
  new_rank numeric;
  old_rank numeric;
  all_points boolean;
  old_all_points boolean;
begin
  if jsonb_typeof(new_bid) <> 'object' then return false; end if;
  all_points := kind in ('pit','mars','doormars') or (mode='sans' and points=132);
  old_all_points := old_kind in ('pit','mars','doormars') or (old_mode='sans' and old_points=132);
  if all_points then return true; end if;

  if mode='sans' then
    if points < 70 or points > 130 or points % 10 <> 0 then return false; end if;
    new_rank := points + 0.1;
  elsif mode='suit' then
    if suit not in ('clubs','spades','hearts','diamonds')
       or points < 80 or points > 160 or points % 10 <> 0 then return false; end if;
    new_rank := points;
  else
    return false;
  end if;

  if old_bid is null or old_bid = 'null'::jsonb then return true; end if;
  if old_all_points then return false; end if;
  old_rank := old_points + case when old_mode='sans' then 0.1 else 0 end;
  if mode='sans' then return new_rank >= old_rank; end if;
  return new_rank > old_rank;
exception when others then
  return false;
end;
$function$;

create or replace function public._klaverjas_online_bid_guard_v792b5(
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
  action_seat integer;
  action_player jsonb;
  action_is_bot boolean := false;
  old_bid jsonb := stored_state -> 'current_bid';
  new_bid jsonb := next_state -> 'current_bid';
  old_passes integer := coalesce((stored_state ->> 'passes_since_bid')::integer,0);
  new_passes integer := coalesce((next_state ->> 'passes_since_bid')::integer,0);
  expected_turn integer;
  closes boolean;
begin
  if coalesce(stored_state ->> 'deal_nonce','') is distinct from coalesce(next_state ->> 'deal_nonce','') then return; end if;
  if coalesce(stored_state ->> 'phase','') <> 'bidding' then return; end if;

  action_seat := nullif(stored_state ->> 'bidder_turn','')::integer;
  select item into action_player
    from jsonb_array_elements(coalesce(stored_state -> 'players','[]'::jsonb)) roster(item)
   where nullif(item ->> 'seat','')::integer = action_seat
   limit 1;
  action_is_bot := coalesce((action_player ->> 'is_bot')::boolean,false);

  if not action_is_bot and actor_seat <> action_seat then
    raise exception 'klaverjas_online_bidder_turn_rejected';
  end if;
  if coalesce(next_state ->> 'phase','') not in ('bidding','playing') then
    raise exception 'klaverjas_online_phase_transition_rejected';
  end if;
  if coalesce(next_state -> 'hands','[]'::jsonb) is distinct from coalesce(stored_state -> 'hands','[]'::jsonb)
     or coalesce(next_state -> 'taken','[]'::jsonb) is distinct from coalesce(stored_state -> 'taken','[]'::jsonb)
     or coalesce(next_state -> 'trick','[]'::jsonb) is distinct from coalesce(stored_state -> 'trick','[]'::jsonb)
     or coalesce(next_state -> 'pending_trick','null'::jsonb) is distinct from coalesce(stored_state -> 'pending_trick','null'::jsonb) then
    raise exception 'klaverjas_online_bidding_card_mutation_rejected';
  end if;

  -- Bot games intentionally persist several consecutive bot bids at once.
  if action_is_bot then return; end if;

  expected_turn := (action_seat + 1) % 4;
  if new_bid is not distinct from old_bid then
    if new_passes <> old_passes + 1 then raise exception 'klaverjas_online_pass_transition_rejected'; end if;
    if old_bid is null or old_bid = 'null'::jsonb then
      -- The fourth all-pass must be a fresh deal and is handled by the deal guard.
      if new_passes >= 4
         or coalesce(next_state ->> 'phase','') <> 'bidding'
         or coalesce((next_state ->> 'bidder_turn')::integer,-1) <> expected_turn
         or next_state -> 'accepted_bid' is not null then
        raise exception 'klaverjas_online_pass_transition_rejected';
      end if;
    elsif new_passes >= 3 then
      if coalesce(next_state ->> 'phase','') <> 'playing'
         or coalesce(next_state -> 'accepted_bid','null'::jsonb) is distinct from old_bid
         or next_state -> 'bidder_turn' is not null
         or coalesce((next_state ->> 'turn')::integer,-1) <> (coalesce((stored_state ->> 'dealer')::integer,0) + 1) % 4 then
        raise exception 'klaverjas_online_pass_transition_rejected';
      end if;
    else
      if coalesce(next_state ->> 'phase','') <> 'bidding'
         or coalesce((next_state ->> 'bidder_turn')::integer,-1) <> expected_turn
         or next_state -> 'accepted_bid' is not null then
        raise exception 'klaverjas_online_pass_transition_rejected';
      end if;
    end if;
    return;
  end if;

  if new_passes <> 0
     or not public._klaverjas_online_bid_valid_v792b5(new_bid, old_bid)
     or coalesce((new_bid ->> 'player')::integer,-1) <> actor_seat
     or coalesce((new_bid ->> 'team')::integer,-1) <> (case when actor_seat in (0,2) then 1 else 2 end) then
    raise exception 'klaverjas_online_bid_transition_rejected';
  end if;

  closes := lower(coalesce(new_bid ->> 'kind','')) in ('pit','mars','doormars')
    or (lower(coalesce(new_bid ->> 'mode',''))='sans' and coalesce((new_bid ->> 'points')::integer,0)=132);
  if closes then
    if coalesce(next_state ->> 'phase','') <> 'playing'
       or coalesce(next_state -> 'accepted_bid','null'::jsonb) is distinct from new_bid
       or next_state -> 'bidder_turn' is not null
       or coalesce((next_state ->> 'turn')::integer,-1) <> (coalesce((stored_state ->> 'dealer')::integer,0) + 1) % 4 then
      raise exception 'klaverjas_online_bid_transition_rejected';
    end if;
  else
    if coalesce(next_state ->> 'phase','') <> 'bidding'
       or coalesce((next_state ->> 'bidder_turn')::integer,-1) <> expected_turn
       or next_state -> 'accepted_bid' is not null then
      raise exception 'klaverjas_online_bid_transition_rejected';
    end if;
  end if;
end;
$function$;

revoke execute on function public._klaverjas_online_bid_valid_v792b5(jsonb,jsonb) from public, anon, authenticated;
revoke execute on function public._klaverjas_online_bid_guard_v792b5(jsonb,jsonb,integer) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;