-- GEJAST v792b6 — validate single-human card/trick transitions.
-- Bot-controlled saves may batch bot actions; human turns may not.
-- SQL-only follow-up; frontend VERSION remains v792.

begin;

create or replace function public._klaverjas_online_trick_winner_v792b6(cards jsonb, trump_suit text)
returns integer
language plpgsql
immutable
security definer
set search_path to 'public'
as $function$
declare
  play jsonb;
  suit text;
  rank text;
  lead_suit text;
  trump text := lower(coalesce(trump_suit,''));
  category integer;
  strength integer;
  best_category integer := -1;
  best_strength integer := -1;
  best_player integer := null;
begin
  if jsonb_typeof(cards) <> 'array' or jsonb_array_length(cards) <> 4 then return null; end if;
  lead_suit := cards #>> '{0,card,suit}';
  for play in select value from jsonb_array_elements(cards)
  loop
    suit := play #>> '{card,suit}';
    rank := play #>> '{card,rank}';
    if trump <> '' and trump <> 'sans' and suit = trump then category := 2;
    elsif suit = lead_suit then category := 1;
    else category := 0;
    end if;

    if category = 2 then
      strength := case rank when 'J' then 8 when '9' then 7 when 'A' then 6 when '10' then 5 when 'K' then 4 when 'Q' then 3 when '8' then 2 when '7' then 1 else 0 end;
    else
      strength := case rank when 'A' then 8 when '10' then 7 when 'K' then 6 when 'Q' then 5 when 'J' then 4 when '9' then 3 when '8' then 2 when '7' then 1 else 0 end;
    end if;

    if category > best_category or (category = best_category and strength > best_strength) then
      best_category := category;
      best_strength := strength;
      best_player := nullif(play ->> 'player','')::integer;
    end if;
  end loop;
  return best_player;
exception when others then
  return null;
end;
$function$;

