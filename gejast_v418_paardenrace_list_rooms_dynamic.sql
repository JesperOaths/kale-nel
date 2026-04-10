-- GEJAST v418 paardenrace list-rooms dynamic fix
-- Fixes the runtime error where paardenrace_list_joinable_rooms_scoped assumes r.status exists.

begin;

drop function if exists public.paardenrace_list_joinable_rooms_scoped(text, text);

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
  scope_col text;
  status_col text;
  stage_col text;
  created_col text;
  room_pk_col text;
  room_fk_col text;
  sql text;
begin
  if to_regclass('public.paardenrace_rooms') is null then
    return payload;
  end if;

  select column_name into scope_col
  from information_schema.columns
  where table_schema='public' and table_name='paardenrace_rooms' and column_name in ('site_scope','scope')
  order by case when column_name='site_scope' then 0 else 1 end
  limit 1;

  select column_name into status_col
  from information_schema.columns
  where table_schema='public' and table_name='paardenrace_rooms' and column_name in ('status','room_status')
  order by case when column_name='status' then 0 else 1 end
  limit 1;

  select column_name into stage_col
  from information_schema.columns
  where table_schema='public' and table_name='paardenrace_rooms' and column_name in ('stage','room_stage')
  order by case when column_name='stage' then 0 else 1 end
  limit 1;

  select column_name into created_col
  from information_schema.columns
  where table_schema='public' and table_name='paardenrace_rooms' and column_name in ('created_at','started_at','opened_at')
  order by case when column_name='created_at' then 0 when column_name='started_at' then 1 else 2 end
  limit 1;

  select case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='paardenrace_rooms' and column_name='id') then 'id' else 'room_id' end into room_pk_col;

  select column_name into room_fk_col
  from information_schema.columns
  where table_schema='public' and table_name='paardenrace_room_players' and column_name in ('room_id','paardenrace_room_id')
  order by case when column_name='room_id' then 0 else 1 end
  limit 1;

  sql := 'select coalesce(jsonb_agg(jsonb_build_object(' ||
    quote_literal('room_code') || ', r.room_code, ' ||
    quote_literal('status') || ', ' ||
      case
        when status_col is not null and stage_col is not null then format('coalesce(r.%I::text, r.%I::text, ''lobby'')', status_col, stage_col)
        when status_col is not null then format('coalesce(r.%I::text, ''lobby'')', status_col)
        when stage_col is not null then format('coalesce(r.%I::text, ''lobby'')', stage_col)
        else quote_literal('lobby')
      end || ', ' ||
    quote_literal('stage') || ', ' ||
      case
        when stage_col is not null and status_col is not null then format('coalesce(r.%I::text, r.%I::text, ''lobby'')', stage_col, status_col)
        when stage_col is not null then format('coalesce(r.%I::text, ''lobby'')', stage_col)
        when status_col is not null then format('coalesce(r.%I::text, ''lobby'')', status_col)
        else quote_literal('lobby')
      end || ', ' ||
    quote_literal('player_count') || ', ' ||
      case when room_fk_col is not null and to_regclass('public.paardenrace_room_players') is not null then format('(select count(*) from public.paardenrace_room_players rp where rp.%I = r.%I)', room_fk_col, room_pk_col) else '0' end || ', ' ||
    quote_literal('created_at') || ', ' ||
      case when created_col is not null then format('r.%I', created_col) else 'null' end ||
    ') order by ' || case when created_col is not null then format('r.%I asc', created_col) else 'r.room_code asc' end || '), ''[]''::jsonb) from public.paardenrace_rooms r where 1=1';

  if scope_col is not null then
    sql := sql || format(' and coalesce(r.%I::text, $1) = $1', scope_col);
  end if;
  if status_col is not null then
    sql := sql || format(' and coalesce(r.%I::text, ''lobby'') not in (''finished'',''closed'')', status_col);
  end if;

  execute sql into payload using resolved_scope;
  return coalesce(payload, '[]'::jsonb);
end;
$$;

grant execute on function public.paardenrace_list_joinable_rooms_scoped(text, text) to anon, authenticated, service_role;

commit;
