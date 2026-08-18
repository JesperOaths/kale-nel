-- GEJAST v812d — exact repository provenance for production migration
-- 20260818202647 restore_klaverjas_runtime_bundle_v687_compat
--
-- This file reproduces the DDL statements recorded for that already-applied
-- production migration. It is provenance/canonical-source only; do not reapply
-- it merely because this file exists. Product VERSION remains v812.

create or replace function public.get_klaverjas_runtime_bundle_v687(site_scope_input text default 'friends')
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select public.get_klaverjas_runtime_bundle_v673(site_scope_input)
$$;

revoke all on function public.get_klaverjas_runtime_bundle_v687(text) from public;
grant execute on function public.get_klaverjas_runtime_bundle_v687(text) to anon, authenticated;
