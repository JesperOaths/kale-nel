-- GEJAST v792t — repair Paardenrace Bak -> drink_events handoff
--
-- Final live play-to-completion reached the repaired v792s race transition and exposed
-- the next production defect in the existing v695 obligation trigger helper. Its player
-- lookup dynamically referenced historical public.players columns (`name`, `email`) that
-- no longer exist, caught that error, set player_id NULL, and then attempted a drink_events
-- insert even though player_id is NOT NULL. It also relied on a BEFORE trigger to invent
-- client_event_id rather than using the stable source_ref already supplied by the
-- Paardenrace obligation trigger.
--
-- Preserve the existing v695 callable signature/defaults/grants. Resolve against current
-- player columns only, require an active event type, use source_ref as client_event_id for
-- idempotency, and insert the current required drink_events contract explicitly.
-- SQL-only repair; frontend VERSION remains v792.

BEGIN;

CREATE OR REPLACE FUNCTION public._gejast_create_bak_drink_request_v695(
  player_name_input text,
  amount_input numeric,
  source_kind_input text DEFAULT 'paardenrace'::text,
  source_ref_input text DEFAULT NULL::text,
  metadata_input jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_id bigint;
  v_player_id bigint;
  v_player_name text;
  v_site_scope text;
  v_event_type_id bigint;
  v_event_type_key text;
  v_event_type_label text;
  v_unit_value numeric;
  v_quantity integer := greatest(1, coalesce(amount_input, 1)::integer);
  v_client_event_id text;
  v_metadata jsonb;
BEGIN
  IF to_regclass('public.drink_events') IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT p.id,
         p.display_name,
         public._scope_norm(p.site_scope)
    INTO v_player_id, v_player_name, v_site_scope
  FROM public.players p
  WHERE lower(btrim(p.display_name)) = lower(btrim(coalesce(player_name_input,'')))
     OR lower(btrim(coalesce(p.profile_display_name,''))) = lower(btrim(coalesce(player_name_input,'')))
     OR lower(btrim(coalesce(p.chosen_username,''))) = lower(btrim(coalesce(player_name_input,'')))
  ORDER BY
    CASE WHEN lower(btrim(p.display_name)) = lower(btrim(coalesce(player_name_input,''))) THEN 0 ELSE 1 END,
    p.active DESC,
    p.id
  LIMIT 1;

  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'Speler voor Bak-verzoek niet gevonden.';
  END IF;

  SELECT det.id,
         det.key,
         det.label,
         det.unit_value
    INTO v_event_type_id, v_event_type_key, v_event_type_label, v_unit_value
  FROM public.drink_event_types det
  WHERE lower(det.key) IN ('bak','bakken','beer','bier')
    AND coalesce(det.is_active, true)
  ORDER BY CASE lower(det.key)
    WHEN 'bak' THEN 1
    WHEN 'bakken' THEN 2
    WHEN 'bier' THEN 3
    ELSE 4
  END,
  det.id
  LIMIT 1;

  IF v_event_type_id IS NULL THEN
    RAISE EXCEPTION 'Actief Bak/Bier drinktype ontbreekt.';
  END IF;

  v_client_event_id := coalesce(
    nullif(btrim(coalesce(source_ref_input,'')), ''),
    'paardenrace:' || gen_random_uuid()::text
  );

  v_metadata := coalesce(metadata_input, '{}'::jsonb)
    || jsonb_build_object(
      'source_kind', coalesce(nullif(btrim(coalesce(source_kind_input,'')), ''), 'paardenrace'),
      'source_ref', v_client_event_id
    );

  INSERT INTO public.drink_events(
    client_event_id,
    player_id,
    player_name,
    event_type_id,
    event_type_key,
    event_type_label,
    quantity,
    unit_value,
    total_units,
    status,
    site_scope,
    raw_payload,
    metadata,
    submitted_at
  ) VALUES (
    v_client_event_id,
    v_player_id,
    v_player_name,
    v_event_type_id,
    v_event_type_key,
    v_event_type_label,
    v_quantity,
    v_unit_value,
    round(v_unit_value * v_quantity, 2),
    'pending',
    v_site_scope,
    v_metadata,
    v_metadata,
    now()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    -- The historical helper contract treats an already-created source or an existing
    -- pending drink request for the same player as an idempotent no-op.
    RETURN NULL;
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
  WHERE p.oid = to_regprocedure('public._gejast_create_bak_drink_request_v695(text,numeric,text,text,jsonb)');

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'v792t Bak drink helper missing';
  END IF;

  IF v_args NOT LIKE 'player_name_input text, amount_input numeric, source_kind_input text DEFAULT ''paardenrace''::text, source_ref_input text DEFAULT NULL::text, metadata_input jsonb DEFAULT ''{}''::jsonb' THEN
    RAISE EXCEPTION 'v792t helper signature/defaults changed unexpectedly: %', v_args;
  END IF;

  IF position('p.display_name' IN v_src) = 0
     OR position('p.profile_display_name' IN v_src) = 0
     OR position('p.chosen_username' IN v_src) = 0
     OR position('v_player_id IS NULL' IN v_src) = 0 THEN
    RAISE EXCEPTION 'v792t current player resolution contract missing';
  END IF;

  IF position('client_event_id' IN v_src) = 0
     OR position('source_ref_input' IN v_src) = 0
     OR position('player_id' IN v_src) = 0
     OR position('event_type_id' IN v_src) = 0
     OR position('site_scope' IN v_src) = 0 THEN
    RAISE EXCEPTION 'v792t required drink_events insert contract incomplete';
  END IF;

  IF position('display_name,name,email' IN replace(v_src,' ','')) > 0
     OR position('execute ''select id from public.players' IN lower(v_src)) > 0 THEN
    RAISE EXCEPTION 'v792t historical broken dynamic player lookup remains';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = to_regprocedure('public._gejast_create_bak_drink_request_v695(text,numeric,text,text,jsonb)')
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'v792t SECURITY DEFINER contract changed unexpectedly';
  END IF;
END
$verify$;

COMMIT;
