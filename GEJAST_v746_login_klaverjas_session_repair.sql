-- GEJAST v746: converge player login and scorer/online Klaverjas sessions.
-- Safe repair: no user/game data is deleted or rewritten.

begin;

create extension if not exists pgcrypto;

create table if not exists public.gejast_player_sessions_v746 (
  session_token text primary key,
  player_id bigint not null references public.players(id) on delete cascade,
  display_name text not null,
  site_scope text not null default 'friends',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create index if not exists gejast_player_sessions_v746_player_idx
  on public.gejast_player_sessions_v746(player_id, expires_at desc);

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
    from public.gejast_player_sessions_v746 s
    join public.players p on p.id = s.player_id
   where s.session_token = token_value
     and s.expires_at > now()
     and coalesce(p.active, true) = true
   order by s.expires_at desc
   limit 1;

  if found then
    update public.gejast_player_sessions_v746 s
       set last_seen_at = now()
     where s.session_token = token_value;
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
    state := public.account_public_state_v687(token_value);
  exception when others then
    state := null;
  end;

  if coalesce(trim(state ->> 'my_name'), trim(state ->> 'display_name'), trim(state ->> 'player_name'), '') <> '' then
    select p.*
      into player_row
      from public.players p
     where lower(p.display_name) = lower(coalesce(
       nullif(trim(state ->> 'my_name'), ''),
       nullif(trim(state ->> 'display_name'), ''),
       nullif(trim(state ->> 'player_name'), '')
     ))
       and coalesce(p.active, true) = true
     order by p.id
     limit 1;
    if found then
      return player_row;
    end if;
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

create or replace function public.account_login_bridge_v687(
  desired_name text default null,
  input_username text default null,
  display_name_input text default null,
  entered_pin text default null,
  input_pin text default null,
  site_scope_input text default 'friends',
  client_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  player_row public.players%rowtype;
  requested_name text := coalesce(
    nullif(trim(display_name_input), ''),
    nullif(trim(input_username), ''),
    nullif(trim(desired_name), '')
  );
  requested_pin text := coalesce(
    nullif(entered_pin, ''),
    nullif(input_pin, '')
  );
  requested_scope text := case when lower(coalesce(site_scope_input, 'friends')) = 'family' then 'family' else 'friends' end;
  new_token text;
begin
  if requested_name is null then raise exception 'missing_player_name'; end if;
  if requested_pin is null then raise exception 'missing_pin'; end if;

  select p.*
    into player_row
    from public.players p
   where lower(p.display_name) = lower(requested_name)
     and coalesce(p.active, false) = true
     and lower(coalesce(p.site_scope, 'friends')) = requested_scope
   order by p.id
   limit 1;

  if not found
     or player_row.pin_hash is null
     or not public._gejast_secret_matches_v691(requested_pin, player_row.pin_hash) then
    raise exception 'player_login_invalid';
  end if;

  new_token := encode(gen_random_bytes(24), 'hex');

  insert into public.gejast_player_sessions_v746(
    session_token, player_id, display_name, site_scope
  )
  values (
    new_token, player_row.id, player_row.display_name, requested_scope
  );

  update public.players
     set session_token = new_token,
         last_login_at = now(),
         updated_at = now()
   where id = player_row.id;

  return jsonb_build_object(
    'ok', true,
    'bridge', 'v746',
    'player_id', player_row.id,
    'display_name', player_row.display_name,
    'player_name', player_row.display_name,
    'site_scope', requested_scope,
    'session_token', new_token,
    'expires_at', now() + interval '30 days'
  );
end
$fn$;

drop function if exists public.account_public_state_v687(text);
drop function if exists public._jas_session_debug_v746(text);

create or replace function public.account_public_state_v687(
  session_token text default null,
  session_token_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  token_value text := coalesce(
    nullif(trim(session_token_input), ''),
    nullif(trim(session_token), '')
  );
  session_row public.gejast_player_sessions_v746%rowtype;
begin
  select *
    into session_row
    from public.gejast_player_sessions_v746 s
   where s.session_token = token_value
     and s.expires_at > now()
   limit 1;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'my_name', null,
      'player_name', null,
      'display_name', null,
      'site_scope', case when lower(coalesce(site_scope_input, 'friends')) = 'family' then 'family' else 'friends' end,
      'version', 'v746'
    );
  end if;

  update public.gejast_player_sessions_v746 s
     set last_seen_at = now()
   where s.session_token = token_value;

  return jsonb_build_object(
    'ok', true,
    'my_name', session_row.display_name,
    'player_name', session_row.display_name,
    'display_name', session_row.display_name,
    'site_scope', session_row.site_scope,
    'version', 'v746'
  );
end
$fn$;

create or replace function public.get_jas_app_state(session_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  player_row public.players%rowtype;
  names_json jsonb;
begin
  begin
    player_row := public._jas_session_player(session_token);
  exception when others then
    player_row := null;
  end;

  select coalesce(jsonb_agg(p.display_name order by p.display_name), '[]'::jsonb)
    into names_json
    from public.players p
   where coalesce(p.active, true) = true;

  return jsonb_build_object(
    'my_name', case when player_row.id is null then null else player_row.display_name end,
    'display_name', case when player_row.id is null then null else player_row.display_name end,
    'player_name', case when player_row.id is null then null else player_row.display_name end,
    'site_scope', case when player_row.id is null then 'friends' else coalesce(player_row.site_scope, 'friends') end,
    'all_names', names_json,
    'recent_games', '[]'::jsonb
  );
end
$fn$;

revoke all on function public._jas_session_player(text) from public;
grant execute on function public._jas_session_player(text) to anon, authenticated;
grant execute on function public.account_login_bridge_v687(text, text, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.account_public_state_v687(text, text, text) to anon, authenticated;
grant execute on function public.get_jas_app_state(text) to anon, authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
