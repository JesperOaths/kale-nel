-- GEJAST v755m: profile RPC session-token ambiguity/security repair.
-- Production migration; apply only after v755n admin guard has passed.
--
-- Repairs the real my_profile.html RPC path:
--   get_my_profile_settings({ session_token })
--   update_my_profile_settings({ session_token, display_name_input, avatar_url_input })
--
-- Root issues preserved in the matrix evidence:
--   * live update_my_profile_settings returns SQL 42702: column reference "session_token" is ambiguous
--   * invalid-token writes are unsafe because the old function can upsert gejast_profile_settings before proving a player
--
-- Minimal SQL-only strategy:
--   * keep the same one-argument / three-argument RPC signatures and grants used by my_profile.html
--   * use positional parameters ($1/$2/$3) inside PL/pgSQL so the public JSON arg name `session_token` never competes with table columns
--   * preflight the existing profile table and primary-key constraint; do not silently create schema in this narrow repair
--   * resolve a real player before any profile-settings/player-field write
--   * use ON CONFLICT ON CONSTRAINT gejast_profile_settings_pkey to avoid a bare session_token conflict target

begin;

do $preflight$
begin
  if to_regclass('public.gejast_profile_settings') is null then
    raise exception 'v755m_preflight_failed: missing public.gejast_profile_settings';
  end if;

  if not exists (
    select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'gejast_profile_settings'
       and c.conname = 'gejast_profile_settings_pkey'
       and c.contype = 'p'
  ) then
    raise exception 'v755m_preflight_failed: missing gejast_profile_settings_pkey';
  end if;
end;
$preflight$;

-- Remove obsolete overloads deliberately; preserve exact production signatures with CREATE OR REPLACE.
drop function if exists public.get_my_profile_settings(text, text);
drop function if exists public.update_my_profile_settings(text, text, jsonb);

create or replace function public.get_my_profile_settings(
  session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_token text := nullif(trim(coalesce($1, '')), '');
  v_player public.players%rowtype;
  v_settings jsonb := '{}'::jsonb;
  v_display_name text;
  v_avatar_url text;
begin
  -- validate session input
  if v_token is null then
    return jsonb_build_object('ok', false, 'error', 'profile_settings_session_missing');
  end if;

  -- resolve a non-null player before reading player-scoped settings
  begin
    v_player := public._tier3_player_from_any_session_v740(v_token);
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'profile_settings_session_invalid');
  end;

  if v_player.id is null then
    return jsonb_build_object('ok', false, 'error', 'profile_settings_session_invalid');
  end if;

  select coalesce(gps.settings, '{}'::jsonb)
    into v_settings
    from public.gejast_profile_settings as gps
   where gps.session_token = v_token;

  v_settings := coalesce(v_settings, '{}'::jsonb);
  v_display_name := coalesce(
    nullif(v_settings->>'display_name', ''),
    nullif(to_jsonb(v_player)->>'display_name', ''),
    nullif(to_jsonb(v_player)->>'chosen_username', ''),
    nullif(to_jsonb(v_player)->>'player_name', ''),
    nullif(to_jsonb(v_player)->>'name', '')
  );
  v_avatar_url := coalesce(
    v_settings->>'avatar_url',
    v_settings->>'profile_picture_url',
    to_jsonb(v_player)->>'avatar_url',
    to_jsonb(v_player)->>'profile_picture_url',
    ''
  );

  return jsonb_build_object(
    'ok', true,
    'settings', v_settings,
    'player_id', v_player.id,
    'player_name', coalesce(nullif(to_jsonb(v_player)->>'player_name', ''), nullif(to_jsonb(v_player)->>'name', ''), v_display_name),
    'display_name', coalesce(v_display_name, ''),
    'avatar_url', coalesce(v_avatar_url, ''),
    'profile_picture_url', coalesce(v_avatar_url, '')
  );
end;
$fn$;

create or replace function public.update_my_profile_settings(
  session_token text default null,
  display_name_input text default null,
  avatar_url_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_token text := nullif(trim(coalesce($1, '')), '');
  v_display_name text := nullif(trim(coalesce($2, '')), '');
  v_avatar_url text := coalesce($3, '');
  v_player public.players%rowtype;
  v_settings jsonb;
begin
  -- validate session input
  if v_token is null then
    raise exception 'profile_settings_session_missing';
  end if;

  -- resolve a non-null player before any write
  begin
    v_player := public._tier3_player_from_any_session_v740(v_token);
  exception when others then
    raise exception 'profile_settings_session_invalid';
  end;

  if v_player.id is null then
    raise exception 'profile_settings_session_invalid';
  end if;

  -- only after a valid non-null player exists may the profile-setting row be written
  v_settings := jsonb_build_object(
    'display_name', coalesce(v_display_name, ''),
    'avatar_url', v_avatar_url,
    'profile_picture_url', v_avatar_url
  );

  insert into public.gejast_profile_settings(session_token, settings, updated_at)
  values (v_token, v_settings, now())
  on conflict on constraint gejast_profile_settings_pkey
  do update set settings = excluded.settings, updated_at = now();

  if v_display_name is not null then
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'players' and column_name = 'display_name'
    ) then
      execute 'update public.players set display_name = $1 where id = $2' using v_display_name, v_player.id;
    end if;

    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'players' and column_name = 'chosen_username'
    ) then
      execute 'update public.players set chosen_username = coalesce(nullif(chosen_username, ''''), $1) where id = $2' using v_display_name, v_player.id;
    end if;
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'players' and column_name = 'avatar_url'
  ) then
    execute 'update public.players set avatar_url = $1 where id = $2' using v_avatar_url, v_player.id;
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'players' and column_name = 'profile_picture_url'
  ) then
    execute 'update public.players set profile_picture_url = $1 where id = $2' using v_avatar_url, v_player.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'settings', v_settings,
    'player_id', v_player.id,
    'display_name', coalesce(v_display_name, ''),
    'avatar_url', v_avatar_url,
    'profile_picture_url', v_avatar_url
  );
end;
$fn$;

revoke all on function public.get_my_profile_settings(text) from public;
revoke all on function public.update_my_profile_settings(text, text, text) from public;

grant execute on function public.get_my_profile_settings(text) to anon, authenticated;
grant execute on function public.update_my_profile_settings(text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
