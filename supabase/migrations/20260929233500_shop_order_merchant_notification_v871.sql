-- v871: separate merchant new-order notification state from customer transactional mail.
alter table public.shop_orders
  add column if not exists merchant_order_notified_at timestamptz,
  add column if not exists merchant_order_notification_error text,
  add column if not exists merchant_order_notification_error_at timestamptz;

comment on column public.shop_orders.merchant_order_notified_at is
  'Time the merchant/owner new-order email was successfully delivered.';
comment on column public.shop_orders.merchant_order_notification_error is
  'Last merchant new-order email delivery error, separate from customer notification errors.';
comment on column public.shop_orders.merchant_order_notification_error_at is
  'Time of the last merchant new-order email delivery error.';
