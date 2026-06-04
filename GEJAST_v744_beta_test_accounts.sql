-- GEJAST v744: beta live-write test accounts.
-- Creates/repairs Beta1, Beta2, Beta3, and Beta4 with PIN 1234 so the
-- controlled beta write harness can run drinks, two-player secondary games,
-- and four-player Klaverjas without touching real player accounts.

begin;

create extension if not exists pgcrypto;

alter table if exists public.allowed_usernames
  add column if not exists slug text,
  add column if not exists has_pin boolean not null default false,
  add column if not exists pin_is_set boolean not null default false,
  add column if not exists activated boolean not null default false,
  add column if not exists is_active boolean not null default false,
  add column if not exists site_scope text not null default 'friends';

do $$
declare
  v_scope text := 'friends';
  v_pin text := '1234';
  v_name text;
  v_player_id bigint;
begin
  foreach v_name in array array['Beta1', 'Beta2', 'Beta3', 'Beta4']
  loop
    select p.id
      into v_player_id
      from public.players p
     where lower(trim(coalesce(p.display_name, ''))) = lower(v_name)
     order by p.id
     limit 1;

    if v_player_id is null then
      insert into public.players(display_name, pin_hash, active, approved, site_scope, created_at, updated_at)
      values (v_name, public._gejast_hash_secret_v691(v_pin), true, true, v_scope, now(), now())
      returning id into v_player_id;
    else
      update public.players
         set pin_hash = public._gejast_hash_secret_v691(v_pin),
             active = true,
             approved = true,
             site_scope = v_scope,
             updated_at = now()
       where id = v_player_id;
    end if;

    if to_regclass('public.allowed_usernames') is not null then
      insert into public.allowed_usernames(
        username,
        display_name,
        status,
        player_id,
        slug,
        site_scope,
        has_pin,
        pin_is_set,
        activated,
        is_active,
        created_at,
        updated_at
      )
      values (
        lower(v_name),
        v_name,
        'active',
        v_player_id,
        lower(v_name),
        v_scope,
        true,
        true,
        true,
        true,
        now(),
        now()
      )
      on conflict (username)
      do update set
        display_name = excluded.display_name,
        status = 'active',
        player_id = excluded.player_id,
        slug = excluded.slug,
        site_scope = excluded.site_scope,
        has_pin = true,
        pin_is_set = true,
        activated = true,
        is_active = true,
        updated_at = now();
    end if;
  end loop;
end $$;

create or replace function public.verify_beta_test_accounts_v744()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'display_name', p.display_name,
    'active', p.active,
    'approved', p.approved,
    'site_scope', coalesce(p.site_scope, 'friends'),
    'has_pin', p.pin_hash is not null
  ) order by p.display_name), '[]'::jsonb)
    into v_rows
    from public.players p
   where lower(trim(coalesce(p.display_name, ''))) in ('beta1', 'beta2', 'beta3', 'beta4');

  return jsonb_build_object('ok', true, 'accounts', v_rows);
end;
$fn$;

grant execute on function public.verify_beta_test_accounts_v744() to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
