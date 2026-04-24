-- GEJAST v636 Phase 4: gate coverage audit helper
-- Safe to rerun after Phase 3 SQL.

begin;

insert into public.implementation_matrix_features (feature_key, phase, subsystem, title, status, owner_page, owner_js, owner_rpc, owner_sql, github_status, live_status, trust_level, priority, notes, next_action, needs_sql) values
  ('phase4.gate_bootstrap', 4, 'system-health', 'Gate bootstrap helper and gate coverage audit', 'implemented_repo_pending_sql', 'admin_system_health.html', 'gejast-gate-bootstrap.js', 'admin_audit_gate_coverage', 'gate_coverage_audit.sql', 'implemented_in_v636', 'needs_deploy_and_sql', 'repo_verified', 'critical', 'Adds non-invasive gate bootstrap helper and SQL-side expected coverage audit. Existing gejast-home-gate.js remains the active owner on protected pages.', 'Use the audit before globally adding/removing gate scripts.', true)
on conflict (feature_key) do update set phase=excluded.phase, subsystem=excluded.subsystem, title=excluded.title, status=excluded.status, owner_page=excluded.owner_page, owner_js=excluded.owner_js, owner_rpc=excluded.owner_rpc, owner_sql=excluded.owner_sql, github_status=excluded.github_status, live_status=excluded.live_status, trust_level=excluded.trust_level, priority=excluded.priority, notes=excluded.notes, next_action=excluded.next_action, needs_sql=excluded.needs_sql, updated_at=now();

create or replace function public.admin_audit_gate_coverage(admin_session_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_session jsonb;
  v_expected jsonb;
  v_phase_rows jsonb;
begin
  v_session := public._implementation_matrix_admin_guard(admin_session_token);
  select jsonb_agg(jsonb_build_object('page', page, 'expected_gate', expected_gate, 'reason', reason, 'active_owner', active_owner, 'phase4_owner', phase4_owner) order by page)
  into v_expected
  from (values
    ('home.html', false, 'public entry portal', 'home.html inline session redirect', 'gejast-gate-bootstrap.js optional'),
    ('login.html', false, 'public login', 'login.html inline login flow', 'gejast-gate-bootstrap.js optional'),
    ('request.html', false, 'public account request', 'request.html scoped request flow', 'gejast-gate-bootstrap.js optional'),
    ('activate.html', false, 'public activation link', 'activate.html activation flow', 'gejast-gate-bootstrap.js optional'),
    ('index.html', true, 'protected homepage', 'gejast-home-gate.js', 'gejast-gate-bootstrap.js helper only'),
    ('drinks.html', true, 'protected drinks surface', 'gejast-home-gate.js or page gate', 'gejast-gate-bootstrap.js helper only'),
    ('drinks_add.html', true, 'protected drinks write surface', 'gejast-home-gate.js or page gate', 'gejast-gate-bootstrap.js helper only'),
    ('paardenrace.html', true, 'protected game lobby', 'gejast-home-gate.js', 'gejast-gate-bootstrap.js helper only'),
    ('pikken.html', true, 'protected game lobby', 'gejast-home-gate.js or page gate', 'gejast-gate-bootstrap.js helper only'),
    ('admin.html', false, 'admin has separate admin session model', 'admin-session-sync.js/admin_check_session', 'not player gate')
  ) as t(page, expected_gate, reason, active_owner, phase4_owner);
  select coalesce(jsonb_agg(jsonb_build_object('feature_key', feature_key, 'owner_page', owner_page, 'owner_js', owner_js, 'status', status) order by feature_key), '[]'::jsonb)
  into v_phase_rows from public.implementation_matrix_features where phase in (3,4) or subsystem in ('identity-profiles','drinks','pikken','paardenrace');
  return jsonb_build_object('ok', true, 'admin_session', v_session, 'expected_coverage', coalesce(v_expected, '[]'::jsonb), 'matrix_context', v_phase_rows, 'note', 'This RPC defines expected gate ownership. Browser/live proof still comes from page source and admin_system_health.html client scans.', 'generated_at', now());
end;
$fn$;

grant execute on function public.admin_audit_gate_coverage(text) to anon, authenticated;
commit;
