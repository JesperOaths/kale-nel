alter table public.shop_orders
  add column if not exists notification_error text null,
  add column if not exists notification_error_at timestamptz null;

update public.shop_orders
set notification_error = last_error,
    notification_error_at = coalesce(updated_at, now()),
    last_error = null,
    updated_at = now()
where last_error ilike 'Resend %';
