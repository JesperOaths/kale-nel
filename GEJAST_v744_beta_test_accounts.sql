-- GEJAST v744: beta live-write test accounts.
-- Creates/repairs Beta1, Beta2, Beta3, and Beta4 with PIN 1234 so the
-- controlled beta write harness can run drinks, two-player secondary games,
-- and four-player Klaverjas without touching real player accounts.

begin;

create extension if not exists pgcrypto;

alter table if exists public.players
  add column if not exists slug text,
  add column if not exists pin_hash text,
  add column if not exists active boolean not null default false,
  add column if not exists approved boolean not null default false,
  add column if not exists site_scope text not null default 'friends',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create or replace function public._gejast_hash_secret_v691(secret_input text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_hash text;
begin
  if nullif(secret_input, '') is null then
    raise exception 'secret_required';
  end if;

  if to_regprocedure('extensions.crypt(text,text)') is not null
     and to_regprocedure('extensions.gen_salt(text)') is not null then
    execute 'select extensions.crypt($1, extensions.gen_salt(''bf''))' into v_hash using secret_input;
    return v_hash;
  elsif to_regprocedure('public.crypt(text,text)') is not null
     and to_regprocedure('public.gen_salt(text)') is not null then
    execute 'select public.crypt($1, public.gen_salt(''bf''))' into v_hash using secret_input;
    return v_hash;
  end if;

  return 'md5:' || md5(secret_input || ':' || current_database());
end
$fn$;

create or replace function public._gejast_secret_matches_v691(secret_input text, stored_hash text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_check text;
begin
  if nullif(stored_hash, '') is null then
    return false;
  end if;

  if stored_hash like 'md5:%' then
    return stored_hash = ('md5:' || md5(coalesce(secret_input, '') || ':' || current_database()));
  end if;

  if to_regprocedure('extensions.crypt(text,text)') is not null then
    execute 'select extensions.crypt($1, $2)' into v_check using coalesce(secret_input, ''), stored_hash;
    return v_check = stored_hash;
  elsif to_regprocedure('public.crypt(text,text)') is not null then
    execute 'select public.crypt($1, $2)' into v_check using coalesce(secret_input, ''), stored_hash;
    return v_check = stored_hash;
  end if;

  return false;
end
$fn$;

alter table if exists public.allowed_usernames
  add column if not exists slug text,
  add column if not exists has_pin boolean not null default false,
  add column if not exists pin_is_set boolean not null default false,
  add column if not exists activated boolean not null default false,
  add column if not exists is_active boolean not null default false,
  add column if not exists site_scope text not null default 'friends',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
declare
  v_scope text := 'friends';
  v_pin text := '1234';
  v_hash text;
  v_name text;
  v_slug text;
  v_player_id bigint;
  v_allowed_exists boolean;
  v_cols text[];
  v_vals text[];
  v_sets text[];
begin
  foreach v_name in array array['Beta1', 'Beta2', 'Beta3', 'Beta4']
  loop
    v_slug := lower(v_name);
    v_hash := public._gejast_hash_secret_v691(v_pin);

    execute $sql$
      select p.id
        from public.players p
       where lower(trim(coalesce(to_jsonb(p)->>'display_name', to_jsonb(p)->>'username', to_jsonb(p)->>'slug', ''))) = lower($1)
       order by p.id
       limit 1
    $sql$
      into v_player_id
      using v_name;

    v_cols := array[]::text[];
    v_vals := array[]::text[];
    v_sets := array[]::text[];

    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'players' and column_name = 'display_name') then
      v_cols := array_append(v_cols, 'display_name');
      v_vals := array_append(v_vals, format('%L', v_name));
      v_sets := array_append(v_sets, format('%I = %L', 'display_name', v_name));
    end if;

    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'players' and column_name = 'username') then
      v_cols := array_append(v_cols, 'username');
      v_vals := array_append(v_vals, format('%L', v_slug));
      v_sets := array_append(v_sets, format('%I = %L', 'username', v_slug));
    end if;

    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'players' and column_name = 'slug') then
      v_cols := array_append(v_cols, 'slug');
      v_vals := array_append(v_vals, format('%L', v_slug));
      v_sets := array_append(v_sets, format('%I = %L', 'slug', v_slug));
    end if;

    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'players' and column_name = 'pin_hash') then
      v_cols := array_append(v_cols, 'pin_hash');
      v_vals := array_append(v_vals, format('%L', v_hash));
      v_sets := array_append(v_sets, format('%I = %L', 'pin_hash', v_hash));
    end if;

    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'players' and column_name = 'active') then
      v_cols := array_append(v_cols, 'active');
      v_vals := array_append(v_vals, 'true');
      v_sets := array_append(v_sets, format('%I = true', 'active'));
    end if;

    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'players' and column_name = 'approved') then
      v_cols := array_append(v_cols, 'approved');
      v_vals := array_append(v_vals, 'true');
      v_sets := array_append(v_sets, format('%I = true', 'approved'));
    end if;

    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'players' and column_name = 'site_scope') then
      v_cols := array_append(v_cols, 'site_scope');
      v_vals := array_append(v_vals, format('%L', v_scope));
      v_sets := array_append(v_sets, format('%I = %L', 'site_scope', v_scope));
    end if;

    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'players' and column_name = 'created_at') then
      v_cols := array_append(v_cols, 'created_at');
      v_vals := array_append(v_vals, 'now()');
    end if;

    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'players' and column_name = 'updated_at') then
      v_cols := array_append(v_cols, 'updated_at');
      v_vals := array_append(v_vals, 'now()');
      v_sets := array_append(v_sets, format('%I = now()', 'updated_at'));
    end if;

    if v_player_id is null then
      execute format(
        'insert into public.players(%s) values (%s) returning id',
        array_to_string(v_cols, ', '),
        array_to_string(v_vals, ', ')
      )
        into v_player_id;
    elsif coalesce(array_length(v_sets, 1), 0) > 0 then
      execute format(
        'update public.players set %s where id = %s',
        array_to_string(v_sets, ', '),
        v_player_id
      );
    end if;

    if to_regclass('public.allowed_usernames') is not null
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'allowed_usernames' and column_name = 'username') then
      v_cols := array[]::text[];
      v_vals := array[]::text[];
      v_sets := array[]::text[];

      v_cols := array_append(v_cols, 'username');
      v_vals := array_append(v_vals, format('%L', v_slug));

      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'allowed_usernames' and column_name = 'display_name') then
        v_cols := array_append(v_cols, 'display_name');
        v_vals := array_append(v_vals, format('%L', v_name));
        v_sets := array_append(v_sets, format('%I = %L', 'display_name', v_name));
      end if;

      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'allowed_usernames' and column_name = 'status') then
        v_cols := array_append(v_cols, 'status');
        v_vals := array_append(v_vals, quote_literal('active'));
        v_sets := array_append(v_sets, format('%I = %L', 'status', 'active'));
      end if;

      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'allowed_usernames' and column_name = 'player_id') then
        v_cols := array_append(v_cols, 'player_id');
        v_vals := array_append(v_vals, v_player_id::text);
        v_sets := array_append(v_sets, format('%I = %s', 'player_id', v_player_id));
      end if;

      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'allowed_usernames' and column_name = 'slug') then
        v_cols := array_append(v_cols, 'slug');
        v_vals := array_append(v_vals, format('%L', v_slug));
        v_sets := array_append(v_sets, format('%I = %L', 'slug', v_slug));
      end if;

      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'allowed_usernames' and column_name = 'site_scope') then
        v_cols := array_append(v_cols, 'site_scope');
        v_vals := array_append(v_vals, format('%L', v_scope));
        v_sets := array_append(v_sets, format('%I = %L', 'site_scope', v_scope));
      end if;

      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'allowed_usernames' and column_name = 'has_pin') then
        v_cols := array_append(v_cols, 'has_pin');
        v_vals := array_append(v_vals, 'true');
        v_sets := array_append(v_sets, format('%I = true', 'has_pin'));
      end if;

      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'allowed_usernames' and column_name = 'pin_is_set') then
        v_cols := array_append(v_cols, 'pin_is_set');
        v_vals := array_append(v_vals, 'true');
        v_sets := array_append(v_sets, format('%I = true', 'pin_is_set'));
      end if;

      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'allowed_usernames' and column_name = 'activated') then
        v_cols := array_append(v_cols, 'activated');
        v_vals := array_append(v_vals, 'true');
        v_sets := array_append(v_sets, format('%I = true', 'activated'));
      end if;

      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'allowed_usernames' and column_name = 'is_active') then
        v_cols := array_append(v_cols, 'is_active');
        v_vals := array_append(v_vals, 'true');
        v_sets := array_append(v_sets, format('%I = true', 'is_active'));
      end if;

      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'allowed_usernames' and column_name = 'created_at') then
        v_cols := array_append(v_cols, 'created_at');
        v_vals := array_append(v_vals, 'now()');
      end if;

      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'allowed_usernames' and column_name = 'updated_at') then
        v_cols := array_append(v_cols, 'updated_at');
        v_vals := array_append(v_vals, 'now()');
        v_sets := array_append(v_sets, format('%I = now()', 'updated_at'));
      end if;

      if coalesce(array_length(v_sets, 1), 0) > 0 then
        execute 'update public.allowed_usernames set ' || array_to_string(v_sets, ', ') || ' where lower(username) = lower($1)'
          using v_slug;
        v_allowed_exists := found;
      else
        execute 'select exists(select 1 from public.allowed_usernames where lower(username) = lower($1))'
          into v_allowed_exists
          using v_slug;
      end if;

      if not coalesce(v_allowed_exists, false) then
        execute format(
          'insert into public.allowed_usernames(%s) values (%s)',
          array_to_string(v_cols, ', '),
          array_to_string(v_vals, ', ')
        );
      end if;
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
