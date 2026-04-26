-- GEJAST v694: remove remaining Paardenrace create overloads and hide stale duplicate Pikken lobbies.
-- Run after v693. This intentionally does not touch admin login/session RPCs.

begin;

create or replace function public._gejast_scope_norm_v694(site_scope_input text default 'friends')
returns text language sql stable as $fn$
  select case when lower(coalesce(site_scope_input, 'friends')) in ('family','familie') then 'family' else 'friends' end
$fn$;

do $drop$
declare
  rec record;
begin
  for rec in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_paardenrace_room_safe','create_paardenrace_room_fast_v687','get_pikken_open_lobbies_fast_v687')
  loop
    execute format('drop function if exists %I.%I(%s) cascade', rec.nspname, rec.proname, rec.args);
  end loop;
end
$drop$;

create or replace function public.create_paardenrace_room_safe(
  session_token text default null,
  session_token_input text default null,
  room_code_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_name text;
  v_player_id bigint;
  v_code text := upper(trim(coalesce(room_code_input,'')));
  v_room_id bigint;
begin
  if to_regprocedure('public._paardenrace_require_name(text,text)') is null
     or to_regprocedure('public._paardenrace_player_id(text,text)') is null
     or to_regprocedure('public._paardenrace_random_room_code()') is null
     or to_regprocedure('public._paardenrace_upsert_player(bigint,text,bigint)') is null
     or to_regprocedure('public._paardenrace_build_room_state(text,text,text)') is null then
    raise exception 'paardenrace_backend_missing';
  end if;

  v_name := public._paardenrace_require_name(session_token, session_token_input);
  v_player_id := public._paardenrace_player_id(session_token, session_token_input);

  if v_code = '' then
    v_code := public._paardenrace_random_room_code();
  end if;

  insert into public.paardenrace_rooms(room_code, host_player_id, host_name)
  values (v_code, v_player_id, v_name)
  returning id into v_room_id;

  perform public._paardenrace_upsert_player(v_room_id, v_name, v_player_id);

  return public._paardenrace_build_room_state(v_code, session_token, session_token_input);
end
$fn$;

create or replace function public.create_paardenrace_room_fast_v687(
  session_token text default null,
  session_token_input text default null,
  room_code_input text default null,
  room_name_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  return public.create_paardenrace_room_safe(
    session_token,
    session_token_input,
    coalesce(nullif(room_code_input,''), nullif(room_name_input,''))
  );
end
$fn$;

create or replace function public.get_pikken_open_lobbies_fast_v687(
  site_scope_input text default 'friends',
  limit_input integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_rows jsonb := '[]'::jsonb;
  v_scope text := public._gejast_scope_norm_v694(site_scope_input);
begin
  if to_regclass('public.pikken_games') is null then
    return jsonb_build_object('ok', true, 'lobbies', '[]'::jsonb, 'items', '[]'::jsonb);
  end if;

  execute $sql$
    with ranked as (
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
        (select gp.player_name from public.pikken_game_players gp where gp.game_id = g.id order by gp.seat_index nulls last limit 1) as host_name,
        row_number() over (
          partition by upper(coalesce(nullif(g.lobby_code,''), g.id::text))
          order by coalesce(g.updated_at, g.created_at, now()) desc, g.id desc
        ) as rn
      from public.pikken_games g
      where coalesce(nullif(g.site_scope,''), 'friends') = $1
        and lower(coalesce(g.status,'')) in ('lobby','open','waiting')
    ),
    visible as (
      select *
      from ranked
      where rn = 1
        and (
          updated_at >= now() - interval '90 minutes'
          or player_count > 1
          or ready_count > 0
        )
      order by updated_at desc nulls last
      limit $2
    )
    select coalesce(jsonb_agg(row_to_json(visible)::jsonb order by visible.updated_at desc nulls last), '[]'::jsonb)
    from visible
  $sql$ into v_rows using v_scope, greatest(1, least(coalesce(limit_input,30),50));

  return jsonb_build_object('ok', true, 'lobbies', coalesce(v_rows, '[]'::jsonb), 'items', coalesce(v_rows, '[]'::jsonb), 'rows', coalesce(v_rows, '[]'::jsonb));
end
$fn$;

grant execute on function public.create_paardenrace_room_safe(text,text,text) to anon, authenticated;
grant execute on function public.create_paardenrace_room_fast_v687(text,text,text,text,text) to anon, authenticated;
grant execute on function public.get_pikken_open_lobbies_fast_v687(text,integer) to anon, authenticated;

commit;
