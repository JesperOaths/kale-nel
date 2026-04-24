-- GEJAST v635 Phase 3: RPC ownership audit
-- Run after implementation_matrix_seed.sql.

begin;

create or replace function public.admin_audit_rpc_ownership(admin_session_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_rows jsonb; v_expected jsonb;
begin
  perform public._implementation_matrix_admin_guard(admin_session_token);

  select coalesce(jsonb_agg(jsonb_build_object(
    'function_name', p.proname,
    'schema', n.nspname,
    'args', pg_get_function_identity_arguments(p.oid),
    'returns', pg_get_function_result(p.oid),
    'subsystem', case
      when p.proname ilike '%pikken%' then 'pikken'
      when p.proname ilike '%paardenrace%' then 'paardenrace'
      when p.proname ilike '%beerpong%' then 'beerpong'
      when p.proname ilike '%boerenbridge%' then 'boerenbridge'
      when p.proname ilike '%klaver%' or p.proname ilike '%jas%' then 'klaverjassen'
      when p.proname ilike '%drink%' then 'drinks'
      when p.proname ilike '%push%' or p.proname ilike '%web_push%' then 'push'
      when p.proname ilike '%despimarkt%' or p.proname ilike '%beurs%' then 'despimarkt'
      when p.proname ilike 'admin_%' then 'admin'
      else 'other'
    end
  ) order by p.proname), '[]'::jsonb)
  into v_rows
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (
      p.proname ilike 'admin_%'
      or p.proname ilike '%pikken%'
      or p.proname ilike '%paardenrace%'
      or p.proname ilike '%beerpong%'
      or p.proname ilike '%boerenbridge%'
      or p.proname ilike '%klaver%'
      or p.proname ilike '%drink%'
      or p.proname ilike '%push%'
      or p.proname ilike '%despimarkt%'
      or p.proname ilike '%beurs%'
      or p.proname in (select owner_rpc from public.implementation_matrix_features where owner_rpc is not null)
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'feature_key', f.feature_key,
    'owner_rpc', f.owner_rpc,
    'is_present', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=f.owner_rpc),
    'phase', f.phase,
    'subsystem', f.subsystem
  ) order by f.phase, f.feature_key), '[]'::jsonb)
  into v_expected
  from public.implementation_matrix_features f
  where nullif(f.owner_rpc,'') is not null and f.owner_rpc not in ('not_yet_canonical','profile_bundle_readers');

  return jsonb_build_object('ok', true, 'audit', 'rpc_ownership', 'generated_at', now(), 'functions', v_rows, 'expected_rpcs', v_expected);
end;
$fn$;

grant execute on function public.admin_audit_rpc_ownership(text) to anon, authenticated;

commit;
