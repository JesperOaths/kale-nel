-- GEJAST v813b: canonical browser-cleanup compatibility contract.
-- Production-applied 2026-08-21 after v813a exposed signature/grant drift in the authenticated visual audit.
-- Real v718 stale-room maintenance remains server-side; browser compatibility calls are non-mutating.

begin;

revoke execute on function public.cleanup_stale_paardenrace_rooms_v718(text) from public, anon, authenticated;
grant execute on function public.cleanup_stale_paardenrace_rooms_v718(text) to service_role;
revoke execute on function public.cleanup_stale_pikken_rooms_v718(text) from public, anon, authenticated;
grant execute on function public.cleanup_stale_pikken_rooms_v718(text) to service_role;

-- gejast-paardenrace.js sends these three fields by name. Keeping site_scope_input
-- first also preserves legacy positional trusted calls that pass only the scope.
drop function if exists public.cleanup_stale_paardenrace_rooms_v706(text,text,text);
drop function if exists public.cleanup_stale_paardenrace_rooms_v706(text);
create function public.cleanup_stale_paardenrace_rooms_v706(
  site_scope_input text default 'friends',
  session_token text default null,
  session_token_input text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
begin
  if current_user in ('anon','authenticated') then
    return jsonb_build_object(
      'ok', true,
      'cleaned', 0,
      'source', 'v813b_client_noop',
      'site_scope', coalesce(nullif(trim(site_scope_input), ''), 'friends')
    );
  end if;
  return public.cleanup_stale_paardenrace_rooms_v718(site_scope_input);
end
$function$;
revoke execute on function public.cleanup_stale_paardenrace_rooms_v706(text,text,text) from public;
grant execute on function public.cleanup_stale_paardenrace_rooms_v706(text,text,text) to anon, authenticated, service_role;

create or replace function public.cleanup_stale_pikken_rooms_v706(site_scope_input text default 'friends')
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
begin
  if current_user in ('anon','authenticated') then
    return jsonb_build_object(
      'ok', true,
      'cleaned', 0,
      'source', 'v813b_client_noop',
      'site_scope', coalesce(nullif(trim(site_scope_input), ''), 'friends')
    );
  end if;
  return public.cleanup_stale_pikken_rooms_v718(site_scope_input);
end
$function$;
revoke execute on function public.cleanup_stale_pikken_rooms_v706(text) from public;
grant execute on function public.cleanup_stale_pikken_rooms_v706(text) to anon, authenticated, service_role;

-- Historical v495 is retired. One unique signature accepts the browser helper's
-- named fields while all-default arguments preserve legacy zero-argument SQL calls.
drop function if exists public.paardenrace_cleanup_idle_lobbies_v495(text,text,text);
drop function if exists public.paardenrace_cleanup_idle_lobbies_v495();
create function public.paardenrace_cleanup_idle_lobbies_v495(
  site_scope_input text default 'friends',
  session_token text default null,
  session_token_input text default null
)
returns jsonb
language sql
security invoker
set search_path = public
as $function$
  select jsonb_build_object(
    'ok', true,
    'cleaned', 0,
    'source', 'v813b_retired_noop',
    'site_scope', coalesce(nullif(trim(site_scope_input), ''), 'friends')
  )
$function$;
revoke execute on function public.paardenrace_cleanup_idle_lobbies_v495(text,text,text) from public;
grant execute on function public.paardenrace_cleanup_idle_lobbies_v495(text,text,text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
