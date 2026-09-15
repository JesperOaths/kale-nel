create table if not exists public.shop_fulfillment_mappings (
  approval_id text primary key,
  approved boolean not null default false,
  countries text[] not null,
  source_product_id text not null,
  source_variant_id bigint not null,
  source_blueprint_id bigint not null,
  source_print_provider_id bigint not null,
  target_product_id text not null,
  target_variant_id bigint not null,
  target_blueprint_id bigint not null,
  target_print_provider_id bigint not null,
  estimated_import_cents_per_unit integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shop_fulfillment_mappings_approval_id_check check (approval_id ~ '^[A-Za-z0-9_-]{3,100}$'),
  constraint shop_fulfillment_mappings_countries_check check (cardinality(countries) > 0),
  constraint shop_fulfillment_mappings_source_product_check check (source_product_id ~ '^[A-Za-z0-9_-]{8,80}$'),
  constraint shop_fulfillment_mappings_target_product_check check (target_product_id ~ '^[A-Za-z0-9_-]{8,80}$'),
  constraint shop_fulfillment_mappings_source_ids_check check (source_variant_id > 0 and source_blueprint_id > 0 and source_print_provider_id > 0),
  constraint shop_fulfillment_mappings_target_ids_check check (target_variant_id > 0 and target_blueprint_id > 0 and target_print_provider_id > 0),
  constraint shop_fulfillment_mappings_import_check check (estimated_import_cents_per_unit >= 0),
  constraint shop_fulfillment_mappings_changes_route_check check (source_product_id <> target_product_id or source_variant_id <> target_variant_id)
);

alter table public.shop_fulfillment_mappings enable row level security;
revoke all on table public.shop_fulfillment_mappings from anon, authenticated;
grant select, insert, update, delete on table public.shop_fulfillment_mappings to service_role;

create index if not exists shop_fulfillment_mappings_approved_idx
  on public.shop_fulfillment_mappings (approved)
  where approved = true;
create index if not exists shop_fulfillment_mappings_source_idx
  on public.shop_fulfillment_mappings (source_product_id, source_variant_id)
  where approved = true;
create index if not exists shop_fulfillment_mappings_countries_gin
  on public.shop_fulfillment_mappings using gin (countries);

alter table public.shop_orders
  add column if not exists fulfillment_estimated_import_cents integer not null default 0,
  add column if not exists fulfillment_provider_groups integer not null default 1,
  add column if not exists fulfillment_score_cents integer;

alter table public.shop_orders
  drop constraint if exists shop_orders_fulfillment_estimated_import_cents_check,
  add constraint shop_orders_fulfillment_estimated_import_cents_check check (fulfillment_estimated_import_cents >= 0),
  drop constraint if exists shop_orders_fulfillment_provider_groups_check,
  add constraint shop_orders_fulfillment_provider_groups_check check (fulfillment_provider_groups >= 1),
  drop constraint if exists shop_orders_fulfillment_score_cents_check,
  add constraint shop_orders_fulfillment_score_cents_check check (fulfillment_score_cents is null or fulfillment_score_cents >= 0);

comment on table public.shop_fulfillment_mappings is 'Server-only approved exact Printify regional fulfillment substitutions for Kalenel shop routing.';
comment on column public.shop_fulfillment_mappings.estimated_import_cents_per_unit is 'Explicit conservative import/duty allowance per unit in cents. Zero means no verified allowance is applied.';
comment on column public.shop_orders.fulfillment_provider_groups is 'Coarse count of distinct Printify provider IDs in the selected route; Printify Choice may still internally split fulfillment.';
comment on column public.shop_orders.fulfillment_score_cents is 'Internal route score: production cost plus live shipping plus configured import allowance; not the customer-facing total.';
