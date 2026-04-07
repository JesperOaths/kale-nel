begin;

-- Core scope columns.
do $do$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='players') then
    execute 'alter table public.players add column if not exists site_scope text not null default ''friends''';
  end if;
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='allowed_usernames') then
    execute 'alter table public.allowed_usernames add column if not exists site_scope text not null default ''friends''';
  end if;
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='claim_requests') then
    execute 'alter table public.claim_requests add column if not exists site_scope text not null default ''friends''';
  end if;
end
$do$;

-- Move the named family users into family scope where present.
update public.players
set site_scope='family'
where lower(display_name) in ('jesper','emil','anouk','lilian','sierk','gunnar');

update public.allowed_usernames
set site_scope='family'
where lower(trim(coalesce(display_name,''))) in ('jesper','emil','anouk','lilian','sierk','gunnar');

update public.claim_requests
set site_scope='family'
where lower(trim(coalesce(desired_name,''))) in ('jesper','emil','anouk','lilian','sierk','gunnar');

-- Keep claim_requests in sync when requester_meta contains site_scope.
create or replace function public._apply_claim_request_site_scope()
returns trigger
language plpgsql
set search_path to 'public'
as $fn$
begin
  if NEW.site_scope is null or trim(NEW.site_scope) = '' then
    NEW.site_scope := lower(coalesce(NEW.requester_meta->>'site_scope','friends'));
  end if;
  if NEW.site_scope not in ('friends','family') then
    NEW.site_scope := 'friends';
  end if;
  return NEW;
end;
$fn$;

drop trigger if exists trg_claim_requests_site_scope on public.claim_requests;
create trigger trg_claim_requests_site_scope
before insert or update on public.claim_requests
for each row execute function public._apply_claim_request_site_scope();

-- Keep allowed usernames aligned with the latest claim scope when possible.
create or replace function public._sync_allowed_username_site_scope()
returns trigger
language plpgsql
set search_path to 'public'
as $fn$
begin
  update public.allowed_usernames au
  set site_scope = NEW.site_scope
  where lower(trim(coalesce(au.display_name,''))) = lower(trim(coalesce(NEW.desired_name,'')));
  return NEW;
end;
$fn$;

drop trigger if exists trg_claim_requests_site_scope_after on public.claim_requests;
create trigger trg_claim_requests_site_scope_after
after insert or update on public.claim_requests
for each row execute function public._sync_allowed_username_site_scope();

-- Scoped name list helper for future use.
drop function if exists public.get_login_names_scoped(text);
create or replace function public.get_login_names_scoped(site_scope_input text default 'friends')
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
  with src as (
    select distinct
      trim(coalesce(au.display_name, p.display_name)) as display_name,
      lower(trim(coalesce(au.display_name, p.display_name))) as sort_name,
      lower(coalesce(p.site_scope, au.site_scope, 'friends')) as site_scope
    from public.allowed_usernames au
    left join public.players p on p.id = au.player_id
    where coalesce(trim(coalesce(au.display_name, p.display_name)), '') <> ''
      and lower(coalesce(au.status, '')) not in ('retired', 'deleted', 'blocked', 'suspended')
      and (
        au.player_id is not null
        or lower(coalesce(au.status, '')) in ('active', 'claimed', 'approved_pending_activation')
      )
  )
  select jsonb_build_object(
    'names', coalesce(jsonb_agg(display_name order by sort_name), '[]'::jsonb)
  )
  from src
  where site_scope = lower(coalesce(nullif(trim(site_scope_input),''),'friends'));
$fn$;

grant execute on function public.get_login_names_scoped(text) to anon, authenticated;

-- Scoped public profile helper for future/family pages.
drop function if exists public.get_player_profiles_public_scoped(text);
create or replace function public.get_player_profiles_public_scoped(site_scope_input text default 'friends')
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
with base as (
  select jsonb_array_elements(coalesce((public.get_player_profiles_public()->'players'),'[]'::jsonb)) as item
), filtered as (
  select item
  from base
  where lower(coalesce(
    (select p.site_scope from public.players p where lower(p.display_name)=lower(coalesce(item->>'player_name', item->>'display_name', item->>'chosen_username', item->>'public_display_name')) limit 1),
    'friends'
  )) = lower(coalesce(nullif(trim(site_scope_input),''),'friends'))
)
select jsonb_build_object('players', coalesce(jsonb_agg(item), '[]'::jsonb)) from filtered;
$fn$;

grant execute on function public.get_player_profiles_public_scoped(text) to anon, authenticated;

commit;
