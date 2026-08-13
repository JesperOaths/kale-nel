-- GEJAST v792b21 — final Online Klaverjas save guard chain after all helpers exist.
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
  actor_seat integer := null;
  has_bots boolean := false;
  effective_state jsonb;
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
    if coalesce((participant ->> 'is_bot')::boolean,false) then has_bots := true; end if;
    if not coalesce((participant ->> 'is_bot')::boolean,false)
       and lower(coalesce(participant ->> 'name','')) = lower(coalesce(session_player.display_name,'')) then
      actor_seat := nullif(participant ->> 'seat','')::integer;
    end if;
  end loop;
  if actor_seat is null then raise exception 'Je zit niet aan deze klaverjastafel'; end if;

  effective_state := public._klaverjas_online_effective_state_v792b7(game_row, state_input, actor_seat);
  perform public._klaverjas_online_deal_guard_v792b3(game_row.state, effective_state, actor_seat);

  if not has_bots then
    perform public._klaverjas_online_history_guard_v792b4(game_row.state, effective_state);
    perform public._klaverjas_online_round_result_match_v792b19(game_row.state, effective_state);
    perform public._klaverjas_online_cumulative_totals_guard_v792b20(game_row.state, effective_state);
  end if;

  perform public._klaverjas_online_bid_guard_v792b5(game_row.state, effective_state, actor_seat);
  perform public._klaverjas_online_play_guard_v792b6(game_row.state, effective_state, actor_seat);
  perform public._klaverjas_online_human_card_legality_guard_v792b12(game_row.state, effective_state, actor_seat);

  return public._klaverjas_online_save_state_v792a(
    session_token,
    game_id_input,
    effective_state,
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