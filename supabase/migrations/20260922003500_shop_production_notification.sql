alter table public.shop_orders
  add column if not exists production_notified_at timestamptz;

create index if not exists shop_orders_production_notified_at_idx
  on public.shop_orders (production_notified_at desc)
  where production_notified_at is not null;

comment on column public.shop_orders.production_notified_at is
  'Timestamp when the customer was successfully notified that payment was confirmed and the order entered Printify production.';
