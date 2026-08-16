-- GEJAST v792k — remove production development/test bootstrap
--
-- Production-only hardening discovered during final certification.
-- Removes legacy public development/test RPCs and permanently disables the
-- persistent Beta1–Beta4 bootstrap identities without deleting their player
-- rows, so historical foreign-key references remain intact.
--
-- Safety properties:
--   * no CASCADE
--   * exact function signatures only
--   * player rows are retained as inert historical tombstones
--   * repeatable/idempotent for already-hardened production

BEGIN;

DROP FUNCTION IF EXISTS public.admin_dev_login(text, text, text);
DROP FUNCTION IF EXISTS public.dev_create_test_claim(text, text, text);
DROP FUNCTION IF EXISTS public.dev_create_test_claim_simple(text, text, text);
DROP FUNCTION IF EXISTS public.verify_beta_test_accounts_v744();

UPDATE public.players
SET
  active = false,
  approved = false,
  pin_hash = NULL,
  session_token = NULL,
  hidden_from_public = true,
  is_dummy = true,
  updated_at = now()
WHERE lower(trim(coalesce(display_name, ''))) IN ('beta1', 'beta2', 'beta3', 'beta4')
   OR lower(trim(coalesce(slug, ''))) IN ('beta1', 'beta2', 'beta3', 'beta4');

UPDATE public.allowed_usernames
SET
  status = 'blocked',
  is_active = false,
  activated = false,
  has_pin = false,
  pin_is_set = false,
  blocked_reason = 'Legacy production beta bootstrap disabled by GEJAST v792k',
  updated_at = now()
WHERE lower(trim(username)) IN ('beta1', 'beta2', 'beta3', 'beta4');

DO $verify$
DECLARE
  unsafe_function_count integer;
  unsafe_player_count integer;
  unsafe_username_count integer;
BEGIN
  SELECT count(*)
    INTO unsafe_function_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'admin_dev_login',
      'dev_create_test_claim',
      'dev_create_test_claim_simple',
      'verify_beta_test_accounts_v744'
    );

  IF unsafe_function_count <> 0 THEN
    RAISE EXCEPTION 'v792k postcondition failed: % legacy dev/test functions remain', unsafe_function_count;
  END IF;

  SELECT count(*)
    INTO unsafe_player_count
  FROM public.players
  WHERE (
      lower(trim(coalesce(display_name, ''))) IN ('beta1', 'beta2', 'beta3', 'beta4')
      OR lower(trim(coalesce(slug, ''))) IN ('beta1', 'beta2', 'beta3', 'beta4')
    )
    AND (
      active
      OR approved
      OR pin_hash IS NOT NULL
      OR session_token IS NOT NULL
      OR NOT hidden_from_public
      OR NOT is_dummy
    );

  IF unsafe_player_count <> 0 THEN
    RAISE EXCEPTION 'v792k postcondition failed: % legacy beta player rows remain login-capable/visible', unsafe_player_count;
  END IF;

  SELECT count(*)
    INTO unsafe_username_count
  FROM public.allowed_usernames
  WHERE lower(trim(username)) IN ('beta1', 'beta2', 'beta3', 'beta4')
    AND (
      lower(status) <> 'blocked'
      OR is_active
      OR activated
      OR has_pin
      OR pin_is_set
    );

  IF unsafe_username_count <> 0 THEN
    RAISE EXCEPTION 'v792k postcondition failed: % legacy beta username rows remain enabled', unsafe_username_count;
  END IF;
END
$verify$;

COMMIT;
