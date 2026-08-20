-- GEJAST v812a — visual warning cleanup contracts
-- Applied to production on 2026-08-21.
-- Preserve real stale-room mutation as service-role-only while keeping legacy
-- browser cleanup calls harmless and Data-API-compatible.

revoke execute on function public.cleanup_stale_paardenrace_rooms_v718(text) from public, anon, authenticated;
grant execute on function public.cleanup_stale_paardenrace_rooms_v718(text) to service_role;

revoke execute on function public.cleanup_stale_pikken_rooms_v718(text) from public, anon, authenticated;
grant execute on function public.cleanup_stale_pikken_rooms_v718(text) to service_role;

-- gejast-paardenrace.js automatically supplies session_token,
-- session_token_input and site_scope_input to non-public-read RPCs. Use one
-- unambiguous signature that matches that browser contract. Browser calls are
-- deliberately no-op; trusted service_role calls retain the v718 cleanup.
drop function if exists public.cleanup_stale_paardenrace_rooms_v706(text);
create function public.cleanup_stale_paardenrace_rooms_v706(
  session_token text default null,
  session_token_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
begin
  if current_user = 'service_role' then
    return public.cleanup_stale_paardenrace_rooms_v718(site_scope_input);
  end if;

  return jsonb_build_object(
    'ok', true,
    'cleaned', 0,
    'source', 'v812a_client_noop',
    'site_scope', coalesce(nullif(trim(site_scope_input), ''), 'friends')
  );
end
$function$;
revoke execute on function public.cleanup_stale_paardenrace_rooms_v706(text,text,text) from public;
grant execute on function public.cleanup_stale_paardenrace_rooms_v706(text,text,text) to anon, authenticated, service_role;

-- Pikken's browser contract supplies only site_scope_input. It gets the same
-- harmless compatibility behavior; service_role retains actual cleanup.
create or replace function public.cleanup_stale_pikken_rooms_v706(site_scope_input text default 'friends')
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
begin
  if current_user = 'service_role' then
    return public.cleanup_stale_pikken_rooms_v718(site_scope_input);
  end if;

  return jsonb_build_object(
    'ok', true,
    'cleaned', 0,
    'source', 'v812a_client_noop',
    'site_scope', coalesce(nullif(trim(site_scope_input), ''), 'friends')
  );
end
$function$;
revoke execute on function public.cleanup_stale_pikken_rooms_v706(text) from public;
grant execute on function public.cleanup_stale_pikken_rooms_v706(text) to anon, authenticated, service_role;

-- paarderace_live.html still invokes the historical v495 name through the
-- shared RPC helper, so the Data API receives all three helper arguments.
-- All parameters keep defaults so legacy zero-argument SQL callers still work.
drop function if exists public.paardenrace_cleanup_idle_lobbies_v495();
create function public.paardenrace_cleanup_idle_lobbies_v495(
  session_token text default null,
  session_token_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language sql
security invoker
set search_path = public
as $function$
  select jsonb_build_object(
    'ok', true,
    'cleaned', 0,
    'source', 'v812a_client_noop',
    'site_scope', coalesce(nullif(trim(site_scope_input), ''), 'friends')
  )
$function$;
revoke execute on function public.paardenrace_cleanup_idle_lobbies_v495(text,text,text) from public;
grant execute on function public.paardenrace_cleanup_idle_lobbies_v495(text,text,text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
