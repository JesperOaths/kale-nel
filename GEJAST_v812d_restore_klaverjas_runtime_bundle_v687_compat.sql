-- GEJAST v812d — repository provenance for production migration
-- 20260818202647 restore_klaverjas_runtime_bundle_v687_compat
--
-- This SQL intentionally reproduces the exact deployed compatibility wrapper.
-- It is provenance/canonical-source only; the migration already exists in production.
-- Product VERSION remains v812.

create or replace function public.get_klaverjas_runtime_bundle_v687(
  site_scope_input text default 'friends'
)
returns jsonb
language sql
set search_path to 'public'
as $function$
  select public.get_klaverjas_runtime_bundle_v673(site_scope_input)
$function$;

revoke execute on function public.get_klaverjas_runtime_bundle_v687(text) from public;
grant execute on function public.get_klaverjas_runtime_bundle_v687(text) to anon, authenticated, service_role;
