-- GEJAST v812b — analytics direct-table privilege boundary
-- Public analytics ingestion remains available only through SECURITY DEFINER
-- track_site_event(...). Admin reads remain available only through the
-- admin-session-gated admin_get_site_analytics_action(...).

begin;

revoke all privileges on table public.site_visitors from public, anon, authenticated;
revoke all privileges on table public.site_visit_sessions from public, anon, authenticated;
revoke all privileges on table public.site_visitor_events from public, anon, authenticated;

-- Preserve the intended RPC surface explicitly. These functions validate or
-- constrain their own public/admin contract and run as postgres.
grant execute on function public.track_site_event(text,text,text,text,text,text,text,text,text,integer,integer,text,text,text,jsonb)
  to anon, authenticated, service_role;
grant execute on function public.track_site_event(text,text,text,text,text,text,text,text,text,text,text,text,integer,integer,text,text,text,boolean,text,boolean,jsonb)
  to anon, authenticated, service_role;
grant execute on function public.admin_get_site_analytics_action(text,integer,integer)
  to anon, authenticated, service_role;

comment on table public.site_visitors is 'v812b: analytics storage is not directly exposed to anon/authenticated; use guarded RPCs.';
comment on table public.site_visit_sessions is 'v812b: analytics storage is not directly exposed to anon/authenticated; use guarded RPCs.';
comment on table public.site_visitor_events is 'v812b: analytics storage is not directly exposed to anon/authenticated; use guarded RPCs.';

commit;
