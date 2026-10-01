-- v874b: permanently retire the obsolete shop_catalog_sync_state scheduler semantics.
-- The v828 catalog cache is authoritative. The singleton remains only for old readers/diagnostics.

create or replace function public.guard_legacy_shop_catalog_sync_v874()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    -- Reject any attempt to restore a Shopify authority. Old callers receive a
    -- harmless no-op while the current Printify projection remains intact.
    if coalesce(new.last_source,'') in ('shopify-admin','shopify-storefront') then
      return old;
    end if;
  end if;

  new.next_refresh_at := null;
  new.last_sync_started_at := null;
  new.last_source := 'printify';
  return new;
end;
$$;

drop trigger if exists trg_shop_catalog_fast_refresh_v816 on public.shop_catalog_sync_state;
drop trigger if exists trg_shop_catalog_sync_legacy_guard_v874 on public.shop_catalog_sync_state;
create trigger trg_shop_catalog_sync_legacy_guard_v874
before insert or update
on public.shop_catalog_sync_state
for each row
execute function public.guard_legacy_shop_catalog_sync_v874();

update public.shop_catalog_sync_state s
set last_sync_started_at = null,
    next_refresh_at = null,
    last_source = 'printify'
where s.id = 1;
