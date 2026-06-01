-- GEJAST v729 homepage runtime bundle overload fix
--
-- Purpose:
--   Supabase/PostgREST can return PGRST203 for get_homepage_runtime_bundle_v687
--   when both of these overloads exist:
--     - get_homepage_runtime_bundle_v687(site_scope_input text)
--     - get_homepage_runtime_bundle_v687(site_scope_input text, session_token text, session_token_input text)
--
--   The three-argument function already supports nullable session parameters and
--   can serve callers that only provide site_scope_input. Dropping the legacy
--   one-argument overload removes the ambiguity without changing the canonical
--   runtime contract.

drop function if exists public.get_homepage_runtime_bundle_v687(text);

grant execute on function public.get_homepage_runtime_bundle_v687(text,text,text) to anon, authenticated;
