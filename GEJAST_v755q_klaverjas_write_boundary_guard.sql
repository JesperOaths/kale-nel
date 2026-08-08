-- GEJAST v755q — SUPERSEDED / DO NOT APPLY STANDALONE
--
-- The production definition capture on 2026-08-08 proved that
-- public.klaverjas_upsert_match_state_scoped(...) accepts session_token but never validates or
-- otherwise uses it before mutating legacy Klaverjas tables. Therefore an ACL-only repair that
-- leaves anon/authenticated EXECUTE on that SECURITY DEFINER RPC would NOT close the write boundary.
--
-- This file intentionally aborts. The replacement v765 repair must atomically:
--   1. install/repair a session-validated current save contract;
--   2. close or harden the unsafe legacy upsert RPC;
--   3. revoke direct web-role table DML;
--   4. preserve required read access and existing gameplay/scoring semantics;
--   5. add idempotent text client-match ownership before any finished production proof.
--
-- Kept in the branch as evidence of the initially identified ACL issue and why it was superseded.

do $$
begin
  raise exception 'GEJAST_v755q is superseded: do not apply standalone; use the reviewed combined v765 Klaverjas repair';
end $$;
