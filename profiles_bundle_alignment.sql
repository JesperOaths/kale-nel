-- GEJAST v637 Phase 5: profiles bundle alignment diagnostic
-- Safe to rerun. Non-destructive.

begin;

insert into public.implementation_matrix_features (
  feature_key, phase, subsystem, title, status, owner_page, owner_js, owner_rpc, owner_sql,
  github_status, live_status, trust_level, priority, notes, next_action, needs_sql
) values
  ('phase5.profiles_bundle_alignment', 5, 'identity-profile', 'Profiles bundle alignment and fallback restore', 'implemented_repo_pending_sql', 'profiles.html;player.html;admin_identity_health.html', 'gejast-profiles-restore.js;gejast-profile-source.js', 'admin_get_profiles_bundle_alignment_v1', 'profiles_bundle_alignment.sql', 'implemented_in_v637', 'needs_deploy_and_sql', 'repo_verified', 'high', 'Adds admin-only diagnostics comparing selector identities to profile surface assumptions. Frontend restore helper is conservative and does not replace gejast-profile-source ownership.', 'Deploy v637 and open profiles/player surfaces plus admin identity health.', true)
on conflict (feature_key) do update set
  phase=excluded.phase, subsystem=excluded.subsystem, title=excluded.title, status=excluded.status,
  owner_page=excluded.owner_page, owner_js=excluded.owner_js, owner_rpc=excluded.owner_rpc, owner_sql=excluded.owner_sql,
  github_status=excluded.github_status, live_status=excluded.live_status, trust_level=excluded.trust_level,
  priority=excluded.priority, notes=excluded.notes, next_action=excluded.next_action, needs_sql=excluded.needs_sql,
  updated_at=now();

create or replace function public.admin_get_profiles_bundle_alignment_v1(admin_session_token text, site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_session jsonb;
  v_scope text := public._gejast_phase5_norm_scope(site_scope_input);
  v_selector jsonb;
  v_profile_tables jsonb;
  v_functions jsonb;
begin
  v_session := public._implementation_matrix_admin_guard(admin_session_token);
  v_selector := public.get_player_selector_source_v1(null, v_scope);

  select coalesce(jsonb_agg(jsonb_build_object('table_name', src.table_name, 'exists', to_regclass(src.table_name) is not null)), '[]'::jsonb)
  into v_profile_tables
  from (values
    ('public.players'),
    ('public.player_profiles'),
    ('public.profiles'),
    ('public.player_badges'),
    ('public.badge_awards'),
    ('public.drink_badges')
  ) as src(table_name);

  select coalesce(jsonb_agg(jsonb_build_object('function_name', src.fn, 'exists', exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=src.fn
  ))), '[]'::jsonb)
  into v_functions
  from (values
    ('get_profiles_page_bundle_scoped'),
    ('get_all_site_players_public_scoped'),
    ('get_player_profiles_public_scoped'),
    ('get_profile_bundle_public'),
    ('get_drink_player_public'),
    ('get_player_selector_source_v1')
  ) as src(fn);

  return jsonb_build_object(
    'ok', true,
    'phase', 5,
    'scope', v_scope,
    'selector_counts', jsonb_build_object(
      'activated', jsonb_array_length(coalesce(v_selector -> 'activated_names', '[]'::jsonb)),
      'requestable', jsonb_array_length(coalesce(v_selector -> 'requestable_names', '[]'::jsonb))
    ),
    'profile_tables', v_profile_tables,
    'bundle_functions', v_functions,
    'notes', jsonb_build_array(
      'This is an admin diagnostic surface, not a new profile owner.',
      'gejast-profile-source.js remains the primary frontend profile bundle owner.',
      'Use this to spot missing DB objects before touching profile rendering.'
    ),
    'admin', v_session,
    'generated_at', now()
  );
end
$fn$;

revoke all on function public.admin_get_profiles_bundle_alignment_v1(text,text) from public;
grant execute on function public.admin_get_profiles_bundle_alignment_v1(text,text) to anon, authenticated;

commit;
