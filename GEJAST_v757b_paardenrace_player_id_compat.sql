-- GEJAST v757b - Paardenrace canonical session player-id repair
--
-- Complements GEJAST_v757_paardenrace_session_name_compat.sql.
-- Symptom after name repair: Paardenrace room creation resolved the player name
-- but failed inserting room_players because _paardenrace_player_id still returned null.
-- Fix: prefer the canonical v746 player-session resolver, then fall back to the
-- older resolver and finally name-based active player lookup.

begin;

create or replace function public._paardenrace_player_id(
  session_token text default null,
  session_token_input text default null
)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_token text := public._paardenrace_safe_token(session_token, session_token_input);
  v_player public.players%rowtype;
  v_player_id bigint;
  v_name text;
begin
  if v_token is null then
    return null;
  end if;

  if to_regprocedure('public._jas_session_player(text)') is not null then
    begin
      v_player := public._jas_session_player(v_token);
      if v_player.id is not null then
        return v_player.id;
      end if;
    exception when others then
      null;
    end;
  end if;

  begin
    v_player_id := public._resolve_player_id_from_session_token(v_token);
    if v_player_id is not null then
      return v_player_id;
    end if;
  exception when others then
    null;
  end;

  begin
    v_name := public._gejast_name_for_session(v_token);
    if nullif(trim(coalesce(v_name,'')), '') is not null then
      select p.id
        into v_player_id
        from public.players p
       where lower(p.display_name) = lower(trim(v_name))
         and coalesce(p.active, true) = true
       order by p.id
       limit 1;
      if v_player_id is not null then
        return v_player_id;
      end if;
    end if;
  exception when others then
    null;
  end;

  return null;
end
$fn$;

grant execute on function public._paardenrace_player_id(text,text) to anon, authenticated;

commit;