create or replace function public._klaverjas_online_play_guard_v792b6(
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
  winner integer;
  winner_player jsonb;
  winner_is_bot boolean := false;
  old_taken integer := case when jsonb_typeof(stored_state -> 'taken')='array' then jsonb_array_length(stored_state -> 'taken') else 0 end;
  new_taken integer := case when jsonb_typeof(next_state -> 'taken')='array' then jsonb_array_length(next_state -> 'taken') else 0 end;
  old_trick integer := case when jsonb_typeof(stored_state -> 'trick')='array' then jsonb_array_length(stored_state -> 'trick') else 0 end;
  old_hand jsonb;
  new_hand jsonb;
  appended_play jsonb;
  idx integer;
begin
  if coalesce(stored_state ->> 'deal_nonce','') is distinct from coalesce(next_state ->> 'deal_nonce','') then return; end if;
  if coalesce(stored_state ->> 'phase','') <> 'playing' then return; end if;

  if stored_state -> 'pending_trick' is not null then
    winner := nullif(stored_state #>> '{pending_trick,winner}','')::integer;
    select item into winner_player
      from jsonb_array_elements(coalesce(stored_state -> 'players','[]'::jsonb)) roster(item)
     where nullif(item ->> 'seat','')::integer = winner
     limit 1;
    winner_is_bot := coalesce((winner_player ->> 'is_bot')::boolean,false);
    if not winner_is_bot and (actor_seat % 2) <> (winner % 2) then
      raise exception 'klaverjas_online_trick_owner_rejected';
    end if;
    if winner_is_bot then return; end if;

    if coalesce(next_state -> 'hands','[]'::jsonb) is distinct from coalesce(stored_state -> 'hands','[]'::jsonb) then
      raise exception 'klaverjas_online_trick_hand_mutation_rejected';
    end if;
    if new_taken = old_taken then
      if coalesce(next_state #> '{pending_trick,cards}','[]'::jsonb) is distinct from coalesce(stored_state #> '{pending_trick,cards}','[]'::jsonb)
         or coalesce(next_state #> '{pending_trick,winner}','null'::jsonb) is distinct from coalesce(stored_state #> '{pending_trick,winner}','null'::jsonb)
         or coalesce(next_state #> '{pending_trick,roem}','null'::jsonb) is distinct from coalesce(stored_state #> '{pending_trick,roem}','null'::jsonb) then
        raise exception 'klaverjas_online_pending_trick_mutation_rejected';
      end if;
    elsif new_taken = old_taken + 1 then
      if next_state -> 'pending_trick' is not null or coalesce(next_state -> 'trick','[]'::jsonb) <> '[]'::jsonb then
        raise exception 'klaverjas_online_collect_transition_rejected';
      end if;
    else
      raise exception 'klaverjas_online_collect_transition_rejected';
    end if;
    return;
  end if;

  action_seat := nullif(stored_state ->> 'turn','')::integer;
  select item into action_player
    from jsonb_array_elements(coalesce(stored_state -> 'players','[]'::jsonb)) roster(item)
   where nullif(item ->> 'seat','')::integer = action_seat
   limit 1;
  action_is_bot := coalesce((action_player ->> 'is_bot')::boolean,false);
  if not action_is_bot and actor_seat <> action_seat then
    raise exception 'klaverjas_online_turn_owner_rejected';
  end if;
  if action_is_bot then return; end if;
  if coalesce(next_state ->> 'phase','') <> 'playing' or new_taken <> old_taken then
    raise exception 'klaverjas_online_human_play_shape_rejected';
  end if;

  old_hand := coalesce(stored_state -> 'hands' -> action_seat,'[]'::jsonb);
  new_hand := coalesce(next_state -> 'hands' -> action_seat,'[]'::jsonb);
  if jsonb_array_length(new_hand) <> jsonb_array_length(old_hand) - 1 then
    raise exception 'klaverjas_online_human_card_count_rejected';
  end if;
  for idx in 0..3 loop
    if idx <> action_seat and (next_state -> 'hands' -> idx) is distinct from (stored_state -> 'hands' -> idx) then
      raise exception 'klaverjas_online_other_hand_mutation_rejected';
    end if;
  end loop;

  if old_trick < 3 then
    if jsonb_array_length(coalesce(next_state -> 'trick','[]'::jsonb)) <> old_trick + 1
       or next_state -> 'pending_trick' is not null
       or coalesce((next_state ->> 'turn')::integer,-1) <> (action_seat + 1) % 4 then
      raise exception 'klaverjas_online_human_play_shape_rejected';
    end if;
    if old_trick > 0 then
      for idx in 0..old_trick - 1 loop
        if (next_state -> 'trick' -> idx) is distinct from (stored_state -> 'trick' -> idx) then
          raise exception 'klaverjas_online_human_play_shape_rejected';
        end if;
      end loop;
    end if;
    appended_play := next_state -> 'trick' -> old_trick;
  else
    if coalesce(next_state -> 'trick','[]'::jsonb) <> '[]'::jsonb
       or jsonb_array_length(coalesce(next_state #> '{pending_trick,cards}','[]'::jsonb)) <> 4
       or next_state -> 'turn' is not null then
      raise exception 'klaverjas_online_human_play_shape_rejected';
    end if;
    for idx in 0..2 loop
      if (next_state #> array['pending_trick','cards',idx::text]) is distinct from (stored_state -> 'trick' -> idx) then
        raise exception 'klaverjas_online_human_play_shape_rejected';
      end if;
    end loop;
    appended_play := next_state #> '{pending_trick,cards,3}';
    winner := public._klaverjas_online_trick_winner_v792b6(
      next_state #> '{pending_trick,cards}',
      next_state #>> '{accepted_bid,suit}'
    );
    if winner is null
       or coalesce((next_state #>> '{pending_trick,winner}')::integer,-1) <> winner
       or coalesce((next_state ->> 'action_needed_seat')::integer,-1) <> winner then
      raise exception 'klaverjas_online_trick_winner_rejected';
    end if;
  end if;

  if nullif(appended_play ->> 'player','')::integer <> actor_seat
     or not exists (select 1 from jsonb_array_elements(old_hand) card where card = appended_play -> 'card') then
    raise exception 'klaverjas_online_human_play_card_rejected';
  end if;
end;
$function$;

revoke execute on function public._klaverjas_online_trick_winner_v792b6(jsonb,text) from public, anon, authenticated;
revoke execute on function public._klaverjas_online_play_guard_v792b6(jsonb,jsonb,integer) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;