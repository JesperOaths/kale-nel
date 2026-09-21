-- Add explicit unpaid-order rejection lifecycle.
alter table public.shop_orders
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by_admin_id bigint,
  add column if not exists rejection_reason text,
  add column if not exists rejection_notified_at timestamptz;

create index if not exists shop_orders_rejected_at_idx
  on public.shop_orders (rejected_at desc)
  where rejected_at is not null;

comment on column public.shop_orders.rejected_at is
  'Admin rejection timestamp for unpaid/unsubmitted orders.';
comment on column public.shop_orders.rejection_reason is
  'Customer-visible reason recorded when an unpaid/unsubmitted order is rejected.';
comment on column public.shop_orders.rejection_notified_at is
  'Timestamp when the rejection/not-paid email was successfully delivered to the order customer email.';
