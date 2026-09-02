-- v815b: generalize the private shop catalog cache so Kalenel can read
-- Printify directly, Shopify Admin, or Shopify Storefront without exposing
-- commerce credentials to the browser.

alter table public.shop_printify_products rename to shop_catalog_products;

alter table public.shop_catalog_products rename column printify_product_id to source_product_id;
alter table public.shop_catalog_products rename column printify_shop_id to source_shop_id;
alter table public.shop_catalog_products alter column source_shop_id type text using source_shop_id::text;
alter table public.shop_catalog_products add column source text not null default 'printify';

alter table public.shop_catalog_products drop constraint shop_printify_products_pkey;
alter table public.shop_catalog_products add constraint shop_catalog_products_pkey primary key (source, source_product_id);
alter table public.shop_catalog_products add constraint shop_catalog_products_source_check check (source in ('printify', 'shopify-admin', 'shopify-storefront'));

alter table public.shop_catalog_products rename constraint shop_printify_products_category_check to shop_catalog_products_category_check;
alter table public.shop_catalog_products rename constraint shop_printify_products_mockups_check to shop_catalog_products_mockups_check;
alter table public.shop_catalog_products rename constraint shop_printify_products_price_check to shop_catalog_products_price_check;
alter table public.shop_catalog_products rename constraint shop_printify_products_price_max_check to shop_catalog_products_price_max_check;
alter table public.shop_catalog_products rename constraint shop_printify_products_variants_check to shop_catalog_products_variants_check;

alter index if exists public.shop_printify_products_category_idx rename to shop_catalog_products_category_idx;

alter trigger shop_printify_products_category_guard_v815 on public.shop_catalog_products rename to shop_catalog_products_category_guard_v815;
alter function public.shop_printify_products_category_guard_v815() rename to shop_catalog_products_category_guard_v815;

alter table public.shop_printify_sync_state rename to shop_catalog_sync_state;
alter table public.shop_catalog_sync_state add column last_source text;
alter table public.shop_catalog_sync_state add constraint shop_catalog_sync_state_last_source_check check (last_source is null or last_source in ('printify', 'shopify-admin', 'shopify-storefront'));

create or replace function public.get_shopify_admin_token_v815b()
returns text
language sql
security definer
set search_path = pg_catalog, public, vault
as $$
  select nullif(btrim(ds.decrypted_secret), '')
  from vault.decrypted_secrets as ds
  where ds.name = 'kalenel_shopify_admin_access_token'
  order by ds.updated_at desc nulls last, ds.created_at desc
  limit 1;
$$;

revoke all on function public.get_shopify_admin_token_v815b() from public, anon, authenticated;
grant execute on function public.get_shopify_admin_token_v815b() to service_role;
