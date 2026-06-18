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
    from public.gejast_player_sessions_v691 s
    join public.players p on p.id = s.player_id
   where s.session_token = token_value
     and s.expires_at > now()
     and coalesce(p.active, true) = true
   order by s.expires_at desc
   limit 1;

  if found then
    update public.gejast_player_sessions_v691
       set last_seen_at = now()
     where session_token = token_value;
    return player_row;
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

create or replace function public.account_login_bridge_v687(
  display_name_input text default null,
  entered_pin text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  player_row public.players%rowtype;
  requested_scope text := case when lower(coalesce(site_scope_input, 'friends')) = 'family' then 'family' else 'friends' end;
begin
  if nullif(trim(coalesce(display_name_input, '')), '') is null then
    raise exception 'missing_player_name';
  end if;
  if nullif(coalesce(entered_pin, ''), '') is null then
    raise exception 'missing_pin';
  end if;

  select p.*
    into player_row
    from public.players p
   where lower(p.display_name) = lower(trim(display_name_input))
     and coalesce(p.active, false) = true
     and lower(coalesce(p.site_scope, 'friends')) = requested_scope
   order by p.id
   limit 1;

  if not found
     or player_row.pin_hash is null
     or not public._gejast_secret_matches_v691(entered_pin, player_row.pin_hash) then
    raise exception 'player_login_invalid';
  end if;

  return public._gejast_player_login_payload_v691(player_row.id)
    || jsonb_build_object('bridge', 'v746');
end
$fn$;

create or replace function public.account_login_v687(
  display_name_input text default null,
  entered_pin text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
  select public.account_login_bridge_v687(display_name_input, entered_pin, site_scope_input);
$fn$;

revoke all on function public._jas_session_player(text) from public;
grant execute on function public._jas_session_player(text) to anon, authenticated;
grant execute on function public.account_login_bridge_v687(text, text, text) to anon, authenticated;
grant execute on function public.account_login_v687(text, text, text) to anon, authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
