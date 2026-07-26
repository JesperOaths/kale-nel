-- GEJAST v757c - Pikken canonical session compatibility repair
--
-- Symptom: strict two-player Pikken smoke with fresh account_login_v687 tokens
-- failed at pikken_create_lobby_fast_v687 with "Je bent niet ingelogd."
-- Fix: make the shared _gejast_player_from_session(text) resolver understand the
-- canonical v746 player-session table/resolver while preserving older fallbacks.

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
end
$fn$;

grant execute on function public._gejast_player_from_session(text) to anon, authenticated;

commit;
