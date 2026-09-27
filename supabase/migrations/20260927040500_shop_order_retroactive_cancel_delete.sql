begin;

-- Retroactive admin cancellation/deletion support.
-- Preserve accounting history when the operational order row is deleted.

alter table public.shop_orders
  add column if not exists canceled_at timestamptz,
  add column if not exists canceled_by_admin_id bigint,
  add column if not exists cancellation_reason text;

alter table public.shop_invoices_v847
  alter column order_id drop not null;

alter table public.shop_invoices_v847
  drop constraint if exists shop_invoices_v847_order_id_fkey;

alter table public.shop_invoices_v847
  add constraint shop_invoices_v847_order_id_fkey
  foreign key (order_id) references public.shop_orders(id)
  on delete set null;

commit;
