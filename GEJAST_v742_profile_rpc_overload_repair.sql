-- GEJAST v742: profile RPC overload repair.
-- Run after v741 if my_profile.html reports that PostgREST cannot choose
-- get_my_profile_settings, or if profile save cannot find the display/avatar
-- update signature used by the live page.

begin;

create table if not exists public.gejast_profile_settings (
  session_token text primary key,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

drop function if exists public.get_my_profile_settings(text, text);
drop function if exists public.get_my_profile_settings(text);

create or replace function public.get_my_profile_settings(
  session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_token text := nullif(trim(coalesce(get_my_profile_settings.session_token, '')), '');
  v_player public.players%rowtype;
  v_settings jsonb := '{}'::jsonb;
  v_display_name text;
  v_avatar_url text;
begin
  if v_token is null then
    return jsonb_build_object('ok', false, 'error', 'profile_settings_session_missing');
  end if;

  begin
    v_player := public._tier3_player_from_any_session_v740(v_token);
  exception when others then
    null;
  end;

  select coalesce(settings, '{}'::jsonb)
    into v_settings
    from public.gejast_profile_settings
   where gejast_profile_settings.session_token = v_token;

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

drop function if exists public.update_my_profile_settings(text, text, jsonb);
drop function if exists public.update_my_profile_settings(text, text, text);

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
  v_token text := nullif(trim(coalesce(update_my_profile_settings.session_token, '')), '');
  v_display_name text := nullif(trim(coalesce(update_my_profile_settings.display_name_input, '')), '');
  v_avatar_url text := coalesce(update_my_profile_settings.avatar_url_input, '');
  v_player public.players%rowtype;
  v_settings jsonb;
begin
  if v_token is null then
    raise exception 'profile_settings_session_missing';
  end if;

  begin
    v_player := public._tier3_player_from_any_session_v740(v_token);
  exception when others then
    null;
  end;

  v_settings := jsonb_build_object(
    'display_name', coalesce(v_display_name, ''),
    'avatar_url', v_avatar_url,
    'profile_picture_url', v_avatar_url
  );

  insert into public.gejast_profile_settings(session_token, settings, updated_at)
  values (v_token, v_settings, now())
  on conflict (session_token)
  do update set settings = excluded.settings, updated_at = now();

  if v_player.id is not null and v_display_name is not null then
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

  if v_player.id is not null then
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

grant execute on function public.get_my_profile_settings(text) to anon, authenticated;
grant execute on function public.update_my_profile_settings(text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
