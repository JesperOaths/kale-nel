-- GEJAST v635 Phase 3: canonical implementation matrix seed
-- Safe to rerun. Run this first.

begin;

create table if not exists public.implementation_matrix_features (
  feature_key text primary key,
  phase integer not null default 0,
  subsystem text not null,
  title text not null,
  status text not null default 'unknown',
  owner_page text,
  owner_js text,
  owner_rpc text,
  owner_sql text,
  github_status text not null default 'unknown',
  live_status text not null default 'unknown',
  trust_level text not null default 'unknown',
  priority text not null default 'normal',
  notes text,
  next_action text,
  needs_sql boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.implementation_matrix_evidence (
  id bigserial primary key,
  feature_key text references public.implementation_matrix_features(feature_key) on delete cascade,
  evidence_type text not null,
  source_path text,
  symbol_name text,
  status text not null default 'observed',
  detail text,
  detected_at timestamptz not null default now()
);

create index if not exists idx_implementation_matrix_features_phase on public.implementation_matrix_features(phase, subsystem, priority);
create index if not exists idx_implementation_matrix_features_status on public.implementation_matrix_features(status, live_status, github_status);
create index if not exists idx_implementation_matrix_evidence_feature on public.implementation_matrix_evidence(feature_key, detected_at desc);

insert into public.implementation_matrix_features (
  feature_key, phase, subsystem, title, status, owner_page, owner_js, owner_rpc, owner_sql,
  github_status, live_status, trust_level, priority, notes, next_action, needs_sql
) values
  ('critical.make_webhook_safety', 0, 'email-make', 'Make webhook safety and browser exposure removal', 'implemented_v638_pending_runtime_verify', 'admin_mail_audit.html', 'gejast-mail-queue-safety.js + claim_email_jobs_http', 'claim_email_jobs_http/admin_validate_outbound_email_job_v638', 'make_webhook_safety.sql', 'browser_webhook_still_exposed', 'unknown', 'repo_gap_identified', 'critical', 'Known critical architecture item: backend must validate email jobs before Make and browser must not own Make webhook invocation.', 'Backend-validate email jobs before Make; do not let browser own Make webhook invocation.', true),
  ('phase3.implementation_matrix.foundation', 3, 'implementation-matrix', 'Canonical implementation matrix foundation', 'implemented_repo_pending_sql', 'admin_implementation_matrix.html', 'gejast-implementation-matrix.js', 'admin_get_implementation_matrix', 'implementation_matrix_seed.sql', 'implemented_in_v634', 'needs_deploy_and_sql', 'repo_verified', 'critical', 'Creates the system-of-record for feature implementation status so future phases can be tracked without guessing.', 'Upload v634, run SQL, open admin_implementation_matrix.html.', true),
  ('phase3.rpc_ownership_audit', 3, 'implementation-matrix', 'RPC ownership audit', 'implemented_repo_pending_sql', 'admin_implementation_matrix.html', 'gejast-implementation-matrix.js', 'admin_audit_rpc_ownership', 'rpc_ownership_audit.sql', 'implemented_in_v634', 'needs_deploy_and_sql', 'repo_verified', 'critical', 'Inspects live pg_proc for expected RPC/function names and groups them by subsystem.', 'Run rpc_ownership_audit.sql after the seed migration.', true),
  ('phase3.bundle_surface_audit', 3, 'implementation-matrix', 'Bundle/page surface audit', 'implemented_repo_pending_sql', 'admin_implementation_matrix.html', 'gejast-owner-trace-helper.js', 'admin_audit_bundle_surfaces', 'bundle_surface_audit.sql', 'implemented_in_v634', 'needs_deploy_and_sql', 'repo_verified', 'high', 'Compares expected page/helper ownership from the matrix with client-side loaded scripts and SQL-backed matrix rows.', 'Run bundle_surface_audit.sql and use the page Trace button.', true),
  ('phase3.game_surface_audit', 3, 'implementation-matrix', 'Game surface audit', 'implemented_repo_pending_sql', 'admin_implementation_matrix.html', 'gejast-implementation-matrix.js', 'admin_audit_game_surfaces', 'game_surface_audit.sql', 'implemented_in_v634', 'needs_deploy_and_sql', 'repo_verified', 'high', 'Groups game-specific pages, helpers, RPCs and SQL ownership.', 'Use before phases 7-13 so new work attaches to the right owner.', true),
  ('phase4.system_health_version_gate_boot_perf', 4, 'system-health', 'System health, versioning, gate, boot and performance hardening', 'implemented_repo_pending_sql', 'admin_system_health.html', 'gejast-version-source.js', 'admin_get_version_alignment_audit', 'version_alignment_audit.sql', 'implemented_in_v636', 'needs_deploy_and_sql', 'repo_verified', 'critical', 'Phase 4 adds the admin System Health surface plus version, script drift, gate and perf helpers. Existing page owners remain intact.', 'Upload v636, run Phase 4 SQL, then open admin_system_health.html.', true),
  ('phase5.identity_profiles_avatars_badges', 5, 'identity-profiles', 'Identity, dropdowns, profiles, avatars and badges', 'planned_partial_foundation', 'profiles.html', 'gejast-profile-source.js', 'profile_bundle_readers', 'profiles_bundle_alignment.sql', 'partial_foundations_present', 'unknown', 'inferred_from_repo', 'critical', 'Profiles/dropdowns/badges exist partially; needs one canonical scoped player selector and hardened source owner.', 'Audit via matrix before writing Phase 5 fixes.', true),
  ('phase6.drinks_surfaces_completion', 6, 'drinks', 'Drinks surfaces completion and verified-only speed stats', 'planned_partial_foundation', 'drinks.html', 'gejast-drinks-workflow.js', 'canonical_drinks_action_v1', 'drinks_speed_rpc.sql', 'partial_foundations_present', 'unknown', 'inferred_from_repo', 'critical', 'Drinks pages and workflow helpers exist; speed types and verified-only stats need canonical hardening.', 'Implement after Phase 3/4.', true),
  ('phase7.shared_stats_framework', 7, 'shared-stats', 'Shared stats framework foundation', 'planned_missing', 'profiles.html', 'gejast-shared-stats.js', 'shared_stats_rpc', 'shared_stats_schema.sql', 'missing_as_framework', 'unknown', 'repo_gap_identified', 'critical', 'Shared stat framework is the major dependency for phases 8-13.', 'Implement framework before game-specific advanced stats.', true),
  ('phase8.klaverjassen_shared_stats_alignment', 8, 'klaverjassen', 'Klaverjassen shared-stat alignment', 'planned_missing', 'scorer.html', 'gejast-klaverjassen-shared-stats.js', 'klaverjassen_shared_rpc', 'klaverjassen_shared_stats.sql', 'missing_as_phase_pack', 'unknown', 'repo_gap_identified', 'high', 'Needs average opponent Elo, comeback stats and shared rendering compatibility.', 'Implement after Phase 7.', true),
  ('phase9.pikken_full_implementation_pack', 9, 'pikken', 'Pikken full implementation pack', 'planned_partial_foundation', 'pikken.html', 'gejast-pikken.js', 'pikken_rpc', 'pikken_stats.sql', 'partial_foundations_present', 'unknown', 'inferred_from_repo', 'high', 'Pikken pages/helper exist; advanced stats/probability/update hooks need integration into existing owner.', 'Merge into gejast-pikken.js; do not create duplicate owner.', true),
  ('phase10.beerpong_full_implementation_pack', 10, 'beerpong', 'Beerpong full implementation pack', 'planned_partial_foundation', 'beerpong.html', 'gejast-beerpong.js', 'beerpong_rpc', 'beerpong_stats.sql', 'basic_surface_present_advanced_pack_missing', 'unknown', 'repo_gap_identified', 'high', 'Needs nemesis, upset, streak, consistency, opponent Elo, odds and chaos metrics.', 'Implement after shared stats framework.', true),
  ('phase11.boerenbridge_full_implementation_pack', 11, 'boerenbridge', 'Boerenbridge full implementation pack', 'planned_partial_foundation', 'boerenbridge.html', 'gejast-boerenbridge.js', 'boerenbridge_rpc', 'boerenbridge_stats.sql', 'basic_surface_present_advanced_pack_missing', 'unknown', 'repo_gap_identified', 'high', 'Needs wall of shame, consistency, upset/probability defied, chaos, opponent Elo and live odds box.', 'Implement after shared stats framework.', true),
  ('phase12.klaverjassen_alignment_pack', 12, 'klaverjassen', 'Klaverjassen alignment pack', 'planned_partial_foundation', 'ladder.html', 'gejast-klaverjassen.js', 'klaverjassen_rpc', 'klaverjassen_stats.sql', 'surfaces_present_clean_phase_pack_missing', 'unknown', 'repo_gap_identified', 'high', 'Needs ladder/stats update hook alignment and cleanup of multiple Klaverjas file variants.', 'Implement after Phase 7/8.', true),
  ('phase13.auto_beurs_markets', 13, 'despimarkt', 'Auto Beurs markets from match lifecycle', 'planned_partial_foundation', 'despimarkt_market.html', 'gejast-despimarkt.js', 'despimarkt_create_market', 'despimarkt_market.sql', 'manual_surfaces_present_auto_lifecycle_missing', 'unknown', 'repo_gap_identified', 'defer_until_lifecycle_trusted', 'Depends on game lifecycle, Elo odds and shared stats correctness.', 'Do not implement before phases 3, 7 and game lifecycle stats are reliable.', true)
on conflict (feature_key) do update set
  phase=excluded.phase, subsystem=excluded.subsystem, title=excluded.title, status=excluded.status,
  owner_page=excluded.owner_page, owner_js=excluded.owner_js, owner_rpc=excluded.owner_rpc, owner_sql=excluded.owner_sql,
  github_status=excluded.github_status, live_status=excluded.live_status, trust_level=excluded.trust_level,
  priority=excluded.priority, notes=excluded.notes, next_action=excluded.next_action, needs_sql=excluded.needs_sql,
  updated_at=now();

create or replace function public._implementation_matrix_admin_guard(admin_session_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_session jsonb;
begin
  if nullif(btrim(coalesce(admin_session_token,'')), '') is null then
    raise exception 'admin_session_token_required';
  end if;
  v_session := to_jsonb(public.admin_check_session(admin_session_token));
  return coalesce(v_session, '{}'::jsonb);
exception when undefined_function then
  raise exception 'admin_check_session_missing_for_implementation_matrix';
end;
$fn$;

create or replace function public.admin_get_implementation_matrix(admin_session_token text, site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_session jsonb; v_rows jsonb; v_evidence jsonb;
begin
  v_session := public._implementation_matrix_admin_guard(admin_session_token);
  select coalesce(jsonb_agg(to_jsonb(f) order by f.phase, f.subsystem, f.priority, f.feature_key), '[]'::jsonb)
    into v_rows from public.implementation_matrix_features f;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.detected_at desc, e.id desc), '[]'::jsonb)
    into v_evidence from (select * from public.implementation_matrix_evidence order by detected_at desc, id desc limit 250) e;
  return jsonb_build_object('ok', true, 'version', 'v635', 'site_scope', coalesce(nullif(site_scope_input,''), 'friends'), 'admin_session', v_session, 'features', v_rows, 'recent_evidence', v_evidence, 'generated_at', now());
end;
$fn$;

create or replace function public.admin_record_implementation_evidence(
  admin_session_token text, feature_key_input text, evidence_type_input text,
  source_path_input text default null, symbol_name_input text default null,
  status_input text default 'observed', detail_input text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_row public.implementation_matrix_evidence%rowtype;
begin
  perform public._implementation_matrix_admin_guard(admin_session_token);
  insert into public.implementation_matrix_evidence(feature_key,evidence_type,source_path,symbol_name,status,detail)
  values (btrim(feature_key_input), coalesce(nullif(btrim(evidence_type_input),''),'manual'), nullif(btrim(coalesce(source_path_input,'')),''), nullif(btrim(coalesce(symbol_name_input,'')),''), coalesce(nullif(btrim(status_input),''),'observed'), detail_input)
  returning * into v_row;
  return to_jsonb(v_row);
end;
$fn$;

revoke all on public.implementation_matrix_features from anon, authenticated;
revoke all on public.implementation_matrix_evidence from anon, authenticated;
-- Direct table access is intentionally not granted; admin reads go through guarded SECURITY DEFINER RPCs.
grant execute on function public.admin_get_implementation_matrix(text, text) to anon, authenticated;
grant execute on function public.admin_record_implementation_evidence(text, text, text, text, text, text, text) to anon, authenticated;

commit;
