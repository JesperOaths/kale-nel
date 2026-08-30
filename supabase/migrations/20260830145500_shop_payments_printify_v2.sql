begin;

create extension if not exists pgcrypto;

create table if not exists public.shop_products (
  printify_product_id text primary key,
  title text not null,
  description text,
  currency text not null default 'eur' check (currency ~ '^[a-z]{3}$'),
  storefront_price_cents integer not null check (storefront_price_cents > 0),
  storefront_sizes text[] not null default '{}'::text[],
  active boolean not null default true,
  source_catalog_generated_at timestamptz,
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
  storefront_price_cents integer not null check (storefront_price_cents > 0),
  printify_retail_price_cents integer check (printify_retail_price_cents is null or printify_retail_price_cents >= 0),
  printify_cost_cents integer check (printify_cost_cents is null or printify_cost_cents >= 0),
  enabled boolean not null default true,
  available boolean not null default true,
  selected_for_storefront boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (printify_product_id, printify_variant_id)
);

create unique index if not exists shop_variants_one_storefront_variant_per_size_idx
  on public.shop_variants (printify_product_id, upper(size))
  where selected_for_storefront = true and enabled = true and available = true and size is not null;

create index if not exists shop_variants_checkout_lookup_idx
  on public.shop_variants (printify_product_id, upper(size))
  where selected_for_storefront = true and enabled = true and available = true;

create table if not exists public.shop_orders (
  id uuid primary key default gen_random_uuid(),
  status_token_hash text not null,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  payment_status text not null default 'checkout_pending'
    check (payment_status in ('checkout_pending','checkout_open','checkout_failed','processing','paid','failed','expired','refunded')),
  fulfillment_status text not null default 'pending'
    check (fulfillment_status in ('pending','fulfillment_claimed','printify_created','production_submitted','in_production','shipped','delivered','cancelled','needs_attention')),
  fulfillment_claimed_at timestamptz,
  fulfillment_claim_event_id text,
  currency text not null default 'eur' check (currency ~ '^[a-z]{3}$'),
  amount_subtotal_cents integer not null default 0 check (amount_subtotal_cents >= 0),
  shipping_amount_cents integer not null default 0 check (shipping_amount_cents >= 0),
  amount_total_cents integer not null default 0 check (amount_total_cents >= 0),
  shipping_method integer not null default 1 check (shipping_method in (1,2,3,4)),
  customer_email text,
  customer_name text,
  customer_phone text,
  shipping_address jsonb,
  printify_order_id text unique,
  printify_status text,
  tracking jsonb not null default '[]'::jsonb,
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
  quantity integer not null check (quantity > 0 and quantity <= 10),
  unit_amount_cents integer not null check (unit_amount_cents > 0),
  created_at timestamptz not null default now(),
  foreign key (printify_product_id, printify_variant_id)
    references public.shop_variants(printify_product_id, printify_variant_id)
);

create table if not exists public.shop_webhook_events (
  provider text not null check (provider in ('stripe','printify')),
  event_id text not null,
  event_type text not null,
  status text not null default 'processing' check (status in ('processing','processed','error')),
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  primary key (provider, event_id)
);

create index if not exists shop_orders_payment_status_idx
  on public.shop_orders (payment_status, created_at desc);
create index if not exists shop_orders_fulfillment_status_idx
  on public.shop_orders (fulfillment_status, created_at desc);
create index if not exists shop_orders_printify_order_idx
  on public.shop_orders (printify_order_id) where printify_order_id is not null;
create index if not exists shop_order_items_order_id_idx
  on public.shop_order_items (order_id);

create or replace function public.shop_set_updated_at_v2()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.shop_set_updated_at_v2() from public, anon, authenticated;
grant execute on function public.shop_set_updated_at_v2() to service_role;

drop trigger if exists shop_products_set_updated_at_v2 on public.shop_products;
create trigger shop_products_set_updated_at_v2
before update on public.shop_products
for each row execute function public.shop_set_updated_at_v2();

drop trigger if exists shop_variants_set_updated_at_v2 on public.shop_variants;
create trigger shop_variants_set_updated_at_v2
before update on public.shop_variants
for each row execute function public.shop_set_updated_at_v2();

drop trigger if exists shop_orders_set_updated_at_v2 on public.shop_orders;
create trigger shop_orders_set_updated_at_v2
before update on public.shop_orders
for each row execute function public.shop_set_updated_at_v2();

alter table public.shop_products enable row level security;
alter table public.shop_variants enable row level security;
alter table public.shop_orders enable row level security;
alter table public.shop_order_items enable row level security;
alter table public.shop_webhook_events enable row level security;

revoke all on table public.shop_products from public, anon, authenticated;
revoke all on table public.shop_variants from public, anon, authenticated;
revoke all on table public.shop_orders from public, anon, authenticated;
revoke all on table public.shop_order_items from public, anon, authenticated;
revoke all on table public.shop_webhook_events from public, anon, authenticated;

grant all on table public.shop_products to service_role;
grant all on table public.shop_variants to service_role;
grant all on table public.shop_orders to service_role;
grant all on table public.shop_order_items to service_role;
grant all on table public.shop_webhook_events to service_role;

commit;
