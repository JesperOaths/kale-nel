-- GEJAST v792b1 — restore authoritative hidden hands before v792b validation.
-- SQL-only follow-up; frontend VERSION remains v792.

begin;

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
  actor_seat integer := null;
  actor_is_host boolean := false;
  guarded_state jsonb := coalesce(state_input, '{}'::jsonb);
  idx integer;
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

  -- v792a intentionally redacts every other human hand from browser state. For the same deal,
  -- restore those private arrays from the locked authoritative row before the transition guard.
  -- Bot hands remain caller-visible because the existing client-side bot controller needs them.
  if coalesce(guarded_state ->> 'deal_nonce','') = coalesce(game_row.state ->> 'deal_nonce','')
     and coalesce(guarded_state ->> 'deal_nonce','') <> ''
     and jsonb_typeof(game_row.state -> 'hands') = 'array'
     and jsonb_array_length(game_row.state -> 'hands') = 4
  then
    if jsonb_typeof(guarded_state -> 'hands') <> 'array'
       or jsonb_array_length(guarded_state -> 'hands') <> 4 then
      raise exception 'klaverjas_online_hands_shape_invalid';
    end if;

    for idx in 0..3 loop
      stored_player := null;
      select item into stored_player
        from jsonb_array_elements(coalesce(game_row.state -> 'players', '[]'::jsonb)) as roster(item)
       where nullif(item ->> 'seat','')::integer = idx
       limit 1;

      if idx <> actor_seat and not coalesce((stored_player ->> 'is_bot')::boolean, false) then
        guarded_state := jsonb_set(
          guarded_state,
          array['hands', idx::text],
          coalesce(game_row.state -> 'hands' -> idx, '[]'::jsonb),
          false
        );

        if jsonb_typeof(guarded_state -> 'recovery_snapshot') = 'object'
           and jsonb_typeof(guarded_state #> '{recovery_snapshot,hands}') = 'array'
           and jsonb_array_length(guarded_state #> '{recovery_snapshot,hands}') = 4 then
          guarded_state := jsonb_set(
            guarded_state,
            array['recovery_snapshot','hands',idx::text],
            coalesce(game_row.state -> 'hands' -> idx, '[]'::jsonb),
            false
          );
        end if;
      end if;
    end loop;
  end if;

  perform public._klaverjas_online_state_transition_guard(
    coalesce(game_row.state, '{}'::jsonb),
    guarded_state,
    actor_seat,
    actor_is_host
  );

  return public._klaverjas_online_save_state_v792a(
    session_token,
    game_id_input,
    guarded_state,
    summary_payload,
    final_jas_payload
  );
end;
$function$;

revoke execute on function public.klaverjas_online_save_state(text,uuid,jsonb,jsonb,jsonb) from public;
grant execute on function public.klaverjas_online_save_state(text,uuid,jsonb,jsonb,jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;