-- v815: private Printify catalog cache for kalenel.nl/shop.
-- Public browsers never receive database credentials or the Printify API token;
-- the public shop-catalog Edge Function returns a sanitized projection instead.

create table if not exists public.shop_printify_products (
  printify_product_id text primary key,
  printify_shop_id bigint not null,
  title text not null,
  description text not null default '',
  category text not null check (category in ('classic', 'oversized-boxy')),
  price numeric(12,2) not null default 0 check (price >= 0),
  price_max numeric(12,2) not null default 0 check (price_max >= 0),
  sizes text[] not null default '{}'::text[],
  mockups jsonb not null default '[]'::jsonb check (jsonb_typeof(mockups) = 'array'),
  image text not null default '',
  base_key text not null default '',
  base_label text not null default '',
  variants jsonb not null default '[]'::jsonb check (jsonb_typeof(variants) = 'array'),
  source_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  sync_run_id uuid
);

create index if not exists shop_printify_products_category_idx
  on public.shop_printify_products (category, title);

alter table public.shop_printify_products enable row level security;
revoke all on table public.shop_printify_products from public, anon, authenticated;
grant select, insert, update, delete on table public.shop_printify_products to service_role;

create table if not exists public.shop_printify_sync_state (
  id smallint primary key default 1 check (id = 1),
  last_sync_started_at timestamptz,
  last_synced_at timestamptz,
  next_refresh_at timestamptz,
  last_error text,
  product_count integer not null default 0 check (product_count >= 0),
  shop_count integer not null default 0 check (shop_count >= 0)
);

alter table public.shop_printify_sync_state enable row level security;
revoke all on table public.shop_printify_sync_state from public, anon, authenticated;
grant select, insert, update on table public.shop_printify_sync_state to service_role;

insert into public.shop_printify_sync_state (id)
values (1)
on conflict (id) do nothing;
