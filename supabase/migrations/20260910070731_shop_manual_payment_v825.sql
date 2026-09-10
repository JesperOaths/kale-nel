-- Reconciled repository source for production migration 20260910070731.
-- v825 replaces the active checkout path with manual bank-transfer verification.
-- Legacy Stripe columns may remain in production, but this migration does not
-- require or expose them and does not create a Stripe checkout dependency.

create table if not exists public.shop_orders (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending',
  currency text not null default 'eur' check (currency ~ '^[a-z]{3}$'),
  subtotal_cents integer not null check (subtotal_cents >= 0),
  shipping_cents integer not null check (shipping_cents >= 0),
  tax_cents integer not null default 0 check (tax_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  shipping_method text not null,
  line_items jsonb not null check (jsonb_typeof(line_items) = 'array'),
  shipping_address jsonb not null check (jsonb_typeof(shipping_address) = 'object'),
  customer_email text not null,
  printify_order_id text unique,
  printify_status text,
  tracking jsonb not null default '[]'::jsonb check (jsonb_typeof(tracking) = 'array'),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  fulfilled_at timestamptz
);

alter table public.shop_orders
  add column if not exists customer_name text not null default '',
  add column if not exists customer_phone text,
  add column if not exists payment_provider text not null default 'manual_transfer',
  add column if not exists payment_reference text,
  add column if not exists payment_request_token text,
  add column if not exists payment_request_url text,
  add column if not exists payment_request_expires_at timestamptz,
  add column if not exists confirmation_token_hash text,
  add column if not exists payment_verified_at timestamptz,
  add column if not exists payment_verified_by_admin_id bigint,
  add column if not exists printify_shop_id bigint,
  add column if not exists shipping_method_code integer not null default 1,
  add column if not exists submitted_to_printify_at timestamptz,
  add column if not exists shipped_at timestamptz,
  add column if not exists order_confirmation_notified_at timestamptz,
  add column if not exists shipment_notified_at timestamptz;

create unique index if not exists shop_orders_payment_reference_uidx
  on public.shop_orders (payment_reference)
  where payment_reference is not null;

create unique index if not exists shop_orders_confirmation_token_hash_uidx
  on public.shop_orders (confirmation_token_hash)
  where confirmation_token_hash is not null;

create index if not exists shop_orders_created_at_idx
  on public.shop_orders (created_at desc);

create index if not exists shop_orders_status_created_idx
  on public.shop_orders (status, created_at desc);

create table if not exists public.shop_payment_settings (
  id smallint primary key default 1
    constraint shop_payment_settings_id_check check (id = 1),
  provider text not null default 'bunq_me'
    constraint shop_payment_settings_provider_check
      check (provider in ('bunq_me','tikkie','manual_transfer')),
  payment_url text,
  enabled boolean not null default true,
  payment_instructions text,
  updated_at timestamptz not null default now()
);

insert into public.shop_payment_settings (id, provider, enabled)
values (1, 'bunq_me', true)
on conflict (id) do nothing;

create table if not exists public.shop_webhook_events (
  provider text not null
    constraint shop_webhook_events_provider_check
      check (provider in ('stripe','printify')),
  event_id text not null,
  event_type text not null,
  processed boolean not null default false,
  attempts integer not null default 1
    constraint shop_webhook_events_attempts_check check (attempts > 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  primary key (provider, event_id)
);

alter table public.shop_orders enable row level security;
alter table public.shop_payment_settings enable row level security;
alter table public.shop_webhook_events enable row level security;

revoke all on table public.shop_orders from anon, authenticated;
revoke all on table public.shop_payment_settings from anon, authenticated;
revoke all on table public.shop_webhook_events from anon, authenticated;

grant select, insert, update, delete on table public.shop_orders to service_role;
grant select, insert, update, delete on table public.shop_payment_settings to service_role;
grant select, insert, update, delete on table public.shop_webhook_events to service_role;

comment on table public.shop_payment_settings is
  'Private singleton configuration for v825 manual shop payments; never browser-readable.';
comment on table public.shop_webhook_events is
  'Private idempotency/audit records for Printify webhook processing.';
comment on column public.shop_orders.confirmation_token_hash is
  'SHA-256 hash of the buyer capability token; plaintext token is never stored.';
comment on column public.shop_orders.payment_verified_at is
  'Set only after an admin manually confirms the bank transfer.';
