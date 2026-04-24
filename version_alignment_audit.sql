-- GEJAST v636 Phase 4: version alignment audit + matrix rows
-- Safe to rerun after Phase 3 SQL.

begin;

insert into public.implementation_matrix_features (
  feature_key, phase, subsystem, title, status, owner_page, owner_js, owner_rpc, owner_sql,
  github_status, live_status, trust_level, priority, notes, next_action, needs_sql
) values
  ('phase4.version_source', 4, 'system-health', 'Canonical version source and script drift report', 'implemented_repo_pending_sql', 'admin_system_health.html', 'gejast-version-source.js', 'admin_get_version_alignment_audit', 'version_alignment_audit.sql', 'implemented_in_v636', 'needs_deploy_and_sql', 'repo_verified', 'critical', 'Adds a browser-side version source/report and SQL-side runtime audit surface without moving ownership out of gejast-config.js.', 'Upload v636 and open admin_system_health.html after SQL.', true),
  ('phase4.script_version_normalizer', 4, 'system-health', 'Script/cache-bust version drift detector', 'implemented_repo_pending_deploy', 'admin_system_health.html', 'gejast-script-version-normalizer.js', null, 'version_alignment_audit.sql', 'implemented_in_v636', 'needs_deploy', 'repo_verified', 'high', 'Scans local script/CSS refs in the live page and reports version drift; it does not mutate URLs by default.', 'Use System Health page after deploy.', false)
on conflict (feature_key) do update set
  phase=excluded.phase, subsystem=excluded.subsystem, title=excluded.title, status=excluded.status,
  owner_page=excluded.owner_page, owner_js=excluded.owner_js, owner_rpc=excluded.owner_rpc, owner_sql=excluded.owner_sql,
  github_status=excluded.github_status, live_status=excluded.live_status, trust_level=excluded.trust_level,
  priority=excluded.priority, notes=excluded.notes, next_action=excluded.next_action, needs_sql=excluded.needs_sql,
  updated_at=now();

create or replace function public.admin_get_version_alignment_audit(admin_session_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_session jsonb;
  v_expected text := 'v636';
  v_rows jsonb;
  v_required jsonb;
begin
  v_session := public._implementation_matrix_admin_guard(admin_session_token);
  select coalesce(jsonb_agg(jsonb_build_object('feature_key', f.feature_key, 'status', f.status, 'github_status', f.github_status, 'live_status', f.live_status, 'owner_page', f.owner_page, 'owner_js', f.owner_js, 'owner_rpc', f.owner_rpc, 'owner_sql', f.owner_sql, 'updated_at', f.updated_at) order by f.feature_key), '[]'::jsonb)
  into v_rows from public.implementation_matrix_features f where f.phase in (3,4) or f.feature_key = 'critical.make_webhook_safety';
  select coalesce(jsonb_agg(jsonb_build_object('function_name', req.fn, 'exists', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=req.fn)) order by req.fn), '[]'::jsonb)
  into v_required
  from (values ('admin_get_implementation_matrix'),('admin_audit_rpc_ownership'),('admin_audit_bundle_surfaces'),('admin_audit_game_surfaces'),('admin_get_version_alignment_audit'),('admin_get_boot_bundle_perf_audit'),('admin_audit_gate_coverage')) as req(fn);
  return jsonb_build_object('ok', true, 'expected_version', v_expected, 'admin_session', v_session, 'phase_rows', v_rows, 'required_functions', v_required, 'note', 'SQL can verify DB/RPC presence only. Browser script/watermark drift is verified by gejast-version-source.js and gejast-script-version-normalizer.js.', 'generated_at', now());
end;
$fn$;

grant execute on function public.admin_get_version_alignment_audit(text) to anon, authenticated;
commit;
