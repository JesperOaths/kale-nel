-- v816: keep the live Printify/Shopify catalog refresh window short without duplicating upstream secrets.
-- The Edge Function remains the only upstream fetch owner. This trigger clamps the function's
-- persisted refresh eligibility to two minutes after success and 30 seconds after a recorded error.

create or replace function public.clamp_shop_catalog_refresh_v816()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.next_refresh_at is not null then
    if new.last_error is not null then
      new.next_refresh_at := least(new.next_refresh_at, now() + interval '30 seconds');
    else
      new.next_refresh_at := least(new.next_refresh_at, now() + interval '2 minutes');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_shop_catalog_fast_refresh_v816 on public.shop_catalog_sync_state;
create trigger trg_shop_catalog_fast_refresh_v816
before insert or update of next_refresh_at, last_error
on public.shop_catalog_sync_state
for each row
execute function public.clamp_shop_catalog_refresh_v816();

update public.shop_catalog_sync_state
set next_refresh_at = now()
where id = 1;
