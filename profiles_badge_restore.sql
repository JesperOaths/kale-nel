-- GEJAST v637 Phase 5: profile badge restore diagnostics
-- Safe to rerun. Non-destructive.

begin;

insert into public.implementation_matrix_features (
  feature_key, phase, subsystem, title, status, owner_page, owner_js, owner_rpc, owner_sql,
  github_status, live_status, trust_level, priority, notes, next_action, needs_sql
) values
  ('phase5.profile_badge_restore', 5, 'identity-profile', 'Profile badge accordion and restore diagnostics', 'implemented_repo_pending_sql', 'profiles.html;player.html;admin_identity_health.html', 'gejast-profiles-restore.js;gejast-badge-source.js;gejast-badge-progress.js', 'admin_get_profile_badge_restore_audit_v1', 'profiles_badge_restore.sql', 'implemented_in_v637', 'needs_deploy_and_sql', 'repo_verified', 'high', 'Adds a safe admin diagnostic RPC for badge-source availability and a conservative frontend helper that restores missing badge containers/empty states without replacing badge ownership.', 'Deploy v637 and verify badge accordions remain visible.', true)
on conflict (feature_key) do update set
  phase=excluded.phase, subsystem=excluded.subsystem, title=excluded.title, status=excluded.status,
  owner_page=excluded.owner_page, owner_js=excluded.owner_js, owner_rpc=excluded.owner_rpc, owner_sql=excluded.owner_sql,
  github_status=excluded.github_status, live_status=excluded.live_status, trust_level=excluded.trust_level,
  priority=excluded.priority, notes=excluded.notes, next_action=excluded.next_action, needs_sql=excluded.needs_sql,
  updated_at=now();

create or replace function public.admin_get_profile_badge_restore_audit_v1(admin_session_token text, site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_session jsonb;
  v_scope text := public._gejast_phase5_norm_scope(site_scope_input);
  v_tables jsonb;
  v_functions jsonb;
begin
  v_session := public._implementation_matrix_admin_guard(admin_session_token);

  select coalesce(jsonb_agg(jsonb_build_object('table_name', src.table_name, 'exists', to_regclass(src.table_name) is not null)), '[]'::jsonb)
  into v_tables
  from (values
    ('public.badges'),
    ('public.player_badges'),
    ('public.badge_awards'),
    ('public.player_badge_progress'),
    ('public.drink_badges'),
    ('public.drink_player_badges')
  ) as src(table_name);

  select coalesce(jsonb_agg(jsonb_build_object('function_name', src.fn, 'exists', exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=src.fn
  ))), '[]'::jsonb)
  into v_functions
  from (values
    ('get_badge_source_public'),
    ('get_player_badges_public'),
    ('get_badge_progress_public'),
    ('get_profiles_page_bundle_scoped'),
    ('admin_get_profile_badge_restore_audit_v1')
  ) as src(fn);

  return jsonb_build_object(
    'ok', true,
    'phase', 5,
    'scope', v_scope,
    'badge_tables', v_tables,
    'badge_functions', v_functions,
    'frontend_owners', jsonb_build_array('gejast-badge-source.js','gejast-badge-progress.js','gejast-badges.js','gejast-profiles-restore.js'),
    'admin', v_session,
    'generated_at', now()
  );
end
$fn$;

revoke all on function public.admin_get_profile_badge_restore_audit_v1(text,text) from public;
grant execute on function public.admin_get_profile_badge_restore_audit_v1(text,text) to anon, authenticated;

commit;
