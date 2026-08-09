begin;

-- Remove the v770a frontend-signature readers.
drop function if exists public.get_live_match_summary_public_scoped(text,text,text,text);
drop function if exists public.get_homepage_live_state_public_scoped(text,text);

-- Restore the exact v690 one-argument compatibility placeholders.
drop function if exists public.get_live_match_summary_public_scoped(text);
create function public.get_live_match_summary_public_scoped(
  site_scope_input text default 'friends'
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'ok', true,
    'summary', '[]'::jsonb,
    'matches', '[]'::jsonb,
    'scope', site_scope_input
  )
$fn$;

revoke all on function public.get_live_match_summary_public_scoped(text) from public;
grant execute on function public.get_live_match_summary_public_scoped(text) to anon, authenticated;

drop function if exists public.get_homepage_live_state_public_scoped(text);
create function public.get_homepage_live_state_public_scoped(
  site_scope_input text default 'friends'
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'ok', true,
    'live', '[]'::jsonb,
    'matches', '[]'::jsonb,
    'scope', site_scope_input
  )
$fn$;

revoke all on function public.get_homepage_live_state_public_scoped(text) from public;
grant execute on function public.get_homepage_live_state_public_scoped(text) to anon, authenticated;

commit;
