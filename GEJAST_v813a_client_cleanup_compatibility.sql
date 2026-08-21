-- GEJAST v813a: make legacy browser cleanup aliases non-mutating while preserving trusted maintenance.
-- Browser callers get a harmless 200/no-op; service_role and privileged callers still delegate
-- to the current v718 maintenance implementation. Also refresh PostgREST's schema cache so the
-- retired zero-argument Paardenrace v495 no-op is routable again.

begin;

create or replace function public.cleanup_stale_paardenrace_rooms_v706(site_scope_input text default 'friends'::text)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $v813a$
begin
  if current_user in ('anon','authenticated') then
    return jsonb_build_object('ok', true, 'cleaned', 0, 'source', 'v813_client_noop');
  end if;
  return public.cleanup_stale_paardenrace_rooms_v718(site_scope_input);
end
$v813a$;

grant execute on function public.cleanup_stale_paardenrace_rooms_v706(text) to anon, authenticated, service_role;

create or replace function public.cleanup_stale_pikken_rooms_v706(site_scope_input text default 'friends'::text)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $v813a$
begin
  if current_user in ('anon','authenticated') then
    return jsonb_build_object('ok', true, 'cleaned', 0, 'source', 'v813_client_noop');
  end if;
  return public.cleanup_stale_pikken_rooms_v718(site_scope_input);
end
$v813a$;

grant execute on function public.cleanup_stale_pikken_rooms_v706(text) to anon, authenticated, service_role;

create or replace function public.paardenrace_cleanup_idle_lobbies_v495()
returns jsonb
language sql
security invoker
set search_path to 'public'
as $v813a$
  select jsonb_build_object('ok', true, 'cleaned', 0, 'source', 'v813_retired_noop')
$v813a$;

grant execute on function public.paardenrace_cleanup_idle_lobbies_v495() to anon, authenticated, service_role;

-- PostgREST had stale knowledge of the retired v495 signature in the authenticated visual run.
notify pgrst, 'reload schema';

commit;
