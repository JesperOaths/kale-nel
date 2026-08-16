-- GEJAST v792s — make Paardenrace browser/live overloads unambiguous
--
-- v792q correctly moved the browser-visible room-code-first overloads away from the
-- retired v667 pipeline, but it delegated to same-named lower-arity functions. Because
-- both overload families preserve historical default arguments, PostgreSQL can resolve
-- a three/four-argument self-call to more than one candidate and raises 42725.
--
-- Final live certification reproduced that failure twice at the exact browser tick call.
-- This migration therefore keeps every browser-visible signature/default/grant intact,
-- retains the v792q site-scope boundary, and inlines the current production room-pipeline
-- logic. No same-name delegation remains, so PostgREST can call the browser overloads
-- without triggering PostgreSQL overload ambiguity. SQL-only; frontend VERSION stays v792.

BEGIN;

CREATE OR REPLACE FUNCTION public.tick_paardenrace_room_safe(
  room_code_input text,
  session_token text DEFAULT NULL::text,
  session_token_input text DEFAULT NULL::text,
  site_scope_input text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_requested_scope text := public._scope_norm(site_scope_input);
  v_room public.paardenrace_rooms%rowtype;
  v_decks jsonb;
  v_match_ref uuid;
  v_player_count integer := 0;
BEGIN
  SELECT * INTO v_room
  FROM public.paardenrace_rooms
  WHERE public._gejast_v722_norm_code(room_code) = public._gejast_v722_norm_code(room_code_input)
    AND coalesce(stage,'lobby') NOT IN ('deleted','archived')
  ORDER BY updated_at DESC NULLS LAST, id DESC
  LIMIT 1
  FOR UPDATE;

  IF v_room.id IS NULL THEN
    RAISE EXCEPTION 'Room niet gevonden.';
  END IF;
  IF public._scope_norm(v_room.site_scope) <> v_requested_scope THEN
    RAISE EXCEPTION 'Deze kamer hoort bij een andere site-scope.';
  END IF;

  SELECT count(*)::integer INTO v_player_count
  FROM public.paardenrace_room_players
  WHERE room_id = v_room.id;

  IF v_player_count = 0 THEN
    UPDATE public.paardenrace_rooms
       SET stage = 'closed', updated_at = now()
     WHERE id = v_room.id
       AND coalesce(stage,'') NOT IN ('closed','finished');
    RAISE EXCEPTION 'Room heeft geen spelers meer.';
  END IF;

  IF v_room.stage = 'countdown'
     AND v_room.countdown_ends_at IS NOT NULL
     AND v_room.countdown_ends_at <= now() THEN
    v_decks := public._paardenrace_make_decks();
    v_match_ref := gen_random_uuid();

    UPDATE public.paardenrace_rooms
       SET stage = 'race',
           countdown_ends_at = NULL,
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
             'first_finish_suit', NULL,
             'first_claimed_finish_suit', NULL,
             'winner_suit', NULL,
             'last_draw_card', NULL
           ),
           updated_at = now(),
           finished_at = NULL
     WHERE id = v_room.id;

    INSERT INTO public.paardenrace_obligations(
      room_id, match_ref, player_id, player_name, amount_bakken, source_kind, metadata
    )
    SELECT v_room.id,
           v_match_ref,
           rp.player_id,
           rp.player_name,
           rp.wager_bakken,
           'wager',
           jsonb_build_object(
             'source_game','paardenrace',
             'source_kind','wager',
             'selected_suit',rp.selected_suit
           )
    FROM public.paardenrace_room_players rp
    WHERE rp.room_id = v_room.id
      AND coalesce(rp.wager_bakken,0) > 0;
  END IF;

  RETURN public._paardenrace_build_room_state(
    v_room.room_code,
    session_token,
    session_token_input
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.draw_paardenrace_card_safe(
  room_code_input text,
  session_token text DEFAULT NULL::text,
  session_token_input text DEFAULT NULL::text,
  site_scope_input text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_requested_scope text := public._scope_norm(site_scope_input);
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
BEGIN
  SELECT * INTO v_room
  FROM public.paardenrace_rooms
  WHERE room_code = upper(trim(coalesce(room_code_input,'')));

  IF v_room.id IS NULL THEN
    RAISE EXCEPTION 'Room niet gevonden.';
  END IF;
  IF public._scope_norm(v_room.site_scope) <> v_requested_scope THEN
    RAISE EXCEPTION 'Deze kamer hoort bij een andere site-scope.';
  END IF;
  IF lower(v_room.host_name) <> lower(v_name) THEN
    RAISE EXCEPTION 'Alleen de host mag trekken.';
  END IF;
  IF v_room.stage <> 'race' THEN
    RAISE EXCEPTION 'De race is niet actief.';
  END IF;

  m := v_room.active_match;
  draw_idx := coalesce((m->>'draw_index')::integer, 0);
  draw_deck := coalesce(m->'draw_deck', '[]'::jsonb);
  gate_cards := coalesce(m->'gate_cards', '[]'::jsonb);
  positions := coalesce(
    m->'horse_positions',
    jsonb_build_object('hearts',0,'diamonds',0,'clubs',0,'spades',0)
  );
  revealed := coalesce(m->'revealed_gates', '[]'::jsonb);
  gate_events := '[]'::jsonb;

  card := draw_deck->>draw_idx;
  IF card IS NULL THEN
    RAISE EXCEPTION 'De trekstapel is leeg.';
  END IF;

  suit := public._paardenrace_suit_from_card(card);
  positions := jsonb_set(
    positions,
    ARRAY[suit],
    to_jsonb(least(11, coalesce((positions->>suit)::integer,0) + 1)),
    true
  );

  IF coalesce(m->>'first_finish_suit','') = ''
     AND coalesce((positions->>suit)::integer,0) >= 11 THEN
    m := jsonb_set(m, '{first_finish_suit}', to_jsonb(suit), true);
  END IF;

  FOR gate_no IN 1..10 LOOP
    IF EXISTS(
      SELECT 1
      FROM jsonb_array_elements_text(revealed) v
      WHERE v.value::integer = gate_no
    ) THEN
      CONTINUE;
    END IF;

    all_ready_gate := coalesce((positions->>'hearts')::integer,0) >= gate_no
      AND coalesce((positions->>'diamonds')::integer,0) >= gate_no
      AND coalesce((positions->>'clubs')::integer,0) >= gate_no
      AND coalesce((positions->>'spades')::integer,0) >= gate_no;

    IF all_ready_gate THEN
      gate_card := gate_cards->>(gate_no - 1);
      gate_suit := public._paardenrace_suit_from_card(gate_card);
      positions := jsonb_set(
        positions,
        ARRAY[gate_suit],
        to_jsonb(greatest(0, coalesce((positions->>gate_suit)::integer,0) - 1)),
        true
      );
      revealed := revealed || to_jsonb(gate_no);
      gate_events := gate_events || jsonb_build_array(
        jsonb_build_object('gate_no', gate_no, 'card_code', gate_card, 'suit', gate_suit)
      );
    END IF;
  END LOOP;

  IF coalesce(m->>'winner_suit','') = '' THEN
    SELECT min(suit_key) INTO winner_suit
    FROM (VALUES ('hearts'),('diamonds'),('clubs'),('spades')) s(suit_key)
    WHERE coalesce((positions->>suit_key)::integer,0) >= 11
      AND EXISTS(
        SELECT 1
        FROM public.paardenrace_room_players rp
        WHERE rp.room_id = v_room.id
          AND lower(coalesce(rp.selected_suit,'')) = lower(suit_key)
      );

    IF winner_suit IS NOT NULL THEN
      m := jsonb_set(m, '{winner_suit}', to_jsonb(winner_suit), true);
      m := jsonb_set(m, '{first_claimed_finish_suit}', to_jsonb(winner_suit), true);
      UPDATE public.paardenrace_rooms
         SET stage = 'nominations', updated_at = now()
       WHERE id = v_room.id;
    END IF;
  END IF;

  m := jsonb_set(m, '{draw_index}', to_jsonb(draw_idx + 1), true);
  m := jsonb_set(m, '{last_draw_card}', to_jsonb(card), true);
  m := jsonb_set(
    m,
    '{revealed_draw_cards}',
    coalesce(m->'revealed_draw_cards','[]'::jsonb) || to_jsonb(card),
    true
  );
  m := jsonb_set(m, '{horse_positions}', positions, true);
  m := jsonb_set(m, '{revealed_gates}', revealed, true);
  m := jsonb_set(m, '{gate_events}', gate_events, true);

  UPDATE public.paardenrace_rooms
     SET active_match = m,
         updated_at = now()
   WHERE id = v_room.id;

  RETURN public._paardenrace_build_room_state(
    v_room.room_code,
    session_token,
    session_token_input
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_paardenrace_nominations_safe(
  room_code_input text,
  allocations_input jsonb,
  session_token text DEFAULT NULL::text,
  session_token_input text DEFAULT NULL::text,
  site_scope_input text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_requested_scope text := public._scope_norm(site_scope_input);
  v_name text := public._paardenrace_require_name(session_token, session_token_input);
  v_player_id bigint := public._paardenrace_player_id(session_token, session_token_input);
  v_room public.paardenrace_rooms%rowtype;
  m jsonb;
  v_budget integer;
  v_total integer := 0;
  row jsonb;
  tgt text;
  b integer;
  v_match_ref uuid;
BEGIN
  SELECT * INTO v_room
  FROM public.paardenrace_rooms
  WHERE room_code = upper(trim(coalesce(room_code_input,'')));

  IF v_room.id IS NULL THEN
    RAISE EXCEPTION 'Room niet gevonden.';
  END IF;
  IF public._scope_norm(v_room.site_scope) <> v_requested_scope THEN
    RAISE EXCEPTION 'Deze kamer hoort bij een andere site-scope.';
  END IF;
  IF v_room.stage <> 'nominations' THEN
    RAISE EXCEPTION 'Nominatiefase is niet actief.';
  END IF;

  m := coalesce(v_room.active_match, '{}'::jsonb);
  v_match_ref := nullif(coalesce(m->>'match_ref',''),'')::uuid;

  SELECT rp.wager_bakken * 2 INTO v_budget
  FROM public.paardenrace_room_players rp
  WHERE rp.room_id = v_room.id
    AND lower(rp.player_name) = lower(v_name)
    AND lower(coalesce(rp.selected_suit,'')) = lower(coalesce(m->>'winner_suit',''))
  LIMIT 1;

  IF v_budget IS NULL THEN
    RAISE EXCEPTION 'Alleen winnaars mogen nomineren.';
  END IF;
  IF coalesce((m->'winner_submitted'->>lower(v_name))::boolean, false) THEN
    RAISE EXCEPTION 'Jouw nominaties zijn al opgeslagen.';
  END IF;

  FOR row IN
    SELECT value FROM jsonb_array_elements(coalesce(allocations_input,'[]'::jsonb))
  LOOP
    tgt := trim(coalesce(row->>'target_player_name',''));
    b := coalesce((row->>'bakken')::integer, 0);
    IF b <= 0 THEN CONTINUE; END IF;
    IF lower(tgt) = lower(v_name) THEN
      RAISE EXCEPTION 'Je mag jezelf niet nomineren.';
    END IF;
    IF NOT EXISTS(
      SELECT 1
      FROM public.paardenrace_room_players rp
      WHERE rp.room_id = v_room.id
        AND lower(rp.player_name) = lower(tgt)
    ) THEN
      RAISE EXCEPTION 'Onbekende speler in nominaties: %', tgt;
    END IF;
    v_total := v_total + b;
  END LOOP;

  IF v_total <> v_budget THEN
    RAISE EXCEPTION 'Je moet exact % Bakken verdelen.', v_budget;
  END IF;

  FOR row IN
    SELECT value FROM jsonb_array_elements(coalesce(allocations_input,'[]'::jsonb))
  LOOP
    tgt := trim(coalesce(row->>'target_player_name',''));
    b := coalesce((row->>'bakken')::integer, 0);
    IF b <= 0 THEN CONTINUE; END IF;

    INSERT INTO public.paardenrace_obligations(
      room_id,
      match_ref,
      player_id,
      player_name,
      amount_bakken,
      source_kind,
      metadata
    )
    VALUES (
      v_room.id,
      v_match_ref,
      NULL,
      tgt,
      b,
      'winner_nomination',
      jsonb_build_object(
        'source_game','paardenrace',
        'source_kind','winner_nomination',
        'winner_player_id',v_player_id,
        'winner_player_name',v_name,
        'target_player_name',tgt
      )
    );
  END LOOP;

  m := jsonb_set(
    m,
    '{nominations}',
    coalesce(m->'nominations','[]'::jsonb) || allocations_input,
    true
  );
  m := jsonb_set(m, ARRAY['winner_submitted', lower(v_name)], 'true'::jsonb, true);

  UPDATE public.paardenrace_rooms
     SET active_match = m,
         updated_at = now()
   WHERE id = v_room.id;

  IF NOT EXISTS(
    SELECT 1
    FROM public.paardenrace_room_players rp
    WHERE rp.room_id = v_room.id
      AND lower(coalesce(rp.selected_suit,'')) = lower(coalesce(m->>'winner_suit',''))
      AND NOT coalesce((m->'winner_submitted'->>lower(rp.player_name))::boolean, false)
  ) THEN
    INSERT INTO public.paardenrace_match_history(
      room_id, room_code, match_ref, winner_suit, summary_payload, finished_at
    )
    VALUES (
      v_room.id,
      v_room.room_code,
      v_match_ref,
      m->>'winner_suit',
      public._paardenrace_result_summary(v_room.id, m),
      now()
    );

    UPDATE public.paardenrace_rooms
       SET stage = 'finished',
           active_match = m,
           finished_at = now(),
           updated_at = now()
     WHERE id = v_room.id;
  END IF;

  RETURN public._paardenrace_build_room_state(
    v_room.room_code,
    session_token,
    session_token_input
  );
END;
$function$;

DO $verify$
DECLARE
  v_tick text;
  v_draw text;
  v_nom text;
  v_tick_args text;
  v_draw_args text;
  v_nom_args text;
  v_retired text[] := ARRAY[
    '_pr_require_host_v667',
    '_pr_require_player_in_room_v667',
    'paardenrace_rooms_v667',
    'paardenrace_players_v667',
    'paardenrace_nominations_v667'
  ];
  v_marker text;
BEGIN
  SELECT p.prosrc, pg_get_function_arguments(p.oid)
    INTO v_tick, v_tick_args
  FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.tick_paardenrace_room_safe(text,text,text,text)');

  SELECT p.prosrc, pg_get_function_arguments(p.oid)
    INTO v_draw, v_draw_args
  FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.draw_paardenrace_card_safe(text,text,text,text)');

  SELECT p.prosrc, pg_get_function_arguments(p.oid)
    INTO v_nom, v_nom_args
  FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.submit_paardenrace_nominations_safe(text,jsonb,text,text,text)');

  IF v_tick_args NOT LIKE 'room_code_input text, session_token text DEFAULT NULL::text, session_token_input text DEFAULT NULL::text, site_scope_input text DEFAULT NULL::text' THEN
    RAISE EXCEPTION 'v792s tick browser signature/defaults changed unexpectedly: %', v_tick_args;
  END IF;
  IF v_draw_args NOT LIKE 'room_code_input text, session_token text DEFAULT NULL::text, session_token_input text DEFAULT NULL::text, site_scope_input text DEFAULT NULL::text' THEN
    RAISE EXCEPTION 'v792s draw browser signature/defaults changed unexpectedly: %', v_draw_args;
  END IF;
  IF v_nom_args NOT LIKE 'room_code_input text, allocations_input jsonb, session_token text DEFAULT NULL::text, session_token_input text DEFAULT NULL::text, site_scope_input text DEFAULT NULL::text' THEN
    RAISE EXCEPTION 'v792s nominations browser signature/defaults changed unexpectedly: %', v_nom_args;
  END IF;

  IF position('RETURN public.tick_paardenrace_room_safe(' IN coalesce(v_tick,'')) > 0
     OR position('RETURN public.draw_paardenrace_card_safe(' IN coalesce(v_draw,'')) > 0
     OR position('RETURN public.submit_paardenrace_nominations_safe(' IN coalesce(v_nom,'')) > 0 THEN
    RAISE EXCEPTION 'v792s same-name overload delegation remains and can be ambiguous';
  END IF;

  IF position('public._scope_norm(v_room.site_scope)' IN coalesce(v_tick,'')) = 0
     OR position('public._scope_norm(v_room.site_scope)' IN coalesce(v_draw,'')) = 0
     OR position('public._scope_norm(v_room.site_scope)' IN coalesce(v_nom,'')) = 0 THEN
    RAISE EXCEPTION 'v792s site-scope guard missing';
  END IF;

  IF position('public._paardenrace_make_decks()' IN coalesce(v_tick,'')) = 0
     OR position('public.paardenrace_obligations' IN coalesce(v_tick,'')) = 0
     OR position('public._paardenrace_build_room_state' IN coalesce(v_tick,'')) = 0 THEN
    RAISE EXCEPTION 'v792s current tick pipeline markers missing';
  END IF;

  IF position('public._paardenrace_require_name' IN coalesce(v_draw,'')) = 0
     OR position('public._paardenrace_suit_from_card' IN coalesce(v_draw,'')) = 0
     OR position('''{horse_positions}''' IN coalesce(v_draw,'')) = 0
     OR position('''{winner_suit}''' IN coalesce(v_draw,'')) = 0
     OR position('public._paardenrace_build_room_state' IN coalesce(v_draw,'')) = 0 THEN
    RAISE EXCEPTION 'v792s current draw pipeline markers missing';
  END IF;

  IF position('public._paardenrace_player_id' IN coalesce(v_nom,'')) = 0
     OR position('winner_submitted' IN coalesce(v_nom,'')) = 0
     OR position('public.paardenrace_match_history' IN coalesce(v_nom,'')) = 0
     OR position('public._paardenrace_result_summary' IN coalesce(v_nom,'')) = 0
     OR position('public._paardenrace_build_room_state' IN coalesce(v_nom,'')) = 0 THEN
    RAISE EXCEPTION 'v792s current nominations pipeline markers missing';
  END IF;

  FOREACH v_marker IN ARRAY v_retired LOOP
    IF position(v_marker IN coalesce(v_tick,'')) > 0
       OR position(v_marker IN coalesce(v_draw,'')) > 0
       OR position(v_marker IN coalesce(v_nom,'')) > 0 THEN
      RAISE EXCEPTION 'v792s retired Paardenrace marker remains: %', v_marker;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.tick_paardenrace_room_safe(text,text,text,text)')
      AND p.prosecdef
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.draw_paardenrace_card_safe(text,text,text,text)')
      AND p.prosecdef
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.submit_paardenrace_nominations_safe(text,jsonb,text,text,text)')
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'v792s SECURITY DEFINER contract changed unexpectedly';
  END IF;
END
$verify$;

COMMIT;
