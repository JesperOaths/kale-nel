-- GEJAST v635 Phase 3: bundle/page surface audit
-- Run after implementation_matrix_seed.sql.

begin;

create or replace function public.admin_audit_bundle_surfaces(admin_session_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_pages jsonb; v_js jsonb; v_summary jsonb;
begin
  perform public._implementation_matrix_admin_guard(admin_session_token);
  select coalesce(jsonb_agg(jsonb_build_object('feature_key', feature_key, 'phase', phase, 'subsystem', subsystem, 'owner_page', owner_page, 'status', status, 'github_status', github_status, 'live_status', live_status, 'trust_level', trust_level) order by phase, subsystem, feature_key), '[]'::jsonb)
    into v_pages from public.implementation_matrix_features where nullif(owner_page,'') is not null;
  select coalesce(jsonb_agg(jsonb_build_object('feature_key', feature_key, 'phase', phase, 'subsystem', subsystem, 'owner_js', owner_js, 'status', status, 'github_status', github_status, 'live_status', live_status, 'trust_level', trust_level) order by phase, subsystem, feature_key), '[]'::jsonb)
    into v_js from public.implementation_matrix_features where nullif(owner_js,'') is not null;
  select jsonb_build_object('total_features', count(*), 'features_with_page_owner', count(*) filter (where nullif(owner_page,'') is not null), 'features_with_js_owner', count(*) filter (where nullif(owner_js,'') is not null), 'features_needing_sql', count(*) filter (where needs_sql), 'critical_items', count(*) filter (where priority='critical')) into v_summary
  from public.implementation_matrix_features;
  return jsonb_build_object('ok', true, 'audit', 'bundle_surfaces', 'generated_at', now(), 'summary', v_summary, 'page_owners', v_pages, 'js_owners', v_js);
end;
$fn$;

grant execute on function public.admin_audit_bundle_surfaces(text) to anon, authenticated;

commit;
