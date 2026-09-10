-- Reconciled repository source for production migration 20260910070905.
-- Prevent duplicate Pending orders when a checkout POST is retried.

alter table public.shop_orders
  add column if not exists checkout_idempotency_key text;

create unique index if not exists shop_orders_checkout_idempotency_key_uidx
  on public.shop_orders (checkout_idempotency_key)
  where checkout_idempotency_key is not null;

comment on column public.shop_orders.checkout_idempotency_key is
  'Opaque browser-generated retry key; repeated checkout requests resolve to the same order.';
