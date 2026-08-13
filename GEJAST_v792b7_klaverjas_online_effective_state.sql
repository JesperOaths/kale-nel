-- GEJAST v792b7 — materialize authoritative same-deal state before validation.
-- SQL-only follow-up; frontend VERSION remains v792.

begin;

create or replace function public._klaverjas_online_effective_state_v792b7(
  game_row public.klaverjas_online_games,
  state_input jsonb,
  actor_seat integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  result_state jsonb := coalesce(state_input, '{}'::jsonb);
  stored_player jsonb;
  idx integer;
begin
  if coalesce(result_state ->> 'deal_nonce','') <> coalesce(game_row.state ->> 'deal_nonce','')
     or coalesce(result_state ->> 'deal_nonce','') = '' then
    return result_state;
  end if;

  if jsonb_typeof(game_row.state -> 'hands') <> 'array'
     or jsonb_array_length(game_row.state -> 'hands') <> 4
     or jsonb_typeof(result_state -> 'hands') <> 'array'
     or jsonb_array_length(result_state -> 'hands') <> 4 then
    raise exception 'klaverjas_online_hands_shape_invalid';
  end if;

  for idx in 0..3 loop
    stored_player := null;
    select item into stored_player
      from jsonb_array_elements(coalesce(game_row.state -> 'players','[]'::jsonb)) roster(item)
     where nullif(item ->> 'seat','')::integer = idx
     limit 1;

    if idx <> actor_seat and not coalesce((stored_player ->> 'is_bot')::boolean,false) then
      result_state := jsonb_set(
        result_state,
        array['hands',idx::text],
        coalesce(game_row.state -> 'hands' -> idx,'[]'::jsonb),
        false
      );

      if jsonb_typeof(result_state -> 'recovery_snapshot') = 'object'
         and jsonb_typeof(result_state #> '{recovery_snapshot,hands}') = 'array'
         and jsonb_array_length(result_state #> '{recovery_snapshot,hands}') = 4 then
        result_state := jsonb_set(
          result_state,
          array['recovery_snapshot','hands',idx::text],
          coalesce(game_row.state -> 'hands' -> idx,'[]'::jsonb),
          false
        );
      end if;
    end if;
  end loop;

  return result_state;
end;
$function$;

revoke execute on function public._klaverjas_online_effective_state_v792b7(public.klaverjas_online_games,jsonb,integer) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;