-- GEJAST v792p — make the final browser-executable admin mutator directly guarded
--
-- The post-v792o catalog audit found zero unguarded no-token admin mutators and
-- one remaining conservative hit: admin_delete_despimarkt_market_v669. Its
-- existing first call, admin_refund_despimarkt_market_v669(), already validates
-- through _despimarkt_require_admin_v669 -> _require_valid_admin_session, so the
-- function was not exploitable. This migration makes that authorization local
-- and machine-auditable as defense in depth.

BEGIN;

DO $patch$
DECLARE
  v_oid oid := to_regprocedure('public.admin_delete_despimarkt_market_v669(text,uuid,text)');
  v_def text;
  v_new text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'v792p admin_delete_despimarkt_market_v669 missing';
  END IF;

  v_def := pg_get_functiondef(v_oid);
  IF position('_gejast_require_admin_session_v792m(' IN v_def) > 0 THEN
    RETURN;
  END IF;

  v_new := regexp_replace(
    v_def,
    E'\\nbegin\\r?\\n',
    E'\nbegin\n  PERFORM public._gejast_require_admin_session_v792m(admin_session_token_input);\n',
    'i'
  );

  IF v_new = v_def THEN
    RAISE EXCEPTION 'v792p could not inject direct admin guard';
  END IF;
  EXECUTE v_new;
END
$patch$;

DO $verify$
DECLARE
  v_src text;
BEGIN
  SELECT p.prosrc INTO v_src
  FROM pg_proc p
  WHERE p.oid=to_regprocedure('public.admin_delete_despimarkt_market_v669(text,uuid,text)');

  IF v_src NOT LIKE '%_gejast_require_admin_session_v792m(admin_session_token_input)%' THEN
    RAISE EXCEPTION 'v792p direct Despimarkt delete guard missing';
  END IF;

  IF public._gejast_admin_session_ok_v792m('v792p-invalid-admin-session') IS TRUE THEN
    RAISE EXCEPTION 'v792p canonical invalid-token guard failed open';
  END IF;
END
$verify$;

COMMIT;
