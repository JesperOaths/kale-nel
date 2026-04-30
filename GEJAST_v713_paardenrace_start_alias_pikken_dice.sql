-- GEJAST v713: Paardenrace start alias compatibility for the current lobby page.

begin;

drop function if exists public.start_paardenrace_room_safe(text,text,text,text);
drop function if exists public.start_paardenrace_countdown_safe(text,text,text,text);
drop function if exists public.start_paardenrace_countdown_fast_v687(text,text,text,text);

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
begin
  return public.start_paardenrace_countdown_safe(session_token, session_token_input, room_code_input);
end
$fn$;

create or replace function public.start_paardenrace_countdown_fast_v687(
  session_token text default null,
  session_token_input text default null,
  room_code_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
  select public.start_paardenrace_countdown_safe(session_token, session_token_input, room_code_input, site_scope_input)
$fn$;

create or replace function public.start_paardenrace_room_safe(
  session_token text default null,
  session_token_input text default null,
  room_code_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
  select public.start_paardenrace_countdown_safe(session_token, session_token_input, room_code_input, site_scope_input)
$fn$;

grant execute on function public.start_paardenrace_countdown_safe(text,text,text,text) to anon, authenticated;
grant execute on function public.start_paardenrace_countdown_fast_v687(text,text,text,text) to anon, authenticated;
grant execute on function public.start_paardenrace_room_safe(text,text,text,text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
