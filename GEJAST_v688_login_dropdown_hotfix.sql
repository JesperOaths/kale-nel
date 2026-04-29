-- GEJAST v688 login dropdown hotfix
-- Safe to rerun.
-- Provides the v687 login RPC expected by the browser and keeps requestable/scope-only
-- names out of the login dropdown.

begin;

drop function if exists public.get_login_active_names_v687(text);

create or replace function public.get_login_active_names_v687(
  site_scope_input text default 'friends'
)
returns table(display_name text)
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := case when lower(coalesce(nullif(btrim(site_scope_input), ''), 'friends')) = 'family' then 'family' else 'friends' end;
  v_selector jsonb;
begin
  if to_regprocedure('public.get_player_selector_source_v1(text,text)') is not null then
    select public.get_player_selector_source_v1(null, v_scope) into v_selector;
    return query
      select distinct btrim(value)::text as display_name
      from jsonb_array_elements_text(coalesce(v_selector -> 'activated_names', '[]'::jsonb)) as t(value)
      where nullif(btrim(value), '') is not null
      order by btrim(value);
    return;
  end if;

  return;
end
$fn$;

revoke all on function public.get_login_active_names_v687(text) from public;
grant execute on function public.get_login_active_names_v687(text) to anon, authenticated;

commit;
