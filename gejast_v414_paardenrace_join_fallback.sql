-- GEJAST v414 paardenrace join fallback + sitewide version drift follow-up
-- Frontend changed in this patch, so visible version is v414.
-- SQL creates a compatibility wrapper for paardenrace_join_room_scoped where possible.

begin;

create or replace function public.paardenrace_join_room_scoped(
  room_code text,
  session_token text default null,
  site_scope_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_scope text := coalesce(nullif(site_scope_input, ''), 'friends');
  payload jsonb := '{}'::jsonb;
begin
  if to_regclass('public.paardenrace_rooms') is null then
    return payload;
  end if;

  if to_regprocedure('public.paardenrace_get_room_state_scoped(text,text,text)') is not null then
    execute 'select public.paardenrace_get_room_state_scoped($1,$2,$3)'
      into payload
      using room_code, session_token, resolved_scope;
    return coalesce(payload, '{}'::jsonb);
  end if;

  execute $q$
    select coalesce(jsonb_build_object(
      'room_code', r.room_code,
      'status', coalesce(r.status, r.stage, 'lobby'),
      'stage', coalesce(r.stage, r.status, 'lobby'),
      'site_scope', coalesce(r.site_scope, $2),
      'players', coalesce((
        select jsonb_agg(jsonb_build_object(
          'player_name', rp.player_name,
          'selected_suit', rp.selected_suit,
          'wager_bakken', rp.wager_bakken,
          'ready', rp.ready
        ) order by rp.joined_at nulls last, rp.updated_at nulls last)
        from public.paardenrace_room_players rp
        where rp.room_id = r.room_id or rp.room_id = r.id
      ), '[]'::jsonb)
    ), '{}'::jsonb)
    from public.paardenrace_rooms r
    where r.room_code = $1
      and coalesce(r.site_scope, $2) = $2
    limit 1
  $q$ into payload using room_code, resolved_scope;

  return coalesce(payload, '{}'::jsonb);
exception when undefined_table then
  return '{}'::jsonb;
end;
$$;

grant execute on function public.paardenrace_join_room_scoped(text, text, text) to anon, authenticated, service_role;

commit;
