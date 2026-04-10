-- GEJAST v417 paardenrace dynamic selection fix
-- Fixes missing player_name column assumption by detecting actual column names in paardenrace_room_players.

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
  room_pk_col text;
  player_room_fk_col text;
  player_name_col text;
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
  if to_regclass('public.paardenrace_rooms') is null then
    raise exception 'Paardenrace tables are missing.';
  end if;
  if to_regclass('public.paardenrace_room_players') is null then
    raise exception 'Paardenrace room players table is missing.';
  end if;

  begin
    viewer_name := public._gejast_name_for_session(session_token_input);
  exception when undefined_function then
    viewer_name := null;
  end;
  if nullif(trim(coalesce(viewer_name, '')), '') is null then
    raise exception 'Log eerst in als speler.';
  end if;

  select case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='paardenrace_rooms' and column_name='id') then 'id' else 'room_id' end into room_pk_col;
  execute format('select %I from public.paardenrace_rooms where room_code = $1 and coalesce(site_scope, $2) = $2 limit 1', room_pk_col) into v_room_id using room_code_input, resolved_scope;
  if v_room_id is null then
    raise exception 'Room % bestaat niet in scope %.', room_code_input, resolved_scope;
  end if;

  select column_name into player_room_fk_col from information_schema.columns where table_schema='public' and table_name='paardenrace_room_players' and column_name in ('room_id','paardenrace_room_id') order by case when column_name='room_id' then 0 else 1 end limit 1;
  select column_name into player_name_col from information_schema.columns where table_schema='public' and table_name='paardenrace_room_players' and column_name in ('player_name','display_name','viewer_name','chosen_username','username') order by case column_name when 'player_name' then 0 when 'display_name' then 1 when 'viewer_name' then 2 when 'chosen_username' then 3 else 4 end limit 1;
  select column_name into selected_suit_col from information_schema.columns where table_schema='public' and table_name='paardenrace_room_players' and column_name in ('selected_suit','picked_suit','horse_suit','suit_key') order by case column_name when 'selected_suit' then 0 when 'picked_suit' then 1 when 'horse_suit' then 2 else 3 end limit 1;
  select column_name into wager_col from information_schema.columns where table_schema='public' and table_name='paardenrace_room_players' and column_name in ('wager_bakken','wager_amount','bakken','stake_bakken') order by case column_name when 'wager_bakken' then 0 when 'wager_amount' then 1 when 'bakken' then 2 else 3 end limit 1;
  select column_name into ready_col from information_schema.columns where table_schema='public' and table_name='paardenrace_room_players' and column_name in ('ready','is_ready') order by case column_name when 'ready' then 0 else 1 end limit 1;
  select column_name into joined_at_col from information_schema.columns where table_schema='public' and table_name='paardenrace_room_players' and column_name in ('joined_at','created_at') order by case column_name when 'joined_at' then 0 else 1 end limit 1;
  select column_name into updated_at_col from information_schema.columns where table_schema='public' and table_name='paardenrace_room_players' and column_name in ('updated_at','modified_at') order by case column_name when 'updated_at' then 0 else 1 end limit 1;

  if player_room_fk_col is null or player_name_col is null then
    raise exception 'Paardenrace room player columns could not be resolved.';
  end if;

  update_sql := format('update public.paardenrace_room_players set %I = $3', coalesce(selected_suit_col, player_name_col));
  if wager_col is not null then update_sql := update_sql || format(', %I = $4', wager_col); end if;
  if ready_col is not null then update_sql := update_sql || format(', %I = true', ready_col); end if;
  if updated_at_col is not null then update_sql := update_sql || format(', %I = now()', updated_at_col); end if;
  where_sql := format(' where %I = $1 and %I = $2', player_room_fk_col, player_name_col);
  if selected_suit_col is null then
    raise exception 'No selected-suit column could be resolved on paardenrace_room_players.';
  end if;
  execute update_sql || where_sql using v_room_id, viewer_name, selected_suit_input, greatest(coalesce(wager_bakken_input,0),0);
  GET DIAGNOSTICS updated_rows = ROW_COUNT;

  if updated_rows = 0 then
    insert_sql := format('insert into public.paardenrace_room_players (%I, %I, %I', player_room_fk_col, player_name_col, selected_suit_col);
    if wager_col is not null then insert_sql := insert_sql || format(', %I', wager_col); end if;
    if ready_col is not null then insert_sql := insert_sql || format(', %I', ready_col); end if;
    if joined_at_col is not null then insert_sql := insert_sql || format(', %I', joined_at_col); end if;
    if updated_at_col is not null then insert_sql := insert_sql || format(', %I', updated_at_col); end if;
    insert_sql := insert_sql || ') values ($1, $2, $3';
    if wager_col is not null then insert_sql := insert_sql || ', $4'; end if;
    if ready_col is not null then insert_sql := insert_sql || ', true'; end if;
    if joined_at_col is not null then insert_sql := insert_sql || ', now()'; end if;
    if updated_at_col is not null then insert_sql := insert_sql || ', now()'; end if;
    insert_sql := insert_sql || ')';
    execute insert_sql using v_room_id, viewer_name, selected_suit_input, greatest(coalesce(wager_bakken_input,0),0);
  end if;

  if to_regprocedure('public.paardenrace_get_room_state_scoped(text,text,text)') is not null then
    execute 'select public.paardenrace_get_room_state_scoped($1,$2,$3)' into payload using room_code_input, session_token_input, resolved_scope;
    return coalesce(payload, '{}'::jsonb);
  end if;

  select jsonb_build_object('room_code', r.room_code, 'status', coalesce(r.status, r.stage, 'lobby'), 'stage', coalesce(r.stage, r.status, 'lobby'), 'site_scope', coalesce(r.site_scope, resolved_scope)) into payload from public.paardenrace_rooms r where (case when room_pk_col='id' then r.id else r.room_id end) = v_room_id limit 1;
  return coalesce(payload, '{}'::jsonb);
end;
$$;

grant execute on function public.paardenrace_update_selection_scoped(text, text, text, text, integer) to anon, authenticated, service_role;

commit;
