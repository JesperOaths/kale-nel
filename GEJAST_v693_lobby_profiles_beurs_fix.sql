-- GEJAST v693: profiles active names, Paardenrace create overload, Pikken public lobbies, Beurs coin data
-- Run after v692.

begin;

do $drop$
declare
  rec record;
  v_names text[] := array[
    'create_paardenrace_room_fast_v687',
    'get_profiles_fast_v687',
    'get_login_active_names_v687',
    'get_game_player_names_fast_v687',
    'get_pikken_open_lobbies_fast_v687',
    'get_pikken_live_matches_fast_v687',
    'get_caute_coin_top5_public',
    'get_my_caute_coins_public'
  ];
begin
  for rec in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(v_names)
  loop
    execute format('drop function if exists %I.%I(%s) cascade', rec.nspname, rec.proname, rec.args);
  end loop;
end
$drop$;

create or replace function public._gejast_scope_norm_v693(site_scope_input text default 'friends')
returns text language sql stable as $fn$
  select case when lower(coalesce(site_scope_input, 'friends')) in ('family','familie') then 'family' else 'friends' end
$fn$;

create or replace function public._gejast_table_has_col_v693(table_name_input text, column_name_input text)
returns boolean language sql stable as $fn$
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = table_name_input
      and column_name = column_name_input
  )
$fn$;

create or replace function public._gejast_active_profile_rows_v693(site_scope_input text default 'friends', limit_input integer default 250)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := public._gejast_scope_norm_v693(site_scope_input);
  v_sql text;
  v_rows jsonb := '[]'::jsonb;
  v_where text := '';
  v_scope_expr text := '''friends''';
