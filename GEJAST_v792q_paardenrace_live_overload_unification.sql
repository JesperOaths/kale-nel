-- GEJAST v792q — unify Paardenrace browser/live RPC overloads onto the current room pipeline
--
-- Final-certification completion testing found that paarde​nrace_live.html calls the
-- browser RPC helper with site_scope_input. PostgREST therefore resolves the older
-- room_code-first overloads of tick/draw/nominations, whose bodies still target the
-- retired v667 tables. The current lobby/start pipeline uses public.paardenrace_rooms,
-- public.paardenrace_room_players and the newer three/four-argument implementations.
--
-- This migration keeps the public overload signatures stable for the browser, adds an
-- explicit scope check, and delegates each overload to the current implementation.
-- No frontend VERSION bump: SQL-only repair.

BEGIN;

CREATE OR REPLACE FUNCTION public.tick_paardenrace_room_safe(
  room_code_input text,
  session_token text,
  session_token_input text,
  site_scope_input text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_requested_scope text := public._scope_norm(site_scope_input);
  v_room_scope text;
BEGIN
  SELECT public._scope_norm(r.site_scope)
    INTO v_room_scope
  FROM public.paardenrace_rooms r
  WHERE upper(trim(coalesce(r.room_code,''))) = upper(trim(coalesce(room_code_input,'')))
    AND lower(coalesce(r.stage,'lobby')) NOT IN ('deleted','archived')
  ORDER BY r.updated_at DESC NULLS LAST, r.id DESC
  LIMIT 1;

  IF v_room_scope IS NULL THEN
    RAISE EXCEPTION 'Room niet gevonden.';
  END IF;
  IF v_room_scope <> v_requested_scope THEN
    RAISE EXCEPTION 'Deze kamer hoort bij een andere site-scope.';
  END IF;

  RETURN public.tick_paardenrace_room_safe(
    session_token,
    session_token_input,
    room_code_input
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.draw_paardenrace_card_safe(
  room_code_input text,
  session_token text,
  session_token_input text,
  site_scope_input text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_requested_scope text := public._scope_norm(site_scope_input);
  v_room_scope text;
BEGIN
  SELECT public._scope_norm(r.site_scope)
    INTO v_room_scope
  FROM public.paardenrace_rooms r
  WHERE upper(trim(coalesce(r.room_code,''))) = upper(trim(coalesce(room_code_input,'')))
    AND lower(coalesce(r.stage,'lobby')) NOT IN ('deleted','archived')
  ORDER BY r.updated_at DESC NULLS LAST, r.id DESC
  LIMIT 1;

  IF v_room_scope IS NULL THEN
    RAISE EXCEPTION 'Room niet gevonden.';
  END IF;
  IF v_room_scope <> v_requested_scope THEN
    RAISE EXCEPTION 'Deze kamer hoort bij een andere site-scope.';
  END IF;

  RETURN public.draw_paardenrace_card_safe(
    session_token,
    session_token_input,
    room_code_input
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_paardenrace_nominations_safe(
  room_code_input text,
  allocations_input jsonb,
  session_token text,
  session_token_input text,
  site_scope_input text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_requested_scope text := public._scope_norm(site_scope_input);
  v_room_scope text;
BEGIN
  SELECT public._scope_norm(r.site_scope)
    INTO v_room_scope
  FROM public.paardenrace_rooms r
  WHERE upper(trim(coalesce(r.room_code,''))) = upper(trim(coalesce(room_code_input,'')))
    AND lower(coalesce(r.stage,'lobby')) NOT IN ('deleted','archived')
  ORDER BY r.updated_at DESC NULLS LAST, r.id DESC
  LIMIT 1;

  IF v_room_scope IS NULL THEN
    RAISE EXCEPTION 'Room niet gevonden.';
  END IF;
  IF v_room_scope <> v_requested_scope THEN
    RAISE EXCEPTION 'Deze kamer hoort bij een andere site-scope.';
  END IF;

  RETURN public.submit_paardenrace_nominations_safe(
    session_token,
    session_token_input,
    room_code_input,
    allocations_input
  );
END;
$function$;

DO $verify$
DECLARE
  v_tick text;
  v_draw text;
  v_nom text;
  v_bad text[] := ARRAY[
    '_pr_require_host_v667',
    '_pr_require_player_in_room_v667',
    'paardenrace_rooms_v667',
    'paardenrace_players_v667',
    'paardenrace_nominations_v667'
  ];
  v_marker text;
BEGIN
  SELECT p.prosrc INTO v_tick
  FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.tick_paardenrace_room_safe(text,text,text,text)');

  SELECT p.prosrc INTO v_draw
  FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.draw_paardenrace_card_safe(text,text,text,text)');

  SELECT p.prosrc INTO v_nom
  FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.submit_paardenrace_nominations_safe(text,jsonb,text,text,text)');

  IF v_tick IS NULL OR position('RETURN public.tick_paardenrace_room_safe(' IN v_tick) = 0 THEN
    RAISE EXCEPTION 'v792q tick browser overload is not delegated to current implementation';
  END IF;
  IF v_draw IS NULL OR position('RETURN public.draw_paardenrace_card_safe(' IN v_draw) = 0 THEN
    RAISE EXCEPTION 'v792q draw browser overload is not delegated to current implementation';
  END IF;
  IF v_nom IS NULL OR position('RETURN public.submit_paardenrace_nominations_safe(' IN v_nom) = 0 THEN
    RAISE EXCEPTION 'v792q nominations browser overload is not delegated to current implementation';
  END IF;

  IF position('_scope_norm(site_scope_input)' IN v_tick) = 0
     OR position('_scope_norm(site_scope_input)' IN v_draw) = 0
     OR position('_scope_norm(site_scope_input)' IN v_nom) = 0 THEN
    RAISE EXCEPTION 'v792q scope guard missing from one or more browser overloads';
  END IF;

  FOREACH v_marker IN ARRAY v_bad LOOP
    IF position(v_marker IN coalesce(v_tick,'')) > 0
       OR position(v_marker IN coalesce(v_draw,'')) > 0
       OR position(v_marker IN coalesce(v_nom,'')) > 0 THEN
      RAISE EXCEPTION 'v792q retired Paardenrace implementation marker remains: %', v_marker;
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
    RAISE EXCEPTION 'v792q SECURITY DEFINER contract changed unexpectedly';
  END IF;
END
$verify$;

COMMIT;
