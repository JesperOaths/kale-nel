create table public.shop_price_rule_state (
  id smallint primary key default 1 check (id = 1),
  last_started_at timestamptz,
  last_completed_at timestamptz,
  next_run_at timestamptz,
  last_error text,
  changed_products integer not null default 0,
  changed_variants integer not null default 0,
  last_result jsonb not null default '{}'::jsonb
);

alter table public.shop_price_rule_state enable row level security;

revoke all on table public.shop_price_rule_state from public, anon, authenticated;
grant all on table public.shop_price_rule_state to service_role;

insert into public.shop_price_rule_state (id)
values (1)
on conflict (id) do nothing;
