-- GEJAST v692 overload/profile/speed repair
-- Run after v690. Do not run v691 admin owner unless you intentionally want that separate admin migration.

begin;

do $drop$
declare
  rec record;
  v_names text[] := array[
    'get_paardenrace_open_rooms_public',
    'get_paardenrace_room_state_fast_v687',
    'get_profiles_fast_v687',
    'get_login_active_names_v687',
    'get_game_player_names_fast_v687'
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

create or replace function public._gejast_scope_norm_v692(site_scope_input text default 'friends')
returns text
language sql
stable
as $fn$
  select case when lower(coalesce(site_scope_input, 'friends')) in ('family','familie') then 'family' else 'friends' end
$fn$;

create or replace function public._gejast_active_names_v692(site_scope_input text default 'friends', limit_input integer default 250)
returns table(display_name text, player_id bigint, site_scope text, total_matches integer, total_wins integer, best_rating numeric)
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := public._gejast_scope_norm_v692(site_scope_input);
begin
  if to_regclass('public.players') is not null then
    return query execute $sql$
      select distinct on (lower(p.display_name))
        p.display_name::text,
        p.id::bigint,
        coalesce(nullif(p.site_scope,''), 'friends')::text,
        0::integer,
        0::integer,
        1000::numeric
      from public.players p
      where nullif(trim(p.display_name), '') is not null
        and coalesce(p.active, false) = true
        and coalesce(p.approved, true) = true
        and (
          p.pin_hash is not null
          or p.session_token is not null
          or p.last_login_at is not null
        )
        and coalesce(nullif(p.site_scope,''), 'friends') = $1
      order by lower(p.display_name), p.last_login_at desc nulls last, p.id
      limit $2
    $sql$ using v_scope, greatest(1, least(coalesce(limit_input, 250), 500));
  end if;

  if to_regclass('public.claim_requests') is not null then
    return query execute $sql$
      select distinct on (lower(coalesce(cr.display_name, cr.requested_name, cr.desired_name)))
        coalesce(cr.display_name, cr.requested_name, cr.desired_name)::text,
        cr.player_id::bigint,
        coalesce(nullif(cr.site_scope,''), 'friends')::text,
        0::integer,
        0::integer,
        1000::numeric
      from public.claim_requests cr
      where nullif(trim(coalesce(cr.display_name, cr.requested_name, cr.desired_name)), '') is not null
        and lower(coalesce(cr.status, cr.decision, '')) in ('active','activated','approved')
        and (
          cr.activated_at is not null
          or cr.player_id is not null
          or lower(coalesce(cr.status, cr.decision, '')) in ('active','activated')
        )
        and coalesce(nullif(cr.site_scope,''), 'friends') = $1
      order by lower(coalesce(cr.display_name, cr.requested_name, cr.desired_name)), cr.updated_at desc nulls last, cr.id
      limit $2
    $sql$ using v_scope, greatest(1, least(coalesce(limit_input, 250), 500));
  end if;
end
$fn$;

create or replace function public.get_login_active_names_v687(site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_rows jsonb;
  v_names jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'display_name', display_name,
    'player_name', display_name,
    'name', display_name,
    'player_id', player_id,
    'site_scope', site_scope,
    'login_active', true,
    'active', true,
    'has_pin', true
  ) order by lower(display_name)), '[]'::jsonb)
  into v_rows
  from public._gejast_active_names_v692(site_scope_input, 300);

  select coalesce(jsonb_agg(x->>'display_name' order by lower(x->>'display_name')), '[]'::jsonb)
  into v_names
  from jsonb_array_elements(v_rows) x;

  return jsonb_build_object(
    'ok', true,
    'site_scope', public._gejast_scope_norm_v692(site_scope_input),
    'activated_names', v_rows,
    'active_names', v_rows,
    'players', v_rows,
    'names', v_names
  );
end
$fn$;

create or replace function public.get_profiles_fast_v687(site_scope_input text default 'friends', limit_input integer default 200)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'public_display_name', display_name,
    'display_name', display_name,
    'player_name', display_name,
    'name', display_name,
    'player_id', player_id,
    'site_scope', site_scope,
    'total_matches', total_matches,
    'total_wins', total_wins,
    'best_rating', best_rating,
    'active', true,
    'login_active', true,
    'has_pin', true
  ) order by lower(display_name)), '[]'::jsonb)
  into v_rows
  from public._gejast_active_names_v692(site_scope_input, limit_input);

  return jsonb_build_object('ok', true, 'players', v_rows, 'items', v_rows, 'profiles', v_rows);
end
$fn$;

create or replace function public.get_game_player_names_fast_v687(site_scope_input text default 'friends', limit_input integer default 200)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_names jsonb;
begin
  select coalesce(jsonb_agg(display_name order by lower(display_name)), '[]'::jsonb)
  into v_names
  from public._gejast_active_names_v692(site_scope_input, limit_input);

  return jsonb_build_object('ok', true, 'names', v_names, 'players', v_names);
end
$fn$;

create or replace function public.get_paardenrace_open_rooms_public(site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_result jsonb;
begin
  begin
    if to_regprocedure('public.get_paardenrace_open_rooms_fast_v687(text,integer)') is not null then
      execute 'select public.get_paardenrace_open_rooms_fast_v687($1, 30)' into v_result using public._gejast_scope_norm_v692(site_scope_input);
      return coalesce(v_result, '[]'::jsonb);
    end if;
  exception when others then
    null;
  end;

  return '[]'::jsonb;
end
$fn$;

create or replace function public.get_paardenrace_room_state_fast_v687(
  room_code_input text default null,
  session_token text default null,
  session_token_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if to_regprocedure('public.get_paardenrace_room_state_safe(text,text,text,text)') is not null then
    return public.get_paardenrace_room_state_safe(room_code_input, session_token, session_token_input, public._gejast_scope_norm_v692(site_scope_input));
  end if;
  return jsonb_build_object('room', null, 'players', '[]'::jsonb, 'viewer', '{}'::jsonb, 'pending_verifications', '[]'::jsonb);
end
$fn$;

grant execute on function public.get_login_active_names_v687(text) to anon, authenticated;
grant execute on function public.get_profiles_fast_v687(text, integer) to anon, authenticated;
grant execute on function public.get_game_player_names_fast_v687(text, integer) to anon, authenticated;
grant execute on function public.get_paardenrace_open_rooms_public(text) to anon, authenticated;
grant execute on function public.get_paardenrace_room_state_fast_v687(text, text, text, text) to anon, authenticated;

commit;
