-- GEJAST v792n — make v687 account activation immediately usable by the shipped login/runtime
--
-- v792 final acceptance proved the v671 account tables and the v746 canonical
-- player-session tables had become two separate identity planes. The shipped
-- gejast-account-runtime stores the token returned by account_activate_v687,
-- while account_public_state_v687 and all games resolve gejast_player_sessions_v746.
-- Also, account_login_bridge_v687 validates public.players.pin_hash rather than
-- gejast_account_players_v671.pin_hash. A newly activated self-claim therefore
-- could activate successfully yet fail its immediate public state and next login.
--
-- This migration changes only the v687 activation compatibility endpoint. It
-- preserves v671/v681 account bookkeeping, then synchronizes the approved
-- identity into public.players and reuses the newly-issued account token as a
-- canonical v746 player session. Existing active gameplay/session contracts are
-- not changed.

BEGIN;

CREATE OR REPLACE FUNCTION public.account_activate_v687(
  activation_token_input text,
  new_pin_input text,
  activation_meta_input jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
  v_name text;
  v_scope text;
  v_email text;
  v_session_token text;
  v_player public.players%rowtype;
  v_slug text;
  v_hash text;
BEGIN
  IF coalesce(new_pin_input, '') !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'pin_must_be_4_digits';
  END IF;

  -- The authoritative account lifecycle still owns claim validation, expiry,
  -- account-player creation, claim state and account-session creation.
  v_result := public.account_activate_v681(
    activation_token_input,
    new_pin_input,
    coalesce(activation_meta_input, '{}'::jsonb) || jsonb_build_object('player_bridge_version', 'v792n')
  );

  v_name := nullif(btrim(coalesce(v_result->>'display_name', v_result->>'player_name', '')), '');
  v_scope := CASE WHEN lower(coalesce(v_result->>'site_scope', 'friends')) = 'family' THEN 'family' ELSE 'friends' END;
  v_session_token := nullif(btrim(coalesce(v_result->>'session_token', '')), '');

  IF v_name IS NULL OR v_session_token IS NULL THEN
    RAISE EXCEPTION 'account_activation_bridge_missing_identity';
  END IF;

  SELECT ap.email
    INTO v_email
    FROM public.gejast_account_players_v671 ap
   WHERE lower(ap.display_name) = lower(v_name)
     AND lower(coalesce(ap.site_scope, 'friends')) = v_scope
   ORDER BY ap.updated_at DESC, ap.created_at DESC
   LIMIT 1;

  IF to_regprocedure('extensions.crypt(text,text)') IS NULL
     OR to_regprocedure('extensions.gen_salt(text)') IS NULL THEN
    RAISE EXCEPTION 'bcrypt_runtime_missing';
  END IF;
  v_hash := extensions.crypt(new_pin_input, extensions.gen_salt('bf'));

  SELECT p.*
    INTO v_player
    FROM public.players p
   WHERE lower(p.display_name) = lower(v_name)
   ORDER BY p.id
   LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    UPDATE public.players
       SET display_name = v_name,
           pin_hash = v_hash,
           active = true,
           approved = true,
           approved_email = coalesce(v_email, approved_email),
           site_scope = v_scope,
           hidden_from_public = false,
           is_dummy = false,
           session_token = v_session_token,
           last_login_at = now(),
           updated_at = now()
     WHERE id = v_player.id
     RETURNING * INTO v_player;
  ELSE
    v_slug := lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'));
    v_slug := trim(both '-' from v_slug);
    IF v_slug = '' THEN
      v_slug := 'player-' || substr(md5(v_name), 1, 10);
    END IF;
    IF EXISTS (SELECT 1 FROM public.players p WHERE p.slug = v_slug) THEN
      v_slug := v_slug || '-' || substr(md5(v_name || clock_timestamp()::text), 1, 8);
    END IF;

    INSERT INTO public.players(
      slug, display_name, active, pin_hash, approved, approved_email,
      hidden_from_public, is_dummy, site_scope, session_token, last_login_at
    ) VALUES (
      v_slug, v_name, true, v_hash, true, v_email,
      false, false, v_scope, v_session_token, now()
    )
    RETURNING * INTO v_player;
  END IF;

  INSERT INTO public.gejast_player_sessions_v746(
    session_token, player_id, display_name, site_scope, expires_at
  ) VALUES (
    v_session_token, v_player.id, v_player.display_name, v_scope, now() + interval '30 days'
  )
  ON CONFLICT (session_token) DO UPDATE
    SET player_id = excluded.player_id,
        display_name = excluded.display_name,
        site_scope = excluded.site_scope,
        last_seen_at = now(),
        expires_at = greatest(public.gejast_player_sessions_v746.expires_at, excluded.expires_at);

  RETURN coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'ok', true,
    'bridge', 'v792n_account_to_player',
    'player_id', v_player.id,
    'display_name', v_player.display_name,
    'player_name', v_player.display_name,
    'site_scope', v_scope,
    'session_token', v_session_token
  );
END;
$$;

REVOKE ALL ON FUNCTION public.account_activate_v687(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.account_activate_v687(text,text,jsonb) TO anon, authenticated, service_role;

DO $verify$
DECLARE
  v_src text;
BEGIN
  SELECT p.prosrc INTO v_src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.proname='account_activate_v687'
     AND pg_get_function_identity_arguments(p.oid)='activation_token_input text, new_pin_input text, activation_meta_input jsonb';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'v792n account_activate_v687 missing';
  END IF;
  IF v_src NOT LIKE '%gejast_player_sessions_v746%'
     OR v_src NOT LIKE '%public.players%'
     OR v_src NOT LIKE '%_v792n%' THEN
    RAISE EXCEPTION 'v792n activation bridge postcondition failed';
  END IF;
END
$verify$;

COMMIT;
