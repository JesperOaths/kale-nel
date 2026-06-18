-- GEJAST v746: converge player login and scorer/online Klaverjas sessions.
-- Safe repair: no user/game data is deleted or rewritten.

begin;

create or replace function public._jas_session_player(session_token text)
returns public.players
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  player_row public.players%rowtype;
  state jsonb;
  token_value text := nullif(trim(coalesce(session_token, '')), '');
begin
  if token_value is null then
    raise exception 'Log eerst in met een geldige spelersessie';
  end if;

  select p.*
    into player_row
    from public.players p
   where p.session_token = token_value
     and coalesce(p.active, true) = true
   order by p.id
   limit 1;

  if found then
    return player_row;
  end if;

  begin
    state := public.get_jas_app_state(token_value);
  exception when others then
    state := null;
  end;

  if coalesce(trim(state ->> 'my_name'), '') <> '' then
    select p.*
      into player_row
      from public.players p
     where lower(p.display_name) = lower(trim(state ->> 'my_name'))
       and coalesce(p.active, true) = true
     order by p.id
     limit 1;
    if found then
      return player_row;
    end if;
  end if;

  raise exception 'Log eerst in met een geldige spelersessie';
end
$fn$;

-- Remove only the narrow v746 overloads from an earlier repair attempt.
-- The deployed seven-argument compatibility bridges remain the login owners.
drop function if exists public.account_login_bridge_v687(text, text, text);
drop function if exists public.account_login_v687(text, text, text);

revoke all on function public._jas_session_player(text) from public;
grant execute on function public._jas_session_player(text) to anon, authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
