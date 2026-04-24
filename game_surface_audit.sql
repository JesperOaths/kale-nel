-- GEJAST v635 Phase 3: game surface audit
-- Run after implementation_matrix_seed.sql.

begin;

create or replace function public.admin_audit_game_surfaces(admin_session_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_games jsonb; v_counts jsonb;
begin
  perform public._implementation_matrix_admin_guard(admin_session_token);
  select coalesce(jsonb_agg(jsonb_build_object('subsystem', subsystem, 'phase', phase, 'feature_key', feature_key, 'title', title, 'status', status, 'owner_page', owner_page, 'owner_js', owner_js, 'owner_rpc', owner_rpc, 'owner_sql', owner_sql, 'priority', priority, 'next_action', next_action) order by subsystem, phase, feature_key), '[]'::jsonb)
    into v_games
  from public.implementation_matrix_features
  where subsystem in ('klaverjassen','boerenbridge','beerpong','pikken','paardenrace','drinks','despimarkt','shared-stats');

  select coalesce(jsonb_object_agg(subsystem, payload), '{}'::jsonb)
    into v_counts
  from (
    select subsystem, jsonb_build_object('features', count(*), 'critical', count(*) filter (where priority='critical'), 'planned_missing', count(*) filter (where status ilike '%missing%'), 'partial', count(*) filter (where status ilike '%partial%'), 'needs_sql', count(*) filter (where needs_sql)) payload
    from public.implementation_matrix_features
    where subsystem in ('klaverjassen','boerenbridge','beerpong','pikken','paardenrace','drinks','despimarkt','shared-stats')
    group by subsystem
  ) s;

  return jsonb_build_object('ok', true, 'audit', 'game_surfaces', 'generated_at', now(), 'counts', v_counts, 'items', v_games);
end;
$fn$;

grant execute on function public.admin_audit_game_surfaces(text) to anon, authenticated;

commit;
