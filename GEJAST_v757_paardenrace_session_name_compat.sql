-- GEJAST v757 - Paardenrace player-session compatibility repair
--
-- Symptom: fresh canonical account sessions from account_login_v687/login_player can
-- create/join Pikken, but Paardenrace create_room fails with "Log eerst in als speler."
-- Root cause: _gejast_name_for_session stops at get_gejast_homepage_state when that
-- RPC returns successfully but with null player-name fields, so it never falls back
-- to get_jas_app_state where the canonical player name is present.

begin;

create or replace function public._gejast_name_for_session(p_session_token text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  state jsonb;
  name_out text;
begin
  if nullif(trim(coalesce(p_session_token,'')), '') is null then
    return null;
  end if;

  begin
    state := public.get_public_state(p_session_token)::jsonb;
    name_out := coalesce(state->>'my_name', state->>'display_name', state->>'player_name');
    if nullif(trim(coalesce(name_out,'')), '') is not null then
      return trim(name_out);
    end if;
  exception when others then
    null;
  end;

  begin
    state := public.get_gejast_homepage_state(p_session_token)::jsonb;
    name_out := coalesce(state->>'my_name', state->>'display_name', state->>'player_name');
    if nullif(trim(coalesce(name_out,'')), '') is not null then
      return trim(name_out);
    end if;
  exception when others then
    null;
  end;

  begin
    state := public.get_jas_app_state(p_session_token)::jsonb;
    name_out := coalesce(state->>'my_name', state->>'display_name', state->>'player_name');
    if nullif(trim(coalesce(name_out,'')), '') is not null then
      return trim(name_out);
    end if;
  exception when others then
    null;
  end;

  return null;
end
$fn$;

grant execute on function public._gejast_name_for_session(text) to anon, authenticated;

commit;
