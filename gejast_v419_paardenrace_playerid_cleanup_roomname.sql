-- GEJAST v419 paardenrace player_id + stale lobby cleanup + custom room rename

begin;

-- Recreate selection RPC with dynamic player_id support.
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
  viewer_id bigint;
  v_room_id bigint;
  payload jsonb := '{}'::jsonb;
  room_pk_col text;
  player_room_fk_col text;
  player_name_col text;
  player_id_col text;
  selected_suit_col text;
  wager_col text;
  ready_col text;
  joined_at_col text;
  updated_at_col text;
  update_sql text;
  insert_sql text;
  where_sql text;
  updated_rows integer := 0;
begin
  if to_regclass('public.paardenrace_rooms') is null then raise exception 'Paardenrace tables are missing.'; end if;
  if to_regclass('public.paardenrace_room_players') is null then raise exception 'Paardenrace room players table is missing.'; end if;

  begin viewer_name := public._gejast_name_for_session(session_token_input); exception when undefined_function then viewer_name := null; end;
  begin viewer_id := public._resolve_player_id_from_session_token(session_token_input); exception when undefined_function then viewer_id := null; end;
  if nullif(trim(coalesce(viewer_name, '')), '') is null and viewer_id is null then raise exception 'Log eerst in als speler.'; end if;

  select case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='paardenrace_rooms' and column_name='id') then 'id' else 'room_id' end into room_pk_col;
  execute format('select %I from public.paardenrace_rooms where room_code = $1 and coalesce(site_scope, $2) = $2 limit 1', room_pk_col) into v_room_id using room_code_input, resolved_scope;
  if v_room_id is null then raise exception 'Room % bestaat niet in scope %.', room_code_input, resolved_scope; end if;

  select column_name into player_room_fk_col from information_schema.columns where table_schema='public' and table_name='paardenrace_room_players' and column_name in ('room_id','paardenrace_room_id') order by case when column_name='room_id' then 0 else 1 end limit 1;
  select column_name into player_name_col from information_schema.columns where table_schema='public' and table_name='paardenrace_room_players' and column_name in ('player_name','display_name','viewer_name','chosen_username','username') order by case column_name when 'player_name' then 0 when 'display_name' then 1 when 'viewer_name' then 2 when 'chosen_username' then 3 else 4 end limit 1;
  select column_name into player_id_col from information_schema.columns where table_schema='public' and table_name='paardenrace_room_players' and column_name in ('player_id','gejast_player_id') order by case when column_name='player_id' then 0 else 1 end limit 1;
  select column_name into selected_suit_col from information_schema.columns where table_schema='public' and table_name='paardenrace_room_players' and column_name in ('selected_suit','picked_suit','horse_suit','suit_key') order by case column_name when 'selected_suit' then 0 when 'picked_suit' then 1 when 'horse_suit' then 2 else 3 end limit 1;
  select column_name into wager_col from information_schema.columns where table_schema='public' and table_name='paardenrace_room_players' and column_name in ('wager_bakken','wager_amount','bakken','stake_bakken') order by case column_name when 'wager_bakken' then 0 when 'wager_amount' then 1 when 'bakken' then 2 else 3 end limit 1;
  select column_name into ready_col from information_schema.columns where table_schema='public' and table_name='paardenrace_room_players' and column_name in ('ready','is_ready') order by case column_name when 'ready' then 0 else 1 end limit 1;
  select column_name into joined_at_col from information_schema.columns where table_schema='public' and table_name='paardenrace_room_players' and column_name in ('joined_at','created_at') order by case column_name when 'joined_at' then 0 else 1 end limit 1;
  select column_name into updated_at_col from information_schema.columns where table_schema='public' and table_name='paardenrace_room_players' and column_name in ('updated_at','modified_at') order by case column_name when 'updated_at' then 0 else 1 end limit 1;

  if player_room_fk_col is null or selected_suit_col is null then raise exception 'Paardenrace room player columns could not be resolved.'; end if;
  if player_id_col is not null and viewer_id is null then raise exception 'Kon player_id niet afleiden uit sessie.'; end if;
  if player_id_col is null and player_name_col is null then raise exception 'Geen bruikbare speler-identiteit kolom gevonden.'; end if;

  update_sql := format('update public.paardenrace_room_players set %I = $3', selected_suit_col);
  if wager_col is not null then update_sql := update_sql || format(', %I = $4', wager_col); end if;
  if ready_col is not null then update_sql := update_sql || format(', %I = true', ready_col); end if;
  if updated_at_col is not null then update_sql := update_sql || format(', %I = now()', updated_at_col); end if;
  if player_id_col is not null then
    where_sql := format(' where %I = $1 and %I = $2', player_room_fk_col, player_id_col);
    execute update_sql || where_sql using v_room_id, viewer_id, selected_suit_input, greatest(coalesce(wager_bakken_input,0),0);
  else
    where_sql := format(' where %I = $1 and %I = $2', player_room_fk_col, player_name_col);
    execute update_sql || where_sql using v_room_id, viewer_name, selected_suit_input, greatest(coalesce(wager_bakken_input,0),0);
  end if;
  GET DIAGNOSTICS updated_rows = ROW_COUNT;

  if updated_rows = 0 then
    insert_sql := format('insert into public.paardenrace_room_players (%I', player_room_fk_col);
    if player_id_col is not null then insert_sql := insert_sql || format(', %I', player_id_col); end if;
    if player_name_col is not null then insert_sql := insert_sql || format(', %I', player_name_col); end if;
    insert_sql := insert_sql || format(', %I', selected_suit_col);
    if wager_col is not null then insert_sql := insert_sql || format(', %I', wager_col); end if;
    if ready_col is not null then insert_sql := insert_sql || format(', %I', ready_col); end if;
    if joined_at_col is not null then insert_sql := insert_sql || format(', %I', joined_at_col); end if;
    if updated_at_col is not null then insert_sql := insert_sql || format(', %I', updated_at_col); end if;
    insert_sql := insert_sql || ') values ($1';
    if player_id_col is not null then insert_sql := insert_sql || ', $2'; end if;
    if player_name_col is not null then insert_sql := insert_sql || ', $3'; end if;
    insert_sql := insert_sql || ', $4';
    if wager_col is not null then insert_sql := insert_sql || ', $5'; end if;
    if ready_col is not null then insert_sql := insert_sql || ', true'; end if;
    if joined_at_col is not null then insert_sql := insert_sql || ', now()'; end if;
    if updated_at_col is not null then insert_sql := insert_sql || ', now()'; end if;
    insert_sql := insert_sql || ')';
    execute insert_sql using v_room_id, viewer_id, viewer_name, selected_suit_input, greatest(coalesce(wager_bakken_input,0),0);
  end if;

  if to_regprocedure('public.paardenrace_get_room_state_scoped(text,text,text)') is not null then
    execute 'select public.paardenrace_get_room_state_scoped($1,$2,$3)' into payload using room_code_input, session_token_input, resolved_scope;
    return coalesce(payload, '{}'::jsonb);
  end if;

  select jsonb_build_object('room_code', r.room_code, 'status', coalesce(r.status, r.stage, 'lobby'), 'stage', coalesce(r.stage, r.status, 'lobby'), 'site_scope', coalesce(r.site_scope, resolved_scope)) into payload from public.paardenrace_rooms r where (case when room_pk_col='id' then r.id else r.room_id end) = v_room_id limit 1;
  return coalesce(payload, '{}'::jsonb);
