create table if not exists public.shop_fx_rates (
  pair text primary key,
  base_currency text not null,
  quote_currency text not null,
  rate numeric(18,10) not null check (rate > 0 and rate < 10),
  source text not null,
  source_rate numeric(18,10),
  observed_on date not null,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shop_fx_rates_pair_format_check check (pair = base_currency || '_' || quote_currency)
);

alter table public.shop_fx_rates enable row level security;
revoke all on table public.shop_fx_rates from anon, authenticated;
grant select, insert, update, delete on table public.shop_fx_rates to service_role;

alter table public.shop_orders
  add column if not exists fx_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists shipping_source_currency text,
  add column if not exists shipping_source_cents integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'shop_orders_shipping_source_cents_nonnegative'
      and conrelid = 'public.shop_orders'::regclass
  ) then
    alter table public.shop_orders
      add constraint shop_orders_shipping_source_cents_nonnegative
      check (shipping_source_cents is null or shipping_source_cents >= 0);
  end if;
end $$;

comment on table public.shop_fx_rates is 'Server-only exchange-rate cache used to convert Printify USD-denominated costs into storefront EUR amounts.';
comment on column public.shop_fx_rates.rate is 'Quote currency units per one base currency unit. USD_EUR therefore stores EUR per USD.';
comment on column public.shop_orders.fx_snapshot is 'Exchange-rate snapshot used to price this EUR order.';
comment on column public.shop_orders.shipping_source_currency is 'Raw upstream shipping quote currency before storefront conversion.';
comment on column public.shop_orders.shipping_source_cents is 'Raw upstream shipping quote minor-unit amount before storefront conversion.';
comment on column public.shop_orders.fulfillment_score_cents is 'Fulfillment route score in EUR cents.';
comment on column public.shop_orders.fulfillment_estimated_import_cents is 'Estimated import allowance in EUR cents.';
