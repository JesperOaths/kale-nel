-- GEJAST v416 paardenrace update-selection + version-drift follow-up
-- Frontend version is v416 because gejast-config.js changed.
-- This SQL creates the missing public.paardenrace_update_selection_scoped(...) RPC expected by the live paardenrace page.

begin;

drop function if exists public.paardenrace_update_selection_scoped(text, text, text, text, integer);

create or replace function public.paardenrace_update_selection_scoped(
  room_code_input text,
  selected_suit_input text,
  session_token_input text default null,
  site_scope_input text default null,
  wager_bakken_input integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_scope text := coalesce(nullif(site_scope_input, ''), 'friends');
  viewer_name text;
  v_room_id bigint;
  payload jsonb := '{}'::jsonb;
begin
  if to_regclass('public.paardenrace_rooms') is null then
    raise exception 'Paardenrace tables are missing.';
  end if;

  begin
    viewer_name := public._gejast_name_for_session(session_token_input);
  exception when undefined_function then
    viewer_name := null;
  end;

  if nullif(trim(coalesce(viewer_name, '')), '') is null then
    raise exception 'Log eerst in als speler.';
  end if;

  select r.id into v_room_id
  from public.paardenrace_rooms r
  where r.room_code = room_code_input
    and coalesce(r.site_scope, resolved_scope) = resolved_scope
  limit 1;

  if v_room_id is null then
    raise exception 'Room % bestaat niet in scope %.', room_code_input, resolved_scope;
  end if;

  if to_regclass('public.paardenrace_room_players') is null then
    raise exception 'Paardenrace room players table is missing.';
  end if;

  insert into public.paardenrace_room_players (
    room_id,
    player_name,
    selected_suit,
    wager_bakken,
    ready,
    joined_at,
    updated_at
  )
  values (
    v_room_id,
    viewer_name,
    selected_suit_input,
    greatest(coalesce(wager_bakken_input, 0), 0),
    true,
    now(),
    now()
  )
  on conflict (room_id, player_name)
  do update set
    selected_suit = excluded.selected_suit,
    wager_bakken = excluded.wager_bakken,
    ready = true,
    updated_at = now();

  if to_regprocedure('public.paardenrace_get_room_state_scoped(text,text,text)') is not null then
    execute 'select public.paardenrace_get_room_state_scoped($1,$2,$3)'
      into payload
      using room_code_input, session_token_input, resolved_scope;
    return coalesce(payload, '{}'::jsonb);
  end if;

  select jsonb_build_object(
    'room_code', r.room_code,
    'status', coalesce(r.status, r.stage, 'lobby'),
    'stage', coalesce(r.stage, r.status, 'lobby'),
    'site_scope', coalesce(r.site_scope, resolved_scope),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'player_name', rp.player_name,
        'selected_suit', rp.selected_suit,
        'wager_bakken', rp.wager_bakken,
        'ready', rp.ready
      ) order by rp.joined_at nulls last, rp.updated_at nulls last)
      from public.paardenrace_room_players rp
      where rp.room_id = r.id
    ), '[]'::jsonb)
  )
  into payload
  from public.paardenrace_rooms r
  where r.id = v_room_id;

  return coalesce(payload, '{}'::jsonb);
end;
$$;

grant execute on function public.paardenrace_update_selection_scoped(text, text, text, text, integer) to anon, authenticated, service_role;

commit;
