-- GEJAST v637 Phase 5: player selector cache/audit support
-- Safe to rerun. Non-destructive.

begin;

insert into public.implementation_matrix_features (
  feature_key, phase, subsystem, title, status, owner_page, owner_js, owner_rpc, owner_sql,
  github_status, live_status, trust_level, priority, notes, next_action, needs_sql
) values
  ('phase5.selector_cache_audit', 5, 'identity-profile', 'Player selector cache and audit surface', 'implemented_repo_pending_sql', 'admin_identity_health.html', 'gejast-player-selector.js', 'admin_get_player_selector_audit_v1', 'player_selector_cache_views.sql', 'implemented_in_v637', 'needs_deploy_and_sql', 'repo_verified', 'high', 'Adds an admin-only diagnostic RPC for selector counts and duplicate/scope signals without exposing raw identity tables.', 'Open admin_identity_health.html after deploy.', true)
on conflict (feature_key) do update set
  phase=excluded.phase, subsystem=excluded.subsystem, title=excluded.title, status=excluded.status,
  owner_page=excluded.owner_page, owner_js=excluded.owner_js, owner_rpc=excluded.owner_rpc, owner_sql=excluded.owner_sql,
  github_status=excluded.github_status, live_status=excluded.live_status, trust_level=excluded.trust_level,
  priority=excluded.priority, notes=excluded.notes, next_action=excluded.next_action, needs_sql=excluded.needs_sql,
  updated_at=now();

create table if not exists public.gejast_player_selector_audit_cache (
  cache_key text primary key,
  scope text not null,
  payload jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now()
);

revoke all on table public.gejast_player_selector_audit_cache from anon, authenticated;

create or replace function public.admin_refresh_player_selector_audit_cache_v1(admin_session_token text, site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_session jsonb;
  v_scope text := public._gejast_phase5_norm_scope(site_scope_input);
  v_payload jsonb;
begin
  v_session := public._implementation_matrix_admin_guard(admin_session_token);
  v_payload := public.get_player_selector_source_v1(null, v_scope);
  insert into public.gejast_player_selector_audit_cache(cache_key, scope, payload, observed_at)
  values ('selector:' || v_scope, v_scope, v_payload, now())
  on conflict (cache_key) do update set payload=excluded.payload, observed_at=excluded.observed_at;
  return jsonb_build_object('ok', true, 'scope', v_scope, 'selector', v_payload, 'admin', v_session);
end
$fn$;

create or replace function public.admin_get_player_selector_audit_v1(admin_session_token text, site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_session jsonb;
  v_scope text := public._gejast_phase5_norm_scope(site_scope_input);
  v_live jsonb;
  v_cached jsonb;
  v_duplicates jsonb;
begin
  v_session := public._implementation_matrix_admin_guard(admin_session_token);
  v_live := public.get_player_selector_source_v1(null, v_scope);

  select payload into v_cached
  from public.gejast_player_selector_audit_cache
  where cache_key = 'selector:' || v_scope;

  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', cnt)), '[]'::jsonb)
  into v_duplicates
  from (
    select lower(value ->> 'name') as name, count(*) as cnt
    from jsonb_array_elements(coalesce(v_live -> 'rows', '[]'::jsonb)) as x(value)
    where coalesce(value ->> 'name','') <> ''
    group by lower(value ->> 'name')
    having count(*) > 1
    order by count(*) desc, lower(value ->> 'name')
  ) d;

  return jsonb_build_object(
    'ok', true,
    'phase', 5,
    'scope', v_scope,
    'activated_count', jsonb_array_length(coalesce(v_live -> 'activated_names', '[]'::jsonb)),
    'requestable_count', jsonb_array_length(coalesce(v_live -> 'requestable_names', '[]'::jsonb)),
    'duplicate_rows', v_duplicates,
    'live', v_live,
    'cached', coalesce(v_cached, '{}'::jsonb),
    'admin', v_session,
    'generated_at', now()
  );
end
$fn$;

revoke all on function public.admin_refresh_player_selector_audit_cache_v1(text,text) from public;
revoke all on function public.admin_get_player_selector_audit_v1(text,text) from public;
grant execute on function public.admin_refresh_player_selector_audit_cache_v1(text,text) to anon, authenticated;
grant execute on function public.admin_get_player_selector_audit_v1(text,text) to anon, authenticated;

commit;
