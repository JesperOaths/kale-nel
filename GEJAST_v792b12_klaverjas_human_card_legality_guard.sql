-- GEJAST v792b12 — connect the card-legality predicate to human play saves.
begin;
create or replace function public._klaverjas_online_human_card_legality_guard_v792b12(
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
  old_trick_count integer;
  chosen jsonb;
begin
  if coalesce(stored_state ->> 'deal_nonce','') is distinct from coalesce(next_state ->> 'deal_nonce','') then return; end if;
  if coalesce(stored_state ->> 'phase','') <> 'playing' or stored_state -> 'pending_trick' is not null then return; end if;

  action_seat := nullif(stored_state ->> 'turn','')::integer;
  select item into action_player from jsonb_array_elements(coalesce(stored_state -> 'players','[]'::jsonb)) roster(item)
   where nullif(item ->> 'seat','')::integer = action_seat limit 1;
  if coalesce((action_player ->> 'is_bot')::boolean,false) then return; end if;
  if actor_seat <> action_seat then raise exception 'klaverjas_online_turn_owner_rejected'; end if;

  old_trick_count := jsonb_array_length(coalesce(stored_state -> 'trick','[]'::jsonb));
  if old_trick_count < 3 then chosen := next_state -> 'trick' -> old_trick_count -> 'card';
  else chosen := next_state #> '{pending_trick,cards,3,card}';
  end if;

  if not public._klaverjas_online_card_legal_v792b11(
    coalesce(stored_state -> 'hands' -> actor_seat,'[]'::jsonb),
    coalesce(stored_state -> 'trick','[]'::jsonb),
    actor_seat,
    stored_state #>> '{accepted_bid,suit}',
    chosen
  ) then
    raise exception 'klaverjas_online_illegal_card_rejected';
  end if;
end;
$function$;
revoke execute on function public._klaverjas_online_human_card_legality_guard_v792b12(jsonb,jsonb,integer) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;