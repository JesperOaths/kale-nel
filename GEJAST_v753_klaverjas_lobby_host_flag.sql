-- GEJAST v753: make Klaverjas lobby host detection id-based.
-- The delete button is shown from klaverjas_online_list_open.is_host, so the
-- list RPC should use created_by_player_id first and display name as fallback.

begin;

create or replace function public.klaverjas_online_list_open(session_token text default null, site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  use_scope text := case when lower(coalesce(site_scope_input, 'friends')) = 'family' then 'family' else 'friends' end;
  viewer public.players%rowtype;
  viewer_name text := null;
  viewer_id bigint := null;
begin
  if coalesce(trim(session_token), '') <> '' then
    begin
      viewer := public._jas_session_player(session_token);
      viewer_name := viewer.display_name;
      viewer_id := viewer.id;
    exception when others then
      viewer_name := null;
      viewer_id := null;
    end;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id,
      'lobby_code', lobby_code,
      'status', status,
      'created_by_player_name', created_by_player_name,
      'is_host', viewer_id is not null and (
        created_by_player_id = viewer_id
        or lower(coalesce(created_by_player_name, '')) = lower(coalesce(viewer_name, ''))
      ),
      'has_me', viewer_name is not null and exists (
        select 1 from jsonb_array_elements(coalesce(state -> 'players', '[]'::jsonb)) p
        where lower(p ->> 'name') = lower(viewer_name)
      ),
      'player_count', jsonb_array_length(coalesce(state -> 'players', '[]'::jsonb)),
      'human_count', (
        select count(*) from jsonb_array_elements(coalesce(state -> 'players', '[]'::jsonb)) p
        where not coalesce((p ->> 'is_bot')::boolean, false)
      ),
      'bot_count', (
        select count(*) from jsonb_array_elements(coalesce(state -> 'players', '[]'::jsonb)) p
        where coalesce((p ->> 'is_bot')::boolean, false)
      ),
      'action_deadline_at', coalesce(action_deadline_at, nullif(state ->> 'action_deadline_at', '')::timestamptz),
      'updated_at', updated_at
    ) order by
      case when viewer_name is not null and exists (
        select 1 from jsonb_array_elements(coalesce(state -> 'players', '[]'::jsonb)) p
        where lower(p ->> 'name') = lower(viewer_name)
      ) then 0 else 1 end,
      updated_at desc)
    from public.klaverjas_online_games
    where site_scope = use_scope and status not in ('finished', 'closed') and updated_at > now() - interval '90 days'
      and not (
        jsonb_array_length(coalesce(state -> 'players', '[]'::jsonb)) > 0
        and not exists (
          select 1 from jsonb_array_elements(coalesce(state -> 'players', '[]'::jsonb)) p
          where not coalesce((p ->> 'is_bot')::boolean, false)
        )
        and updated_at < now() - interval '1 hour'
      )
  ), '[]'::jsonb);
end;
$fn$;

grant execute on function public.klaverjas_online_list_open(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
