-- GEJAST v755f: recognise canonical login_player sessions in Tier-3 helpers.
-- login_player(input_username, entered_pin) writes public.sessions.session_token_hash,
-- but _gejast_player_from_session did not read that table. This preserves the
-- existing fallbacks and adds the hashed-session lookup.

begin;

create or replace function public._gejast_player_from_session(input_session_token text)
returns public.players
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_token text := nullif(trim(coalesce(input_session_token,'')), '');
  v_player public.players%rowtype;
  v_state jsonb;
  v_name text;
begin
  if v_token is null then
    return null;
  end if;

  if to_regprocedure('public._jas_session_player(text)') is not null then
    begin
      v_player := public._jas_session_player(v_token);
      if v_player.id is not null then
        return v_player;
      end if;
    exception when others then
      null;
    end;
  end if;

  if to_regclass('public.sessions') is not null
     and to_regprocedure('public._hash_session_token(text)') is not null then
    begin
      select p.*
        into v_player
        from public.sessions s
        join public.players p on p.id = s.player_id
       where s.session_token_hash = public._hash_session_token(v_token)
         and coalesce(p.active, true) = true
       order by s.created_at desc
       limit 1;
      if v_player.id is not null then
        return v_player;
      end if;
    exception when others then
      null;
    end;
  end if;

  begin
    select p.*
      into v_player
      from public.players p
     where p.session_token = v_token
       and coalesce(p.active, true) = true
     order by p.id
     limit 1;
    if v_player.id is not null then
      return v_player;
    end if;
  exception when others then
    null;
  end;

  begin
    v_state := public.account_public_state_v687(v_token);
    v_name := coalesce(
      nullif(trim(v_state->>'my_name'), ''),
      nullif(trim(v_state->>'display_name'), ''),
      nullif(trim(v_state->>'player_name'), '')
    );
  exception when others then
    v_name := null;
  end;

  if v_name is null then
    begin
      v_state := public.get_jas_app_state(v_token);
      v_name := coalesce(
        nullif(trim(v_state->>'my_name'), ''),
        nullif(trim(v_state->>'display_name'), ''),
        nullif(trim(v_state->>'player_name'), '')
      );
    exception when others then
      v_name := null;
    end;
  end if;

  if v_name is not null then
    select p.*
      into v_player
      from public.players p
     where lower(p.display_name) = lower(v_name)
       and coalesce(p.active, true) = true
     order by p.id
     limit 1;
    if v_player.id is not null then
      return v_player;
    end if;
  end if;

  return null;
end;
$fn$;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
