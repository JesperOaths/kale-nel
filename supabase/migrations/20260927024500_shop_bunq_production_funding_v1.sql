begin;

create table if not exists public.shop_bunq_production_settings_v1 (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  api_context_ready boolean not null default false,
  bunq_user_id bigint,
  selected_account_id bigint,
  selected_account_description text,
  selected_account_iban_masked text,
  selected_card_id bigint,
  selected_card_label text,
  selected_card_last4 text,
  selected_card_type text,
  printify_default_card_confirmed boolean not null default false,
  connected_at timestamptz,
  last_checked_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

alter table public.shop_bunq_production_settings_v1 enable row level security;
revoke all on table public.shop_bunq_production_settings_v1 from public, anon, authenticated;
grant select, insert, update, delete on table public.shop_bunq_production_settings_v1 to service_role;

insert into public.shop_bunq_production_settings_v1(id)
values (1)
on conflict (id) do nothing;

create table if not exists public.shop_bunq_production_events_v1 (
  id bigserial primary key,
  order_id uuid references public.shop_orders(id) on delete set null,
  action text not null,
  ok boolean not null default true,
  bunq_account_id bigint,
  bunq_card_id bigint,
  bunq_balance_eur numeric(14,2),
  detail text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.shop_bunq_production_events_v1 enable row level security;
revoke all on table public.shop_bunq_production_events_v1 from public, anon, authenticated;
grant select, insert, update, delete on table public.shop_bunq_production_events_v1 to service_role;

alter table public.shop_orders
  add column if not exists production_funding_preflight_at timestamptz,
  add column if not exists production_funding_snapshot jsonb;

create or replace function public.shop_bunq_get_secret_v1(secret_name_input text)
returns text
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'vault'
as $$
declare
  allowed constant text[] := array[
    'kalenel_bunq_api_key',
    'kalenel_bunq_private_key',
    'kalenel_bunq_public_key',
    'kalenel_bunq_installation_token',
    'kalenel_bunq_server_public_key'
  ];
  result_value text;
begin
  if not (secret_name_input = any(allowed)) then
    raise exception 'bunq_secret_name_not_allowed';
  end if;
  select nullif(btrim(ds.decrypted_secret), '')
    into result_value
  from vault.decrypted_secrets ds
  where ds.name = secret_name_input
  order by ds.updated_at desc nulls last, ds.created_at desc
  limit 1;
  return result_value;
end;
$$;

revoke all on function public.shop_bunq_get_secret_v1(text) from public, anon, authenticated;
grant execute on function public.shop_bunq_get_secret_v1(text) to service_role;

create or replace function public.shop_bunq_set_secret_v1(secret_name_input text, secret_value_input text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'vault'
as $$
declare
  allowed constant text[] := array[
    'kalenel_bunq_api_key',
    'kalenel_bunq_private_key',
    'kalenel_bunq_public_key',
    'kalenel_bunq_installation_token',
    'kalenel_bunq_server_public_key'
  ];
  existing_id uuid;
begin
  if not (secret_name_input = any(allowed)) then
    raise exception 'bunq_secret_name_not_allowed';
  end if;
  if secret_value_input is null or btrim(secret_value_input) = '' then
    raise exception 'bunq_secret_value_empty';
  end if;

  select ds.id into existing_id
  from vault.decrypted_secrets ds
  where ds.name = secret_name_input
  order by ds.updated_at desc nulls last, ds.created_at desc
  limit 1;

  if existing_id is null then
    perform vault.create_secret(secret_value_input, secret_name_input, 'Kalenel bunq production funding credential');
  else
    perform vault.update_secret(existing_id, secret_value_input, secret_name_input, 'Kalenel bunq production funding credential');
  end if;
end;
$$;

revoke all on function public.shop_bunq_set_secret_v1(text,text) from public, anon, authenticated;
grant execute on function public.shop_bunq_set_secret_v1(text,text) to service_role;


create index if not exists shop_bunq_production_events_v1_order_id_idx
  on public.shop_bunq_production_events_v1(order_id);

revoke all on sequence public.shop_bunq_production_events_v1_id_seq from public, anon, authenticated;
grant usage, select on sequence public.shop_bunq_production_events_v1_id_seq to service_role;

drop policy if exists shop_bunq_production_settings_service_only on public.shop_bunq_production_settings_v1;
create policy shop_bunq_production_settings_service_only
  on public.shop_bunq_production_settings_v1
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists shop_bunq_production_events_service_only on public.shop_bunq_production_events_v1;
create policy shop_bunq_production_events_service_only
  on public.shop_bunq_production_events_v1
  for all
  to service_role
  using (true)
  with check (true);

commit;