end;
$$;

-- Optional lobby rename so creators can choose a recognizable room code/name.
drop function if exists public.paardenrace_rename_room_scoped(text, text, text, text);
create or replace function public.paardenrace_rename_room_scoped(
  room_code_input text,
  new_room_code_input text,
  session_token_input text default null,
  site_scope_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_scope text := coalesce(nullif(site_scope_input, ''), 'friends');
  clean_code text := upper(regexp_replace(coalesce(new_room_code_input,''), '[^A-Za-z0-9_-]', '', 'g'));
  payload jsonb := '{}'::jsonb;
begin
  if clean_code = '' then return jsonb_build_object('room_code', room_code_input); end if;
  if char_length(clean_code) > 20 then clean_code := substr(clean_code,1,20); end if;
  update public.paardenrace_rooms
     set room_code = clean_code
   where room_code = room_code_input
     and coalesce(site_scope, resolved_scope) = resolved_scope;
  return jsonb_build_object('room_code', clean_code);
exception when unique_violation then
  raise exception 'Deze lobbynaam bestaat al. Kies een andere naam.';
end;
$$;

-- Cleanup stale lobbies with 0 or 1 player after 2 minutes.
drop function if exists public.paardenrace_cleanup_stale_lobbies_v419();
create or replace function public.paardenrace_cleanup_stale_lobbies_v419()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
  room_pk_col text;
  room_fk_col text;
  created_col text;
  sql text;
begin
  if to_regclass('public.paardenrace_rooms') is null then return 0; end if;
  select case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='paardenrace_rooms' and column_name='id') then 'id' else 'room_id' end into room_pk_col;
  select column_name into room_fk_col from information_schema.columns where table_schema='public' and table_name='paardenrace_room_players' and column_name in ('room_id','paardenrace_room_id') order by case when column_name='room_id' then 0 else 1 end limit 1;
  select column_name into created_col from information_schema.columns where table_schema='public' and table_name='paardenrace_rooms' and column_name in ('created_at','opened_at','started_at') order by case when column_name='created_at' then 0 when column_name='opened_at' then 1 else 2 end limit 1;
  if created_col is null then return 0; end if;

  sql := format('with doomed as (select r.%1$I as room_pk from public.paardenrace_rooms r where r.%2$I < now() - interval ''2 minutes'' and (select count(*) from public.paardenrace_room_players rp where rp.%3$I = r.%1$I) <= 1) ', room_pk_col, created_col, coalesce(room_fk_col,'room_id'));
  if room_fk_col is not null and to_regclass('public.paardenrace_room_players') is not null then
    sql := sql || format(', deleted_players as (delete from public.paardenrace_room_players rp using doomed d where rp.%1$I = d.room_pk returning 1) ', room_fk_col);
  end if;
  sql := sql || format('delete from public.paardenrace_rooms r using doomed d where r.%1$I = d.room_pk', room_pk_col);
  execute sql;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  return deleted_count;
