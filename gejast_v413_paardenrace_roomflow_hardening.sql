-- GEJAST v413 paardenrace roomflow hardening
-- Assumes the generated v412/v412a paardenrace line already exists.
-- This follow-up fixes the live error where gen_random_bytes(integer) is missing,
-- adds a safe joinable-room reader for the new room-picker UI.

begin;

create or replace function public.gen_random_bytes(length integer)
returns bytea
language plpgsql
volatile
as $$
declare
  target_len integer := greatest(coalesce(length, 0), 0);
  hex text := '';
  piece text;
begin
  while char_length(hex) < target_len * 2 loop
    piece := md5(random()::text || clock_timestamp()::text || hex || target_len::text);
    hex := hex || piece;
  end loop;
  return decode(substr(hex, 1, target_len * 2), 'hex');
end;
$$;

create or replace function public.paardenrace_list_joinable_rooms_scoped(
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
  payload jsonb := '[]'::jsonb;
begin
  if to_regclass('public.paardenrace_rooms') is null then
    return payload;
  end if;

  execute $q$
    select coalesce(jsonb_agg(jsonb_build_object(
      'room_code', room_code,
      'status', coalesce(status, stage, 'lobby'),
      'stage', coalesce(stage, status, 'lobby'),
      'player_count', coalesce(player_count, 0),
      'created_at', created_at
    ) order by created_at asc), '[]'::jsonb)
    from (
      select
        r.room_code,
        r.status,
        r.stage,
        r.created_at,
        count(rp.*) as player_count
      from public.paardenrace_rooms r
      left join public.paardenrace_room_players rp on rp.room_id = r.id
      where coalesce(r.site_scope, 'friends') = $1
        and coalesce(r.status, r.stage, 'lobby') in ('lobby','countdown','waiting')
      group by r.id, r.room_code, r.status, r.stage, r.created_at
    ) src
  $q$ into payload using resolved_scope;

  return coalesce(payload, '[]'::jsonb);
exception when undefined_table then
  return '[]'::jsonb;
end;
$$;

grant execute on function public.gen_random_bytes(integer) to anon, authenticated, service_role;
grant execute on function public.paardenrace_list_joinable_rooms_scoped(text, text) to anon, authenticated, service_role;

commit;
