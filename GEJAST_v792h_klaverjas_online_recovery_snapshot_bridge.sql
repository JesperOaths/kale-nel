-- GEJAST v792h — Online Klaverjas recovery-snapshot hidden-hand bridge
-- SQL-only continuation of v792b-v792g. Frontend VERSION intentionally remains v792.
--
-- v792a redacts other human hands both at state.hands and recovery_snapshot.hands.
-- v792b restores the authoritative top-level hands before transition validation, but the
-- redacted recovery copy would still be persisted back into the locked room. Rehydrate only
-- those hidden recovery hand slots before entering the v792f persistence/transition chain.

begin;

do $do$
begin
  if to_regprocedure('public._klaverjas_online_save_state_v792f_inner(text,uuid,jsonb,jsonb,jsonb)') is null then
    alter function public.klaverjas_online_save_state(text,uuid,jsonb,jsonb,jsonb)
      rename to _klaverjas_online_save_state_v792f_inner;
  end if;
end
$do$;

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

  for participant in select * from jsonb_array_elements(coalesce(game_row.state -> 'players','[]'::jsonb))
  loop
    if not coalesce((participant ->> 'is_bot')::boolean,false)
       and lower(coalesce(participant ->> 'name','')) = lower(coalesce(session_player.display_name,'')) then
      actor_seat := nullif(participant ->> 'seat','')::integer;
      exit;
    end if;
  end loop;
  if actor_seat is null then raise exception 'Je zit niet aan deze klaverjastafel'; end if;

  if coalesce(guarded_state ->> 'deal_nonce','') = coalesce(game_row.state ->> 'deal_nonce','')
     and coalesce(guarded_state ->> 'deal_nonce','') <> ''
     and jsonb_typeof(game_row.state -> 'recovery_snapshot') = 'object'
     and jsonb_typeof(game_row.state #> '{recovery_snapshot,hands}') = 'array'
     and jsonb_array_length(game_row.state #> '{recovery_snapshot,hands}') = 4
     and jsonb_typeof(guarded_state -> 'recovery_snapshot') = 'object'
     and jsonb_typeof(guarded_state #> '{recovery_snapshot,hands}') = 'array'
     and jsonb_array_length(guarded_state #> '{recovery_snapshot,hands}') = 4
  then
    for idx in 0..3 loop
      stored_player := null;
      select item into stored_player
        from jsonb_array_elements(coalesce(game_row.state -> 'players','[]'::jsonb)) roster(item)
       where nullif(item ->> 'seat','')::integer = idx
       limit 1;

      if idx <> actor_seat and not coalesce((stored_player ->> 'is_bot')::boolean,false) then
        guarded_state := jsonb_set(
          guarded_state,
          array['recovery_snapshot','hands',idx::text],
          coalesce(game_row.state #> array['recovery_snapshot','hands',idx::text], '[]'::jsonb),
          false
        );
      end if;
    end loop;
  end if;

  return public._klaverjas_online_save_state_v792f_inner(
    session_token,
    game_id_input,
    guarded_state,
    summary_payload,
    final_jas_payload
  );
end;
$function$;

revoke execute on function public._klaverjas_online_save_state_v792f_inner(text,uuid,jsonb,jsonb,jsonb)
  from public, anon, authenticated;
revoke execute on function public.klaverjas_online_save_state(text,uuid,jsonb,jsonb,jsonb) from public;
grant execute on function public.klaverjas_online_save_state(text,uuid,jsonb,jsonb,jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
