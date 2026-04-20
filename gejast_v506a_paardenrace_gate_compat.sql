-- v506a paardenrace gate/backstep compatibility patch
-- Purpose:
-- 1) keep the actual gate backstep logic in draw_paardenrace_card_safe
-- 2) expose resolved_gates alongside revealed_gates so newer frontend surfaces see opened gates
-- 3) initialize both keys when a race starts

create or replace function public._paardenrace_build_room_state(room_code_input text default null, session_token text default null, session_token_input text default null)
returns jsonb language plpgsql security definer as $$
declare
  v_room public.paardenrace_rooms%rowtype;
  v_viewer_name text;
  v_players jsonb := '[]'::jsonb;
  v_viewer jsonb := '{}'::jsonb;
  v_active jsonb := '{}'::jsonb;
  v_result jsonb := null;
  v_resolved jsonb := '[]'::jsonb;
begin
  v_viewer_name := public._paardenrace_require_name(session_token, session_token_input);
  select * into v_room from public.paardenrace_rooms where room_code = upper(trim(coalesce(room_code_input,'')));
  if v_room.id is null then raise exception 'Room niet gevonden.'; end if;
  v_active := coalesce(v_room.active_match, '{}'::jsonb);
  if v_active <> '{}'::jsonb then
    v_resolved := coalesce(v_active->'resolved_gates', v_active->'revealed_gates', '[]'::jsonb);
    v_active := jsonb_set(v_active, '{resolved_gates}', v_resolved, true);
    v_active := jsonb_set(v_active, '{revealed_gates}', v_resolved, true);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'player_name', rp.player_name,
    'selected_suit', rp.selected_suit,
    'wager_bakken', rp.wager_bakken,
    'is_ready', rp.is_ready,
    'is_host', lower(rp.player_name) = lower(v_room.host_name),
    'is_winner', lower(coalesce(rp.selected_suit,'')) = lower(coalesce(v_active->>'winner_suit','')),
    'total_bakken_owed', public._paardenrace_total_for_player(v_room.id, rp.player_name)
  ) order by rp.joined_at), '[]'::jsonb) into v_players
  from public.paardenrace_room_players rp where rp.room_id = v_room.id;

  select jsonb_build_object(
    'player_name', rp.player_name,
    'selected_suit', rp.selected_suit,
    'wager_bakken', rp.wager_bakken,
    'is_host', lower(rp.player_name) = lower(v_room.host_name),
    'can_nominate', v_room.stage = 'nominations' and lower(coalesce(rp.selected_suit,'')) = lower(coalesce(v_active->>'winner_suit','')) and not coalesce((v_active->'winner_submitted'->>lower(rp.player_name))::boolean, false),
    'nomination_budget_bakken', coalesce(rp.wager_bakken,0) * 2
  ) into v_viewer
  from public.paardenrace_room_players rp
  where rp.room_id = v_room.id and lower(rp.player_name) = lower(v_viewer_name)
  limit 1;

  if v_active <> '{}'::jsonb then v_result := public._paardenrace_result_summary(v_room.id, v_active); end if;

  return jsonb_build_object(
    'room', jsonb_build_object(
      'room_code', v_room.room_code,
      'host_name', v_room.host_name,
      'stage', v_room.stage,
      'stage_label', case v_room.stage when 'lobby' then 'Lobby' when 'countdown' then 'Countdown' when 'race' then 'Race' when 'nominations' then 'Nominaties' when 'finished' then 'Finished' else v_room.stage end,
      'can_start', v_room.stage = 'lobby' and lower(v_room.host_name) = lower(v_viewer_name) and public._paardenrace_all_ready(v_room.id),
      'can_draw', v_room.stage = 'race' and lower(v_room.host_name) = lower(v_viewer_name),
      'countdown_remaining_seconds', case when v_room.stage = 'countdown' and v_room.countdown_ends_at is not null and v_room.countdown_ends_at > now() then greatest(0, ceil(extract(epoch from (v_room.countdown_ends_at - now())))::integer) else 0 end
    ),
    'viewer', coalesce(v_viewer, '{}'::jsonb),
    'players', v_players,
    'match', case when v_active = '{}'::jsonb then null else v_active end,
    'result_summary', v_result
  );
end;
$$;

create or replace function public.tick_paardenrace_room_safe(session_token text default null, session_token_input text default null, room_code_input text default null)
returns jsonb language plpgsql security definer as $$
declare
  v_room public.paardenrace_rooms%rowtype;
  v_decks jsonb;
  v_match_ref uuid;
begin
  select * into v_room from public.paardenrace_rooms where room_code = upper(trim(coalesce(room_code_input,'')));
  if v_room.id is null then raise exception 'Room niet gevonden.'; end if;
  if v_room.stage = 'countdown' and v_room.countdown_ends_at is not null and v_room.countdown_ends_at <= now() then
    v_decks := public._paardenrace_make_decks();
    v_match_ref := gen_random_uuid();
    update public.paardenrace_rooms
    set stage = 'race',
        countdown_ends_at = null,
        active_match = jsonb_build_object(
          'match_ref', v_match_ref,
          'gate_cards', v_decks->'gate_cards',
          'draw_deck', v_decks->'draw_deck',
          'draw_index', 0,
          'revealed_draw_cards', '[]'::jsonb,
          'horse_positions', jsonb_build_object('hearts',0,'diamonds',0,'clubs',0,'spades',0),
          'revealed_gates', '[]'::jsonb,
          'resolved_gates', '[]'::jsonb,
          'gate_events', '[]'::jsonb,
          'winner_submitted', '{}'::jsonb,
          'nominations', '[]'::jsonb,
          'first_finish_suit', null,
          'first_claimed_finish_suit', null,
          'winner_suit', null,
          'last_draw_card', null
        ),
        updated_at = now(),
        finished_at = null
    where id = v_room.id;

    insert into public.paardenrace_obligations(room_id, match_ref, player_id, player_name, amount_bakken, source_kind, metadata)
    select v_room.id, v_match_ref, rp.player_id, rp.player_name, rp.wager_bakken, 'wager', jsonb_build_object('selected_suit', rp.selected_suit)
    from public.paardenrace_room_players rp where rp.room_id = v_room.id and coalesce(rp.wager_bakken,0) > 0;
  end if;
  return public._paardenrace_build_room_state(room_code_input, session_token, session_token_input);