begin
  if to_regclass('public.players') is not null and public._gejast_table_has_col_v693('players','display_name') then
    if public._gejast_table_has_col_v693('players','active') then
      v_where := v_where || ' and coalesce(p.active,false) = true';
    end if;
    if public._gejast_table_has_col_v693('players','approved') then
      v_where := v_where || ' and coalesce(p.approved,true) = true';
    end if;
    if public._gejast_table_has_col_v693('players','site_scope') then
      v_scope_expr := 'coalesce(nullif(p.site_scope,''''), ''friends'')';
      v_where := v_where || ' and coalesce(nullif(p.site_scope,''''), ''friends'') = $1';
    end if;

    v_sql := 'select coalesce(jsonb_agg(row_to_json(x)::jsonb order by lower(x.display_name)), ''[]''::jsonb)
      from (
        select distinct on (lower(p.display_name))
          p.display_name::text as display_name,
          p.display_name::text as player_name,
          p.display_name::text as public_display_name,
          ' || case when public._gejast_table_has_col_v693('players','id') then 'p.id::bigint' else 'null::bigint' end || ' as player_id,
          ' || v_scope_expr || '::text as site_scope,
          0::integer as total_matches,
          0::integer as total_wins,
          1000::numeric as best_rating,
          true as active,
          true as login_active,
          true as has_pin
        from public.players p
        where nullif(trim(p.display_name), '''') is not null' || v_where || '
        order by lower(p.display_name), ' || case when public._gejast_table_has_col_v693('players','last_login_at') then 'p.last_login_at desc nulls last,' else '' end || ' p.display_name
        limit $2
      ) x';
    execute v_sql into v_rows using v_scope, greatest(1, least(coalesce(limit_input,250),500));
  end if;

  if jsonb_array_length(v_rows) = 0 and to_regclass('public.claim_requests') is not null then
    v_sql := 'select coalesce(jsonb_agg(row_to_json(x)::jsonb order by lower(x.display_name)), ''[]''::jsonb)
      from (
        select distinct on (lower(coalesce(cr.display_name, cr.requested_name, cr.desired_name)))
          coalesce(cr.display_name, cr.requested_name, cr.desired_name)::text as display_name,
          coalesce(cr.display_name, cr.requested_name, cr.desired_name)::text as player_name,
          coalesce(cr.display_name, cr.requested_name, cr.desired_name)::text as public_display_name,
          cr.player_id::bigint as player_id,
          coalesce(nullif(cr.site_scope,''''), ''friends'')::text as site_scope,
          0::integer as total_matches,
          0::integer as total_wins,
          1000::numeric as best_rating,
          true as active,
          true as login_active,
          true as has_pin
        from public.claim_requests cr
        where nullif(trim(coalesce(cr.display_name, cr.requested_name, cr.desired_name)), '''') is not null
          and lower(coalesce(cr.status, cr.decision, '''')) in (''active'',''activated'',''approved'')
          and coalesce(nullif(cr.site_scope,''''), ''friends'') = $1
        order by lower(coalesce(cr.display_name, cr.requested_name, cr.desired_name)), cr.updated_at desc nulls last, cr.id
        limit $2
      ) x';
    execute v_sql into v_rows using v_scope, greatest(1, least(coalesce(limit_input,250),500));
  end if;

  return coalesce(v_rows, '[]'::jsonb);
end
$fn$;

create or replace function public.get_profiles_fast_v687(site_scope_input text default 'friends', limit_input integer default 200)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare v_rows jsonb;
begin
  v_rows := public._gejast_active_profile_rows_v693(site_scope_input, limit_input);
  return jsonb_build_object('ok', true, 'players', v_rows, 'items', v_rows, 'profiles', v_rows);
end
$fn$;

create or replace function public.get_login_active_names_v687(site_scope_input text default 'friends')
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare v_rows jsonb; v_names jsonb;
begin
  v_rows := public._gejast_active_profile_rows_v693(site_scope_input, 300);
  select coalesce(jsonb_agg(x->>'display_name' order by lower(x->>'display_name')), '[]'::jsonb)
  into v_names
  from jsonb_array_elements(v_rows) x;
  return jsonb_build_object('ok', true, 'site_scope', public._gejast_scope_norm_v693(site_scope_input), 'activated_names', v_rows, 'active_names', v_rows, 'players', v_rows, 'names', coalesce(v_names, '[]'::jsonb));
end
$fn$;

create or replace function public.get_game_player_names_fast_v687(site_scope_input text default 'friends', limit_input integer default 200)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare v_rows jsonb; v_names jsonb;
begin
  v_rows := public._gejast_active_profile_rows_v693(site_scope_input, limit_input);
  select coalesce(jsonb_agg(x->>'display_name' order by lower(x->>'display_name')), '[]'::jsonb)
  into v_names
  from jsonb_array_elements(v_rows) x;
  return jsonb_build_object('ok', true, 'names', coalesce(v_names, '[]'::jsonb), 'players', v_rows);
end
$fn$;

create or replace function public.create_paardenrace_room_fast_v687(
  session_token text default null,
  session_token_input text default null,
  room_code_input text default null,
  room_name_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
begin
  if to_regprocedure('public.create_paardenrace_room_safe(text,text,text)') is not null then
    return public.create_paardenrace_room_safe(session_token, session_token_input, coalesce(nullif(room_code_input,''), nullif(room_name_input,'')));
  end if;
  raise exception 'create_paardenrace_room_safe_missing';
end
$fn$;

create or replace function public.get_pikken_open_lobbies_fast_v687(site_scope_input text default 'friends', limit_input integer default 30)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_rows jsonb := '[]'::jsonb;
  v_scope text := public._gejast_scope_norm_v693(site_scope_input);
begin
  if to_regclass('public.pikken_games') is null then
    return jsonb_build_object('ok', true, 'lobbies', '[]'::jsonb, 'items', '[]'::jsonb);
  end if;

  execute $sql$
    select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.updated_at desc nulls last), '[]'::jsonb)
    from (
      select
        g.id,
        g.id::text as game_id,
        g.lobby_code,
        g.lobby_code as code,
        g.site_scope,
        g.status,
        coalesce(g.config, '{}'::jsonb) as config,
        coalesce(g.updated_at, g.created_at, now()) as updated_at,
        coalesce((select count(*) from public.pikken_game_players gp where gp.game_id = g.id), 0) as player_count,
        coalesce((select count(*) from public.pikken_game_players gp where gp.game_id = g.id and coalesce(gp.ready,false)), 0) as ready_count,
        (select gp.player_name from public.pikken_game_players gp where gp.game_id = g.id order by gp.seat_index nulls last limit 1) as host_name
      from public.pikken_games g
      where coalesce(nullif(g.site_scope,''), 'friends') = $1
        and lower(coalesce(g.status,'')) in ('lobby','open','waiting')
      order by coalesce(g.updated_at, g.created_at, now()) desc
      limit $2
    ) x
  $sql$ into v_rows using v_scope, greatest(1, least(coalesce(limit_input,30),80));

  return jsonb_build_object('ok', true, 'lobbies', v_rows, 'items', v_rows, 'rows', v_rows);
end
$fn$;

create or replace function public.get_pikken_live_matches_fast_v687(site_scope_input text default 'friends', limit_input integer default 30)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_rows jsonb := '[]'::jsonb;
  v_scope text := public._gejast_scope_norm_v693(site_scope_input);
begin
  if to_regclass('public.pikken_games') is null then
    return jsonb_build_object('ok', true, 'matches', '[]'::jsonb, 'items', '[]'::jsonb);
  end if;

  execute $sql$
    select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.updated_at desc nulls last), '[]'::jsonb)
    from (
      select
        g.id,
        g.id::text as game_id,
        g.lobby_code,
        g.lobby_code as code,
        g.site_scope,
        g.status,
        coalesce(g.state, '{}'::jsonb) as state,
        coalesce(g.updated_at, g.created_at, now()) as updated_at,
        coalesce((select count(*) from public.pikken_game_players gp where gp.game_id = g.id), 0) as player_count
      from public.pikken_games g
      where coalesce(nullif(g.site_scope,''), 'friends') = $1
        and lower(coalesce(g.status,'')) in ('live','active','in_progress','playing')
      order by coalesce(g.updated_at, g.created_at, now()) desc
      limit $2
    ) x
  $sql$ into v_rows using v_scope, greatest(1, least(coalesce(limit_input,30),80));

  return jsonb_build_object('ok', true, 'matches', v_rows, 'items', v_rows, 'rows', v_rows);
end
$fn$;

create or replace function public.get_caute_coin_top5_public(site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_rows jsonb := '[]'::jsonb;
  v_scope text := public._gejast_scope_norm_v693(site_scope_input);
begin
  if to_regclass('public.despimarkt_caute_balance_view') is not null then
    execute $sql$
      select coalesce(jsonb_agg(jsonb_build_object('player_name', player_name, 'display_name', player_name, 'balance', balance_cautes, 'coins', balance_cautes, 'caute_coins', balance_cautes) order by balance_cautes desc, lower(player_name)), '[]'::jsonb)
      from (
        select player_name, balance_cautes
        from public.despimarkt_caute_balance_view
        where coalesce(nullif(site_scope,''), 'friends') = $1
        order by balance_cautes desc, lower(player_name)
        limit 5
      ) b
    $sql$ into v_rows using v_scope;
  end if;

  if jsonb_array_length(v_rows) = 0 then
    select coalesce(jsonb_agg(jsonb_build_object('player_name', x->>'display_name', 'display_name', x->>'display_name', 'balance', 0, 'coins', 0, 'caute_coins', 0) order by lower(x->>'display_name')), '[]'::jsonb)
    into v_rows
    from jsonb_array_elements(public._gejast_active_profile_rows_v693(v_scope, 5)) x;
  end if;

  return jsonb_build_object('ok', true, 'rows', coalesce(v_rows, '[]'::jsonb), 'leaderboard', coalesce(v_rows, '[]'::jsonb));
end
$fn$;

create or replace function public.get_my_caute_coins_public(session_token text default null, session_token_input text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_token text := nullif(coalesce(session_token, session_token_input), '');
  v_name text := null;
  v_balance numeric := 0;
begin
  if v_token is not null and to_regclass('public.player_sessions') is not null then
    begin
      execute 'select p.display_name from public.player_sessions s join public.players p on p.id = s.player_id where s.session_token = $1 limit 1'
      into v_name using v_token;
    exception when others then
      v_name := null;
    end;
  end if;
  if v_name is null and v_token is not null and to_regclass('public.gejast_player_sessions_v691') is not null then
    begin
      execute 'select display_name from public.gejast_player_sessions_v691 where session_token = $1 limit 1'
      into v_name using v_token;
    exception when others then
      v_name := null;
    end;
  end if;
  if v_name is not null and to_regclass('public.despimarkt_caute_balance_view') is not null then
    begin
      execute 'select coalesce(balance_cautes,0) from public.despimarkt_caute_balance_view where lower(player_name)=lower($1) order by balance_cautes desc limit 1'
      into v_balance using v_name;
    exception when others then
      v_balance := 0;
    end;
  end if;

  return jsonb_build_object('ok', true, 'player_name', v_name, 'display_name', v_name, 'coins', coalesce(v_balance,0), 'balance', coalesce(v_balance,0), 'caute_coins', coalesce(v_balance,0), 'session_present', v_token is not null);
end
$fn$;

grant execute on function public.get_profiles_fast_v687(text, integer) to anon, authenticated;
grant execute on function public.get_login_active_names_v687(text) to anon, authenticated;
grant execute on function public.get_game_player_names_fast_v687(text, integer) to anon, authenticated;
grant execute on function public.create_paardenrace_room_fast_v687(text, text, text, text, text) to anon, authenticated;
grant execute on function public.get_pikken_open_lobbies_fast_v687(text, integer) to anon, authenticated;
grant execute on function public.get_pikken_live_matches_fast_v687(text, integer) to anon, authenticated;
grant execute on function public.get_caute_coin_top5_public(text) to anon, authenticated;
grant execute on function public.get_my_caute_coins_public(text, text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
