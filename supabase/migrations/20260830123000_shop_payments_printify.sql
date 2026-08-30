begin;

create extension if not exists pgcrypto;

create table if not exists public.shop_products (
  printify_product_id text primary key,
  title text not null,
  description text,
  active boolean not null default true,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shop_variants (
  printify_product_id text not null references public.shop_products(printify_product_id) on delete cascade,
  printify_variant_id bigint not null,
  title text not null,
  size text,
  color text,
  sku text,
  retail_price_cents integer not null check (retail_price_cents >= 0),
  enabled boolean not null default true,
  available boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (printify_product_id, printify_variant_id)
);

create table if not exists public.shop_orders (
  id uuid primary key default gen_random_uuid(),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  payment_status text not null default 'checkout_pending',
  fulfillment_status text not null default 'pending',
  currency text not null default 'eur',
  amount_subtotal_cents integer not null default 0 check (amount_subtotal_cents >= 0),
  shipping_amount_cents integer not null default 0 check (shipping_amount_cents >= 0),
  amount_total_cents integer not null default 0 check (amount_total_cents >= 0),
  customer_email text,
  customer_name text,
  customer_phone text,
  shipping_address jsonb,
  printify_order_id text unique,
  printify_status text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  fulfilled_at timestamptz
);

create table if not exists public.shop_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.shop_orders(id) on delete cascade,
  printify_product_id text not null,
  printify_variant_id bigint not null,
  title text not null,
  size text,
  color text,
  quantity integer not null check (quantity > 0 and quantity <= 25),
  unit_amount_cents integer not null check (unit_amount_cents >= 0),
  created_at timestamptz not null default now(),
  foreign key (printify_product_id, printify_variant_id)
    references public.shop_variants(printify_product_id, printify_variant_id)
);

create table if not exists public.shop_webhook_events (
  provider text not null,
  event_id text not null,
  event_type text not null,
  status text not null default 'processing',
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  primary key (provider, event_id)
);

create index if not exists shop_variants_lookup_idx
  on public.shop_variants (printify_product_id, lower(size))
  where enabled = true and available = true;
create index if not exists shop_orders_payment_status_idx
  on public.shop_orders (payment_status, created_at desc);
create index if not exists shop_orders_fulfillment_status_idx
  on public.shop_orders (fulfillment_status, created_at desc);
create index if not exists shop_order_items_order_id_idx
  on public.shop_order_items (order_id);

create or replace function public.shop_set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.shop_set_updated_at() from public, anon, authenticated;
grant execute on function public.shop_set_updated_at() to service_role;

drop trigger if exists shop_products_set_updated_at on public.shop_products;
create trigger shop_products_set_updated_at
before update on public.shop_products
for each row execute function public.shop_set_updated_at();

drop trigger if exists shop_variants_set_updated_at on public.shop_variants;
create trigger shop_variants_set_updated_at
before update on public.shop_variants
for each row execute function public.shop_set_updated_at();

drop trigger if exists shop_orders_set_updated_at on public.shop_orders;
create trigger shop_orders_set_updated_at
before update on public.shop_orders
for each row execute function public.shop_set_updated_at();

alter table public.shop_products enable row level security;
alter table public.shop_variants enable row level security;
alter table public.shop_orders enable row level security;
alter table public.shop_order_items enable row level security;
alter table public.shop_webhook_events enable row level security;

revoke all on table public.shop_products from anon, authenticated;
revoke all on table public.shop_variants from anon, authenticated;
revoke all on table public.shop_orders from anon, authenticated;
revoke all on table public.shop_order_items from anon, authenticated;
revoke all on table public.shop_webhook_events from anon, authenticated;

grant all on table public.shop_products to service_role;
grant all on table public.shop_variants to service_role;
grant all on table public.shop_orders to service_role;
grant all on table public.shop_order_items to service_role;
grant all on table public.shop_webhook_events to service_role;

commit;
