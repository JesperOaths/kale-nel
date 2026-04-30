-- GEJAST v712: Paardenrace start compatibility for scoped frontend calls.

begin;

do $drop$
declare
  rec record;
begin
  for rec in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('start_paardenrace_countdown_fast_v687')
  loop
    execute format('drop function if exists %I.%I(%s) cascade', rec.nspname, rec.proname, rec.args);
  end loop;
end
$drop$;

drop function if exists public.start_paardenrace_countdown_safe(text,text,text,text);

create or replace function public.start_paardenrace_countdown_safe(
  session_token text default null,
  session_token_input text default null,
  room_code_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_state jsonb;
begin
  -- The browser always sends site_scope_input through gejast-paardenrace.js.
  -- This four-argument overload prevents PostgREST from missing the older
  -- three-argument safe owner and keeps the original SQL owner in charge.
  v_state := public.start_paardenrace_countdown_safe(session_token, session_token_input, room_code_input);
  return v_state;
end
$fn$;

create or replace function public.start_paardenrace_countdown_fast_v687(
  session_token text default null,
  session_token_input text default null,
  room_code_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  return public.start_paardenrace_countdown_safe(session_token, session_token_input, room_code_input, site_scope_input);
end
$fn$;

create or replace function public.cleanup_stale_paardenrace_rooms_v712(site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_cutoff timestamptz := now() - interval '10 minutes';
  v_count integer := 0;
begin
  if to_regclass('public.paardenrace_rooms') is null then
    return jsonb_build_object('ok', false, 'closed', 0, 'reason', 'paardenrace_rooms_missing');
  end if;

  update public.paardenrace_rooms
     set stage = 'closed',
         updated_at = now(),
         finished_at = coalesce(finished_at, now())
   where coalesce(updated_at, created_at, now()) < v_cutoff
     and coalesce(stage,'lobby') in ('lobby','open','waiting');

  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'closed', v_count, 'cutoff', v_cutoff);
end
$fn$;

grant execute on function public.start_paardenrace_countdown_safe(text,text,text,text) to anon, authenticated;
grant execute on function public.start_paardenrace_countdown_fast_v687(text,text,text,text) to anon, authenticated;
grant execute on function public.cleanup_stale_paardenrace_rooms_v712(text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
