begin;

create table if not exists public.shop_catalog_cache_v828 (
  id smallint primary key,
  payload jsonb not null default '{"products": []}'::jsonb,
  generated_at timestamptz,
  refresh_started_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  constraint shop_catalog_cache_v828_id_check check (id = 1)
);

insert into public.shop_catalog_cache_v828 (id)
values (1)
on conflict (id) do nothing;

alter table public.shop_catalog_cache_v828 enable row level security;
revoke all on table public.shop_catalog_cache_v828 from public, anon, authenticated;
grant all privileges on table public.shop_catalog_cache_v828 to service_role;

create or replace function public.set_printify_api_token_v828(
  admin_session_token text,
  api_token text
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'vault'
as $function$
declare
  v_ok boolean := false;
  v_existing_id uuid;
  v_token text := btrim(coalesce(api_token, ''));
begin
  select r.ok into v_ok
  from public._require_valid_admin_session(admin_session_token) as r
  limit 1;

  if not coalesce(v_ok, false) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if length(v_token) < 20 or length(v_token) > 4096 then
    raise exception 'invalid_api_token' using errcode = '22023';
  end if;

  select s.id into v_existing_id
  from vault.secrets as s
  where s.name = 'kalenel_printify_api_token'
  order by s.updated_at desc nulls last, s.created_at desc
  limit 1;

  if v_existing_id is null then
    perform vault.create_secret(v_token, 'kalenel_printify_api_token', 'Kalenel shop production API token');
  else
    perform vault.update_secret(v_existing_id, v_token, 'kalenel_printify_api_token', 'Kalenel shop production API token');
  end if;

  return true;
end;
$function$;

revoke all on function public.set_printify_api_token_v828(text, text) from public, anon, authenticated;
grant execute on function public.set_printify_api_token_v828(text, text) to service_role;

commit;
