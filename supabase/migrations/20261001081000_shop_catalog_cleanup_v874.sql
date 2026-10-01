-- v874 shop/admin cleanup: reconcile catalog drift history and retire stale Shopify sync authority.
-- Historical drift rows are preserved as evidence; unresolved is reserved for the latest transition only.

update public.shop_catalog_drift_v847
set resolved_at = now()
where resolved_at is null;

update public.shop_catalog_sync_state s
set last_sync_started_at = null,
    last_synced_at = coalesce(c.generated_at, now()),
    next_refresh_at = null,
    last_error = c.last_error,
    product_count = coalesce(jsonb_array_length(c.payload -> 'products'), 0),
    shop_count = case
      when jsonb_typeof(c.payload -> 'shops') = 'array' then jsonb_array_length(c.payload -> 'shops')
      when c.payload ? 'shop' and c.payload -> 'shop' is not null then 1
      else 0
    end,
    last_source = 'printify'
from public.shop_catalog_cache_v828 c
where s.id = 1 and c.id = 1;

comment on table public.shop_catalog_sync_state is
  'Legacy catalog-sync compatibility projection. Authoritative storefront catalog state is public.shop_catalog_cache_v828, refreshed by shop-catalog-v828. This row must not be treated as a second Shopify scheduler.';

comment on table public.shop_catalog_drift_v847 is
  'Catalog transition history. resolved_at marks transitions superseded or confirmed stable; only the newest detected transition may remain unresolved until the next stable catalog check.';