end;
$$;

grant execute on function public.tick_paardenrace_room_safe(text,text,text) to anon, authenticated;

create or replace function public.draw_paardenrace_card_safe(session_token text default null, session_token_input text default null, room_code_input text default null)
returns jsonb language plpgsql security definer as $$
declare
  v_name text := public._paardenrace_require_name(session_token, session_token_input);
  v_room public.paardenrace_rooms%rowtype;
  m jsonb;
  draw_idx integer;
  draw_deck jsonb;
  gate_cards jsonb;
  positions jsonb;
  revealed jsonb;
  gate_events jsonb;
  card text;
  suit text;
  gate_no integer;
  gate_card text;
  gate_suit text;
  all_ready_gate boolean;
  winner_suit text;
begin
  select * into v_room from public.paardenrace_rooms where room_code = upper(trim(coalesce(room_code_input,'')));
  if v_room.id is null then raise exception 'Room niet gevonden.'; end if;
  if lower(v_room.host_name) <> lower(v_name) then raise exception 'Alleen de host mag trekken.'; end if;
  if v_room.stage <> 'race' then raise exception 'De race is niet actief.'; end if;

  m := v_room.active_match;
  draw_idx := coalesce((m->>'draw_index')::integer, 0);
  draw_deck := coalesce(m->'draw_deck', '[]'::jsonb);
  gate_cards := coalesce(m->'gate_cards', '[]'::jsonb);
  positions := coalesce(m->'horse_positions', jsonb_build_object('hearts',0,'diamonds',0,'clubs',0,'spades',0));
  revealed := coalesce(m->'resolved_gates', m->'revealed_gates', '[]'::jsonb);
  gate_events := coalesce(m->'gate_events', '[]'::jsonb);

  card := draw_deck->>draw_idx;
  if card is null then raise exception 'De trekstapel is leeg.'; end if;

  suit := public._paardenrace_suit_from_card(card);
  positions := jsonb_set(positions, array[suit], to_jsonb(least(11, coalesce((positions->>suit)::integer,0) + 1)), true);

  if coalesce(m->>'first_finish_suit','') = '' and coalesce((positions->>suit)::integer,0) >= 11 then
    m := jsonb_set(m, '{first_finish_suit}', to_jsonb(suit), true);
  end if;

  for gate_no in 1..10 loop
    if exists(select 1 from jsonb_array_elements_text(revealed) v where v.value::integer = gate_no) then continue; end if;
    all_ready_gate := coalesce((positions->>'hearts')::integer,0) >= gate_no
      and coalesce((positions->>'diamonds')::integer,0) >= gate_no
      and coalesce((positions->>'clubs')::integer,0) >= gate_no
      and coalesce((positions->>'spades')::integer,0) >= gate_no;
    if all_ready_gate then
      gate_card := gate_cards->>(gate_no - 1);
      gate_suit := public._paardenrace_suit_from_card(gate_card);
      positions := jsonb_set(positions, array[gate_suit], to_jsonb(greatest(0, coalesce((positions->>gate_suit)::integer,0) - 1)), true);
      revealed := revealed || to_jsonb(gate_no);
      gate_events := gate_events || jsonb_build_array(jsonb_build_object('gate_no', gate_no, 'card_code', gate_card, 'suit', gate_suit, 'backstep_applied', true));
    end if;
  end loop;

  if coalesce(m->>'winner_suit','') = '' then
    select min(suit_key) into winner_suit
    from (values ('hearts'),('diamonds'),('clubs'),('spades')) s(suit_key)
    where coalesce((positions->>suit_key)::integer,0) >= 11
      and exists(select 1 from public.paardenrace_room_players rp where rp.room_id = v_room.id and lower(coalesce(rp.selected_suit,'')) = lower(suit_key));
    if winner_suit is not null then
      m := jsonb_set(m, '{winner_suit}', to_jsonb(winner_suit), true);
      m := jsonb_set(m, '{first_claimed_finish_suit}', to_jsonb(winner_suit), true);
      update public.paardenrace_rooms set stage = 'nominations', updated_at = now() where id = v_room.id;
    end if;
  end if;

  m := jsonb_set(m, '{draw_index}', to_jsonb(draw_idx + 1), true);
  m := jsonb_set(m, '{last_draw_card}', to_jsonb(card), true);
  m := jsonb_set(m, '{revealed_draw_cards}', coalesce(m->'revealed_draw_cards','[]'::jsonb) || to_jsonb(card), true);
  m := jsonb_set(m, '{horse_positions}', positions, true);
  m := jsonb_set(m, '{revealed_gates}', revealed, true);
  m := jsonb_set(m, '{resolved_gates}', revealed, true);
  m := jsonb_set(m, '{gate_events}', gate_events, true);

  update public.paardenrace_rooms set active_match = m, updated_at = now() where id = v_room.id;
  return public._paardenrace_build_room_state(v_room.room_code, session_token, session_token_input);
end;
$$;

grant execute on function public.draw_paardenrace_card_safe(text,text,text) to anon, authenticated;