end;
$$;

-- Refresh joinable room list after cleanup.
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
  perform public.paardenrace_cleanup_stale_lobbies_v419();
  if to_regclass('public.paardenrace_rooms') is null then return payload; end if;
  select column_name into scope_col from information_schema.columns where table_schema='public' and table_name='paardenrace_rooms' and column_name in ('site_scope','scope') order by case when column_name='site_scope' then 0 else 1 end limit 1;
  select column_name into status_col from information_schema.columns where table_schema='public' and table_name='paardenrace_rooms' and column_name in ('status','room_status') order by case when column_name='status' then 0 else 1 end limit 1;
  select column_name into stage_col from information_schema.columns where table_schema='public' and table_name='paardenrace_rooms' and column_name in ('stage','room_stage') order by case when column_name='stage' then 0 else 1 end limit 1;
  select column_name into created_col from information_schema.columns where table_schema='public' and table_name='paardenrace_rooms' and column_name in ('created_at','started_at','opened_at') order by case when column_name='created_at' then 0 when column_name='started_at' then 1 else 2 end limit 1;
  select case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='paardenrace_rooms' and column_name='id') then 'id' else 'room_id' end into room_pk_col;
  select column_name into room_fk_col from information_schema.columns where table_schema='public' and table_name='paardenrace_room_players' and column_name in ('room_id','paardenrace_room_id') order by case when column_name='room_id' then 0 else 1 end limit 1;

  sql := 'select coalesce(jsonb_agg(jsonb_build_object(' || quote_literal('room_code') || ', r.room_code, ' || quote_literal('status') || ', ' || case when status_col is not null and stage_col is not null then format('coalesce(r.%I::text, r.%I::text, ''lobby'')', status_col, stage_col) when status_col is not null then format('coalesce(r.%I::text, ''lobby'')', status_col) when stage_col is not null then format('coalesce(r.%I::text, ''lobby'')', stage_col) else quote_literal('lobby') end || ', ' || quote_literal('stage') || ', ' || case when stage_col is not null and status_col is not null then format('coalesce(r.%I::text, r.%I::text, ''lobby'')', stage_col, status_col) when stage_col is not null then format('coalesce(r.%I::text, ''lobby'')', stage_col) when status_col is not null then format('coalesce(r.%I::text, ''lobby'')', status_col) else quote_literal('lobby') end || ', ' || quote_literal('player_count') || ', ' || case when room_fk_col is not null and to_regclass('public.paardenrace_room_players') is not null then format('(select count(*) from public.paardenrace_room_players rp where rp.%I = r.%I)', room_fk_col, room_pk_col) else '0' end || ', ' || quote_literal('created_at') || ', ' || case when created_col is not null then format('r.%I', created_col) else 'null' end || ') order by ' || case when created_col is not null then format('r.%I asc', created_col) else 'r.room_code asc' end || '), ''[]''::jsonb) from public.paardenrace_rooms r where 1=1';
  if scope_col is not null then sql := sql || format(' and coalesce(r.%I::text, $1) = $1', scope_col); end if;
  if status_col is not null then sql := sql || format(' and coalesce(r.%I::text, ''lobby'') not in (''finished'',''closed'')', status_col); end if;
  execute sql into payload using resolved_scope;
  return coalesce(payload, '[]'::jsonb);
end;
$$;

grant execute on function public.paardenrace_update_selection_scoped(text, text, text, text, integer) to anon, authenticated, service_role;
grant execute on function public.paardenrace_rename_room_scoped(text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.paardenrace_cleanup_stale_lobbies_v419() to anon, authenticated, service_role;
grant execute on function public.paardenrace_list_joinable_rooms_scoped(text, text) to anon, authenticated, service_role;

commit;
