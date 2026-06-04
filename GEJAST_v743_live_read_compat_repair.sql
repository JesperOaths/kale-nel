-- GEJAST v743: live read compatibility repair.
-- Run after v742 if live pages still show missing read/bundle RPCs, recursive
-- player-list failures, or allowed_usernames compatibility column errors.

begin;

alter table if exists public.allowed_usernames
  add column if not exists slug text,
  add column if not exists has_pin boolean not null default false,
  add column if not exists pin_is_set boolean not null default false,
  add column if not exists activated boolean not null default false,
  add column if not exists is_active boolean not null default false,
  add column if not exists site_scope text not null default 'friends';

update public.allowed_usernames
   set slug = coalesce(
       nullif(trim(slug), ''),
       lower(regexp_replace(coalesce(nullif(display_name, ''), username, id::text), '[^a-zA-Z0-9]+', '-', 'g'))
     ),
     is_active = coalesce(is_active, false) or lower(coalesce(status, '')) = 'active',
     activated = coalesce(activated, false) or lower(coalesce(status, '')) = 'active',
     pin_is_set = coalesce(pin_is_set, false) or coalesce(has_pin, false),
     has_pin = coalesce(has_pin, false) or coalesce(pin_is_set, false)
 where slug is null
    or trim(slug) = ''
    or lower(coalesce(status, '')) = 'active'
    or has_pin is null
    or pin_is_set is null
    or activated is null
    or is_active is null;

create index if not exists allowed_usernames_slug_idx
  on public.allowed_usernames (slug);

drop function if exists public.get_public_state(text, text);
drop function if exists public.get_public_state(text);

create or replace function public.get_public_state(
  site_scope_input text default 'friends'
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select jsonb_build_object(
    'ok', true,
    'site_scope', case when lower(coalesce(site_scope_input, 'friends')) in ('family','familie') then 'family' else 'friends' end,
    'my_name', null,
    'display_name', null,
    'player_name', null
  )
$fn$;

drop function if exists public.get_player_site_announcements_scoped(text, text);
drop function if exists public.get_player_site_announcements_scoped(text);

create or replace function public.get_player_site_announcements_scoped(
  site_scope_input text default 'friends'
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select jsonb_build_object(
    'ok', true,
    'site_scope', case when lower(coalesce(site_scope_input, 'friends')) in ('family','familie') then 'family' else 'friends' end,
    'items', '[]'::jsonb,
    'announcements', '[]'::jsonb
  )
$fn$;

drop function if exists public.get_scope_hardening_bundle_v672(text, text);
drop function if exists public.get_scope_hardening_bundle_v672(text);

create or replace function public.get_scope_hardening_bundle_v672(
  site_scope_input text default 'friends',
  scope_input text default null
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select jsonb_build_object(
    'ok', true,
    'site_scope', case when lower(coalesce(scope_input, site_scope_input, 'friends')) in ('family','familie') then 'family' else 'friends' end,
    'scope', case when lower(coalesce(scope_input, site_scope_input, 'friends')) in ('family','familie') then 'family' else 'friends' end,
    'guards', '{}'::jsonb,
    'items', '[]'::jsonb
  )
$fn$;

create or replace function public.get_beerpong_phase_bundle_v661(
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
begin
  if to_regprocedure('public.get_beerpong_phase_bundle_v658(text)') is not null then
    return public.get_beerpong_phase_bundle_v658(site_scope_input);
  end if;
  return jsonb_build_object(
    'ok', true,
    'source', 'v743_empty_beerpong_phase_bundle',
    'site_scope', case when lower(coalesce(site_scope_input, 'friends')) in ('family','familie') then 'family' else 'friends' end,
    'bundle', '{}'::jsonb,
    'items', '[]'::jsonb
  );
end;
$fn$;

create or replace function public.get_game_group_a_bundle_v661(
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
begin
  return jsonb_build_object(
    'ok', true,
    'source', 'v743_empty_game_group_a_bundle',
    'site_scope', case when lower(coalesce(site_scope_input, 'friends')) in ('family','familie') then 'family' else 'friends' end,
    'bundle', '{}'::jsonb,
    'items', '[]'::jsonb
  );
end;
$fn$;

drop function if exists public.get_all_site_players_public_scoped(text);

create or replace function public.get_all_site_players_public_scoped(
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := case when lower(coalesce(site_scope_input, 'friends')) in ('family','familie') then 'family' else 'friends' end;
  v_players jsonb := '[]'::jsonb;
begin
  if to_regclass('public.players') is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'player_id', p.id,
      'player_name', coalesce(nullif(to_jsonb(p)->>'player_name', ''), nullif(to_jsonb(p)->>'name', ''), nullif(to_jsonb(p)->>'display_name', '')),
      'display_name', coalesce(nullif(to_jsonb(p)->>'display_name', ''), nullif(to_jsonb(p)->>'chosen_username', ''), nullif(to_jsonb(p)->>'player_name', ''), nullif(to_jsonb(p)->>'name', '')),
      'avatar_url', coalesce(to_jsonb(p)->>'avatar_url', to_jsonb(p)->>'profile_picture_url', ''),
      'profile_picture_url', coalesce(to_jsonb(p)->>'profile_picture_url', to_jsonb(p)->>'avatar_url', ''),
      'site_scope', coalesce(to_jsonb(p)->>'site_scope', v_scope),
      'source', 'players'
    ) order by coalesce(nullif(to_jsonb(p)->>'display_name', ''), nullif(to_jsonb(p)->>'player_name', ''), nullif(to_jsonb(p)->>'name', ''))), '[]'::jsonb)
      into v_players
      from public.players p
     where coalesce(to_jsonb(p)->>'site_scope', v_scope) = v_scope
       and coalesce(to_jsonb(p)->>'deactivated_at', '') = ''
       and coalesce(to_jsonb(p)->>'deleted_at', '') = '';
  end if;

  if v_players = '[]'::jsonb and to_regclass('public.allowed_usernames') is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', au.id,
      'player_id', au.player_id,
      'player_name', coalesce(nullif(au.display_name, ''), nullif(au.username, ''), au.slug),
      'display_name', coalesce(nullif(au.display_name, ''), nullif(au.username, ''), au.slug),
      'avatar_url', '',
      'profile_picture_url', '',
      'site_scope', coalesce(au.site_scope, v_scope),
      'source', 'allowed_usernames'
    ) order by coalesce(nullif(au.display_name, ''), nullif(au.username, ''), au.slug)), '[]'::jsonb)
      into v_players
      from public.allowed_usernames au
     where coalesce(au.site_scope, v_scope) = v_scope
       and lower(coalesce(au.status, 'available')) in ('active','available','claimed','reserved');
  end if;

  return jsonb_build_object('ok', true, 'site_scope', v_scope, 'players', v_players, 'items', v_players, 'names', (
    select coalesce(jsonb_agg(x->>'display_name'), '[]'::jsonb)
      from jsonb_array_elements(v_players) x
     where nullif(x->>'display_name', '') is not null
  ));
end;
$fn$;

grant execute on function public.get_public_state(text) to anon, authenticated;
grant execute on function public.get_player_site_announcements_scoped(text) to anon, authenticated;
grant execute on function public.get_scope_hardening_bundle_v672(text, text) to anon, authenticated;
grant execute on function public.get_beerpong_phase_bundle_v661(text) to anon, authenticated;
grant execute on function public.get_game_group_a_bundle_v661(text) to anon, authenticated;
grant execute on function public.get_all_site_players_public_scoped(text) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
