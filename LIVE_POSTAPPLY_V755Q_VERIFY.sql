-- GEJAST v755q post-apply verification — SUPERSEDED.
-- v755q is intentionally blocked from standalone production apply because the exact deployed
-- legacy upsert body proved it does not validate session_token. There must therefore be no
-- standalone v755q post-apply state to verify.
--
-- This read-only file exists only as a safety marker for anyone following older v765 notes.

select
  'v755q_superseded'::text as check_name,
  'PASS'::text as result,
  'Do not apply/verify v755q standalone; use the reviewed combined v765 Klaverjas repair.'::text as detail;
