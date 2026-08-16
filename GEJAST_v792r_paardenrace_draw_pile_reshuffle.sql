-- GEJAST v792r — make the shipped Paardenrace draw-pile reshuffle real
--
-- Final-certification play-to-completion inspection found that the live page correctly
-- catches an exhausted draw pile, calls reshuffle_paardenrace_draw_pile_safe(), and then
-- retries the draw. Production's RPC was only a state-read no-op, so a race that needed
-- more than one pass through the non-gate cards could never finish.
--
-- Preserve the existing browser signature/defaults. The repair authenticates the host,
-- enforces site scope and race phase, shuffles the actually revealed draw cards back into
-- a fresh draw_deck, resets draw_index/revealed_draw_cards, increments reshuffle_count,
-- and leaves horse/gate/winner state untouched.

BEGIN;

CREATE OR REPLACE FUNCTION public.reshuffle_paardenrace_draw_pile_safe(
  session_token text DEFAULT NULL::text,
  session_token_input text DEFAULT NULL::text,
  room_code_input text DEFAULT NULL::text,
  site_scope_input text DEFAULT 'friends'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_name text := public._paardenrace_require_name(session_token, session_token_input);
  v_scope text := public._scope_norm(site_scope_input);
  v_room public.paardenrace_rooms%rowtype;
  v_match jsonb;
  v_discard jsonb;
  v_new_deck jsonb;
  v_reshuffle_count integer;
BEGIN
  SELECT * INTO v_room
  FROM public.paardenrace_rooms
  WHERE upper(trim(coalesce(room_code,''))) = upper(trim(coalesce(room_code_input,'')))
    AND lower(coalesce(stage,'lobby')) NOT IN ('closed','deleted','archived')
  ORDER BY updated_at DESC NULLS LAST, id DESC
  LIMIT 1
  FOR UPDATE;

  IF v_room.id IS NULL THEN
    RAISE EXCEPTION 'Room niet gevonden.';
  END IF;
  IF public._scope_norm(v_room.site_scope) <> v_scope THEN
    RAISE EXCEPTION 'Deze kamer hoort bij een andere site-scope.';
  END IF;
  IF lower(coalesce(v_room.host_name,'')) <> lower(coalesce(v_name,'')) THEN
    RAISE EXCEPTION 'Alleen de host mag opnieuw schudden.';
  END IF;
  IF lower(coalesce(v_room.stage,'')) <> 'race' THEN
    RAISE EXCEPTION 'Opnieuw schudden kan alleen tijdens de race.';
  END IF;

  v_match := coalesce(v_room.active_match, '{}'::jsonb);
  v_discard := coalesce(v_match->'revealed_draw_cards', '[]'::jsonb);

  IF jsonb_typeof(v_discard) <> 'array' OR jsonb_array_length(v_discard) = 0 THEN
    RAISE EXCEPTION 'Er zijn geen getrokken kaarten om opnieuw te schudden.';
  END IF;

  SELECT coalesce(jsonb_agg(card ORDER BY random()), '[]'::jsonb)
    INTO v_new_deck
  FROM jsonb_array_elements_text(v_discard) AS drawn(card);

  IF jsonb_array_length(v_new_deck) = 0 THEN
    RAISE EXCEPTION 'Nieuwe trekstapel kon niet worden opgebouwd.';
  END IF;

  v_reshuffle_count := greatest(0, coalesce(nullif(v_match->>'reshuffle_count','')::integer, 0)) + 1;
  v_match := jsonb_set(v_match, '{draw_deck}', v_new_deck, true);
  v_match := jsonb_set(v_match, '{draw_index}', '0'::jsonb, true);
  v_match := jsonb_set(v_match, '{revealed_draw_cards}', '[]'::jsonb, true);
  v_match := jsonb_set(v_match, '{reshuffle_count}', to_jsonb(v_reshuffle_count), true);

  UPDATE public.paardenrace_rooms
     SET active_match = v_match,
         updated_at = now()
   WHERE id = v_room.id;

  RETURN public._paardenrace_build_room_state(v_room.room_code, session_token, session_token_input);
END;
$function$;

DO $verify$
DECLARE
  v_src text;
  v_args text;
BEGIN
  SELECT p.prosrc, pg_get_function_arguments(p.oid)
    INTO v_src, v_args
  FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.reshuffle_paardenrace_draw_pile_safe(text,text,text,text)');

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'v792r reshuffle RPC missing';
  END IF;
  IF v_args NOT LIKE '%session_token text DEFAULT NULL::text%session_token_input text DEFAULT NULL::text%room_code_input text DEFAULT NULL::text%site_scope_input text DEFAULT ''friends''::text%' THEN
    RAISE EXCEPTION 'v792r reshuffle browser defaults changed unexpectedly';
  END IF;
  IF position('_paardenrace_require_name' IN v_src) = 0
     OR position('_scope_norm' IN v_src) = 0
     OR position('host_name' IN v_src) = 0 THEN
    RAISE EXCEPTION 'v792r reshuffle authorization/scope guard missing';
  END IF;
  IF position('jsonb_array_elements_text(v_discard)' IN v_src) = 0
     OR position('random()' IN v_src) = 0
     OR position('''{draw_deck}''' IN v_src) = 0
     OR position('''{draw_index}''' IN v_src) = 0
     OR position('''{revealed_draw_cards}''' IN v_src) = 0
     OR position('''{reshuffle_count}''' IN v_src) = 0 THEN
    RAISE EXCEPTION 'v792r reshuffle mutation contract incomplete';
  END IF;
  IF position('return public.get_paardenrace_room_state_safe' IN lower(v_src)) > 0 THEN
    RAISE EXCEPTION 'v792r reshuffle is still the historical no-op';
  END IF;
END
$verify$;

COMMIT;
