-- GEJAST v636 Phase 4: boot/bundle/performance audit helpers
-- Safe to rerun after Phase 3 SQL.

begin;

insert into public.implementation_matrix_features (feature_key, phase, subsystem, title, status, owner_page, owner_js, owner_rpc, owner_sql, github_status, live_status, trust_level, priority, notes, next_action, needs_sql) values
  ('phase4.perf_guards', 4, 'system-health', 'Boot and performance guard helper', 'implemented_repo_pending_sql', 'admin_system_health.html', 'gejast-perf-guards.js', 'admin_get_boot_bundle_perf_audit', 'boot_bundle_perf_helpers.sql', 'implemented_in_v636', 'needs_deploy_and_sql', 'repo_verified', 'critical', 'Adds reusable single-flight, timeout, interval and page snapshot helpers for heavy pages and polling loops.', 'Use from future heavy page patches instead of ad-hoc polling.', true)
on conflict (feature_key) do update set phase=excluded.phase, subsystem=excluded.subsystem, title=excluded.title, status=excluded.status, owner_page=excluded.owner_page, owner_js=excluded.owner_js, owner_rpc=excluded.owner_rpc, owner_sql=excluded.owner_sql, github_status=excluded.github_status, live_status=excluded.live_status, trust_level=excluded.trust_level, priority=excluded.priority, notes=excluded.notes, next_action=excluded.next_action, needs_sql=excluded.needs_sql, updated_at=now();

create or replace function public.admin_get_boot_bundle_perf_audit(admin_session_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_session jsonb;
  v_function_rows jsonb;
  v_matrix jsonb;
begin
  v_session := public._implementation_matrix_admin_guard(admin_session_token);
  select coalesce(jsonb_agg(jsonb_build_object('function_name', req.fn, 'exists', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=req.fn)) order by req.fn), '[]'::jsonb)
  into v_function_rows from (values ('get_public_state'),('get_gejast_homepage_state'),('get_jas_app_state'),('player_touch_session'),('admin_check_session'),('admin_get_boot_bundle_perf_audit')) as req(fn);
  select coalesce(jsonb_agg(jsonb_build_object('feature_key', feature_key, 'owner_page', owner_page, 'owner_js', owner_js, 'status', status, 'priority', priority) order by feature_key), '[]'::jsonb)
  into v_matrix from public.implementation_matrix_features where phase = 4 or subsystem in ('system-health','implementation-matrix');
  return jsonb_build_object('ok', true, 'admin_session', v_session, 'function_presence', v_function_rows, 'phase4_matrix_rows', v_matrix, 'note', 'Client-side performance timings are collected by gejast-perf-guards.js in the browser. This RPC verifies backend dependency presence only.', 'generated_at', now());
end;
$fn$;

grant execute on function public.admin_get_boot_bundle_perf_audit(text) to anon, authenticated;
commit;
