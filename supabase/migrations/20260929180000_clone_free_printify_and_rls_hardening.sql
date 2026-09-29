-- 2026-09-29
-- Clone-free Printify fulfillment + RLS hardening.
--
-- One canonical Printify product per design. Alternate providers are selected
-- at quote/order time through shop_provider_routes_v1; product clones are retired.
-- The 28 legacy public tables flagged by the security advisor are private by
-- default behind service_role or session-validated SECURITY DEFINER RPCs.

begin;

create table if not exists public.shop_provider_routes_v1 (
  approval_id text primary key,
  approved boolean not null default false,
  countries text[] not null default '{}'::text[],
  source_product_id text not null,
  source_variant_id bigint not null check (source_variant_id > 0),
  source_blueprint_id bigint not null check (source_blueprint_id > 0),
  source_print_provider_id bigint not null check (source_print_provider_id > 0),
  target_print_provider_id bigint not null check (target_print_provider_id > 0),
  estimated_import_cents_per_unit integer not null default 0 check (estimated_import_cents_per_unit >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source_cost_usd_cents integer,
  target_cost_usd_cents integer,
  cost_delta_usd_cents integer,
  cost_snapshot_at timestamptz
);

alter table public.shop_provider_routes_v1 enable row level security;
revoke all privileges on table public.shop_provider_routes_v1 from anon, authenticated;
grant select, insert, update, delete on table public.shop_provider_routes_v1 to service_role;

drop policy if exists private_service_only on public.shop_provider_routes_v1;
create policy private_service_only
on public.shop_provider_routes_v1
for all
to anon, authenticated
using (false)
with check (false);

create index if not exists shop_provider_routes_v1_source_idx
  on public.shop_provider_routes_v1 (source_product_id, source_variant_id)
  where approved = true;
create index if not exists shop_provider_routes_v1_countries_gin
  on public.shop_provider_routes_v1 using gin (countries);
create index if not exists shop_provider_routes_v1_approved_idx
  on public.shop_provider_routes_v1 (approved)
  where approved = true;

alter table public.shop_provider_routes_v1
  drop constraint if exists shop_provider_routes_v1_approval_id_format_check,
  add constraint shop_provider_routes_v1_approval_id_format_check
    check (approval_id ~ '^[A-Za-z0-9_-]{3,120}$'),
  drop constraint if exists shop_provider_routes_v1_countries_nonempty_check,
  add constraint shop_provider_routes_v1_countries_nonempty_check
    check (cardinality(countries) > 0),
  drop constraint if exists shop_provider_routes_v1_source_product_format_check,
  add constraint shop_provider_routes_v1_source_product_format_check
    check (source_product_id ~ '^[A-Za-z0-9_-]{8,80}$'),
  drop constraint if exists shop_provider_routes_v1_changes_provider_check,
  add constraint shop_provider_routes_v1_changes_provider_check
    check (source_print_provider_id <> target_print_provider_id);

-- Remove superseded Hydrangea US-only rows; the all-destination Choice rows cover US.
delete from public.shop_provider_routes_v1
where approval_id like 'g5000_us_6a98254d5c9d1f57390a1024_%';

-- Retire all product-to-product clone routing state.
drop table if exists public.shop_provider_route_artwork_v1;
drop table if exists public.shop_fulfillment_mappings;

alter table public.admin_accounts enable row level security;
alter table public.available_names enable row level security;
alter table public.claimed_names enable row level security;
alter table public.claim_request_history enable row level security;
alter table public.admin_login_attempts enable row level security;
alter table public.player_activation_links enable row level security;
alter table public.allowed_usernames enable row level security;
alter table public.invite_links enable row level security;
alter table public.game_match_summaries enable row level security;
alter table public.match_change_log enable row level security;
alter table public.drink_sessions enable row level security;
alter table public.admin_drinks_action_groups enable row level security;
alter table public.admin_drinks_action_items enable row level security;
alter table public.hidden_site_names enable row level security;
alter table public.ballroom_sessions enable row level security;
alter table public.web_push_delivery_queue enable row level security;
alter table public.native_push_tokens enable row level security;
alter table public.native_push_jobs enable row level security;
alter table public.active_web_push_presence enable row level security;
alter table public.admin_web_push_jobs enable row level security;
alter table public.scope_quarantine_game_match_summaries enable row level security;
alter table public.scope_quarantine_boerenbridge_matches enable row level security;
alter table public.web_push_job_attempts enable row level security;
alter table public.admin_write_audit_log enable row level security;
alter table public.caute_coin_ledger enable row level security;
alter table public.outbound_email_job_delivery_reports enable row level security;
alter table public.gejast_player_sessions_v746 enable row level security;
alter table public._scratch_paardenrace_history_work enable row level security;

revoke all privileges on table public.admin_accounts from anon, authenticated;
revoke all privileges on table public.available_names from anon, authenticated;
revoke all privileges on table public.claimed_names from anon, authenticated;
revoke all privileges on table public.claim_request_history from anon, authenticated;
revoke all privileges on table public.admin_login_attempts from anon, authenticated;
revoke all privileges on table public.player_activation_links from anon, authenticated;
revoke all privileges on table public.allowed_usernames from anon, authenticated;
revoke all privileges on table public.invite_links from anon, authenticated;
revoke all privileges on table public.game_match_summaries from anon, authenticated;
revoke all privileges on table public.match_change_log from anon, authenticated;
revoke all privileges on table public.drink_sessions from anon, authenticated;
revoke all privileges on table public.admin_drinks_action_groups from anon, authenticated;
revoke all privileges on table public.admin_drinks_action_items from anon, authenticated;
revoke all privileges on table public.hidden_site_names from anon, authenticated;
revoke all privileges on table public.ballroom_sessions from anon, authenticated;
revoke all privileges on table public.web_push_delivery_queue from anon, authenticated;
revoke all privileges on table public.native_push_tokens from anon, authenticated;
revoke all privileges on table public.native_push_jobs from anon, authenticated;
revoke all privileges on table public.active_web_push_presence from anon, authenticated;
revoke all privileges on table public.admin_web_push_jobs from anon, authenticated;
revoke all privileges on table public.scope_quarantine_game_match_summaries from anon, authenticated;
revoke all privileges on table public.scope_quarantine_boerenbridge_matches from anon, authenticated;
revoke all privileges on table public.web_push_job_attempts from anon, authenticated;
revoke all privileges on table public.admin_write_audit_log from anon, authenticated;
revoke all privileges on table public.caute_coin_ledger from anon, authenticated;
revoke all privileges on table public.outbound_email_job_delivery_reports from anon, authenticated;
revoke all privileges on table public.gejast_player_sessions_v746 from anon, authenticated;
revoke all privileges on table public._scratch_paardenrace_history_work from anon, authenticated;

-- Explicit deny policies document the private-by-default contract even though
-- browser-role table privileges are also revoked.
do $$
declare
  t text;
  protected_tables text[] := array[
    'admin_accounts',
    'available_names',
    'claimed_names',
    'claim_request_history',
    'admin_login_attempts',
    'player_activation_links',
    'allowed_usernames',
    'invite_links',
    'game_match_summaries',
    'match_change_log',
    'drink_sessions',
    'admin_drinks_action_groups',
    'admin_drinks_action_items',
    'hidden_site_names',
    'ballroom_sessions',
    'web_push_delivery_queue',
    'native_push_tokens',
    'native_push_jobs',
    'active_web_push_presence',
    'admin_web_push_jobs',
    'scope_quarantine_game_match_summaries',
    'scope_quarantine_boerenbridge_matches',
    'web_push_job_attempts',
    'admin_write_audit_log',
    'caute_coin_ledger',
    'outbound_email_job_delivery_reports',
    'gejast_player_sessions_v746',
    '_scratch_paardenrace_history_work'
  ];
begin
  foreach t in array protected_tables loop
    execute format('drop policy if exists %I on public.%I','private_service_only',t);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (false) with check (false)',
      'private_service_only', t
    );
  end loop;
end $$;

-- Clean up disabled clone-derived route experiments; approved direct routes remain.
delete from public.shop_provider_routes_v1
where not approved and notes ilike '%Disabled for clone-free routing%';

-- Future public tables are born with RLS enabled automatically.
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')
      and object_type in ('table','partitioned table')
  loop
    if cmd.schema_name = 'public' then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
      exception when others then
        raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    end if;
  end loop;
end;
$$;

revoke all on function public.rls_auto_enable() from public, anon, authenticated;
grant execute on function public.rls_auto_enable() to service_role;

drop event trigger if exists ensure_rls;
create event trigger ensure_rls
on ddl_command_end
when tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')
execute function public.rls_auto_enable();

commit;
