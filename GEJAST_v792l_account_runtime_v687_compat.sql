-- GEJAST v792l — restore the v687 account-runtime compatibility surface
--
-- Final-certification reconciliation found that gejast-account-runtime.js calls
-- v687 account/admin RPC names while production still exposes the stable v671 /
-- v681 implementations for several of those operations. This migration adds
-- thin, fail-closed compatibility wrappers only; it does not replace account
-- business logic, relax admin-session checks, or create development bypasses.
--
-- Public browser account calls delegate to the current v671/v681 authorities.
-- Admin calls delegate to functions that already validate the admin session.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_requestable_names_v687(
  site_scope_input text DEFAULT 'friends'::text
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.get_requestable_names_v671(site_scope_input);
$$;

CREATE OR REPLACE FUNCTION public.account_request_claim_v687(
  desired_name_input text,
  requester_email_input text,
  requester_note_input text DEFAULT ''::text,
  site_scope_input text DEFAULT 'friends'::text,
  requester_meta_input jsonb DEFAULT '{}'::jsonb,
  active_player_meta_input jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.account_request_claim_v681(
    desired_name_input,
    requester_email_input,
    requester_note_input,
    site_scope_input,
    requester_meta_input,
    active_player_meta_input
  );
$$;

CREATE OR REPLACE FUNCTION public.account_get_activation_context_v687(
  activation_token_input text
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.account_get_activation_context_v671(activation_token_input);
$$;

CREATE OR REPLACE FUNCTION public.account_activate_v687(
  activation_token_input text,
  new_pin_input text,
  activation_meta_input jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.account_activate_v681(
    activation_token_input,
    new_pin_input,
    activation_meta_input
  );
$$;

CREATE OR REPLACE FUNCTION public.store_active_player_metadata_v687(
  player_name_input text DEFAULT NULL::text,
  site_scope_input text DEFAULT 'friends'::text,
  event_type_input text DEFAULT 'unknown'::text,
  event_source_input text DEFAULT 'unknown'::text,
  metadata_input jsonb DEFAULT '{}'::jsonb,
  browser_meta_input jsonb DEFAULT '{}'::jsonb,
  request_meta_input jsonb DEFAULT '{}'::jsonb,
  activation_meta_input jsonb DEFAULT '{}'::jsonb,
  session_token_input text DEFAULT NULL::text,
  activation_token_input text DEFAULT NULL::text,
  admin_session_token_input text DEFAULT NULL::text,
  admin_actor_input text DEFAULT NULL::text,
  claim_id_input uuid DEFAULT NULL::uuid,
  created_by_admin_input boolean DEFAULT false
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.store_active_player_metadata_v681(
    player_name_input,
    site_scope_input,
    event_type_input,
    event_source_input,
    metadata_input,
    browser_meta_input,
    request_meta_input,
    activation_meta_input,
    session_token_input,
    activation_token_input,
    admin_session_token_input,
    admin_actor_input,
    claim_id_input,
    created_by_admin_input
  );
$$;

CREATE OR REPLACE FUNCTION public.login_player_by_name_pin_v687(
  player_name_input text,
  pin_input text,
  login_meta_input jsonb DEFAULT '{}'::jsonb,
  site_scope_input text DEFAULT 'friends'::text
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.account_login_bridge_v687(
    NULL,
    NULL,
    player_name_input,
    pin_input,
    NULL,
    site_scope_input,
    login_meta_input
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_get_active_player_metadata_audit_v687(
  admin_session_token_input text,
  site_scope_input text DEFAULT 'friends'::text
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.admin_get_active_player_metadata_audit_v681(
    admin_session_token_input,
    site_scope_input
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_get_account_runtime_audit_v687(
  admin_session_token text,
  site_scope_input text DEFAULT 'friends'::text
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.admin_get_account_runtime_audit_v671(
    admin_session_token,
    site_scope_input
  );
$$;

CREATE OR REPLACE FUNCTION public.diagnose_login_name_v687(
  player_name_input text,
  site_scope_input text DEFAULT 'friends'::text
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.diagnose_login_name_v681(
    player_name_input,
    site_scope_input
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_reset_login_player_pin_v687(
  admin_session_token_input text,
  player_name_input text,
  new_pin_input text,
  site_scope_input text DEFAULT 'friends'::text,
  admin_meta_input jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.admin_reset_login_player_pin_v681(
    admin_session_token_input,
    player_name_input,
    new_pin_input,
    site_scope_input,
    admin_meta_input
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_add_requestable_name_v687(
  admin_session_token_input text,
  display_name_input text,
  site_scope_input text DEFAULT 'friends'::text
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.admin_add_requestable_name_v671(
    admin_session_token_input,
    display_name_input,
    site_scope_input
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_approve_account_claim_v687(
  admin_session_token_input text,
  claim_id_input uuid,
  site_scope_input text DEFAULT 'friends'::text,
  admin_meta_input jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.admin_approve_account_claim_v681(
    admin_session_token_input,
    claim_id_input,
    site_scope_input,
    admin_meta_input
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_reject_account_claim_v687(
  admin_session_token_input text,
  claim_id_input uuid,
  reject_reason_input text DEFAULT ''::text,
  site_scope_input text DEFAULT 'friends'::text
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.admin_reject_account_claim_v671(
    admin_session_token_input,
    claim_id_input,
    reject_reason_input,
    site_scope_input
  );
$$;

-- Browser-facing RPCs need PostgREST roles but not PUBLIC. Admin wrappers still
-- require a valid inner admin-session token in the delegated implementation.
REVOKE ALL ON FUNCTION public.get_requestable_names_v687(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.account_request_claim_v687(text,text,text,text,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.account_get_activation_context_v687(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.account_activate_v687(text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.store_active_player_metadata_v687(text,text,text,text,jsonb,jsonb,jsonb,jsonb,text,text,text,text,uuid,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.login_player_by_name_pin_v687(text,text,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_active_player_metadata_audit_v687(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_account_runtime_audit_v687(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.diagnose_login_name_v687(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reset_login_player_pin_v687(text,text,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_add_requestable_name_v687(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_approve_account_claim_v687(text,uuid,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reject_account_claim_v687(text,uuid,text,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_requestable_names_v687(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.account_request_claim_v687(text,text,text,text,jsonb,jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.account_get_activation_context_v687(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.account_activate_v687(text,text,jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.store_active_player_metadata_v687(text,text,text,text,jsonb,jsonb,jsonb,jsonb,text,text,text,text,uuid,boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.login_player_by_name_pin_v687(text,text,jsonb,text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_active_player_metadata_audit_v687(text,text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_account_runtime_audit_v687(text,text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.diagnose_login_name_v687(text,text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reset_login_player_pin_v687(text,text,text,text,jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_add_requestable_name_v687(text,text,text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_approve_account_claim_v687(text,uuid,text,jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reject_account_claim_v687(text,uuid,text,text) TO anon, authenticated, service_role;

DO $verify$
DECLARE
  expected_count integer := 13;
  actual_count integer;
BEGIN
  SELECT count(*) INTO actual_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname = ANY (ARRAY[
      'get_requestable_names_v687',
      'account_request_claim_v687',
      'account_get_activation_context_v687',
      'account_activate_v687',
      'store_active_player_metadata_v687',
      'login_player_by_name_pin_v687',
      'admin_get_active_player_metadata_audit_v687',
      'admin_get_account_runtime_audit_v687',
      'diagnose_login_name_v687',
      'admin_reset_login_player_pin_v687',
      'admin_add_requestable_name_v687',
      'admin_approve_account_claim_v687',
      'admin_reject_account_claim_v687'
    ]);
  IF actual_count <> expected_count THEN
    RAISE EXCEPTION 'v792l postcondition failed: expected % compatibility RPCs, found %', expected_count, actual_count;
  END IF;
END
$verify$;

COMMIT;
