begin;

-- v817+ production hardening: these tables are internal state/ledger/queue surfaces.
-- Browser clients must use the existing scoped SECURITY DEFINER RPCs or deliberate
-- aggregate views rather than reading the underlying rows directly.
--
-- RLS is enabled as defense in depth and anon/authenticated SELECT is revoked.
-- service_role and postgres ownership remain unchanged.

alter table public.despimarkt_audit_log enable row level security;
alter table public.despimarkt_house_wallet_ledger enable row level security;
alter table public.despimarkt_caute_ledger enable row level security;
alter table public.despimarkt_drink_debts enable row level security;
alter table public.despimarkt_player_restrictions enable row level security;
alter table public.drink_suspicion_flags enable row level security;
alter table public.game_rating_rebuild_queue enable row level security;
alter table public.rating_rebuild_queue enable row level security;
alter table public.username_events enable row level security;

alter table public.ballroom_cycle_reset_guard enable row level security;
alter table public.despimarkt_market_settlements enable row level security;
alter table public.despimarkt_market_payouts enable row level security;
alter table public.despimarkt_drink_mint_requests enable row level security;
alter table public.despimarkt_announcement_reads enable row level security;
alter table public.despimarkt_market_watchers enable row level security;
alter table public.despimarkt_house_wallets enable row level security;
alter table public.despimarkt_caute_accounts enable row level security;
alter table public.despimarkt_nomination_drink_rules enable row level security;
alter table public.paardenrace_wager_verifications enable row level security;

revoke select on table
  public.despimarkt_audit_log,
  public.despimarkt_house_wallet_ledger,
  public.despimarkt_caute_ledger,
  public.despimarkt_drink_debts,
  public.despimarkt_player_restrictions,
  public.drink_suspicion_flags,
  public.game_rating_rebuild_queue,
  public.rating_rebuild_queue,
  public.username_events,
  public.ballroom_cycle_reset_guard,
  public.despimarkt_market_settlements,
  public.despimarkt_market_payouts,
  public.despimarkt_drink_mint_requests,
  public.despimarkt_announcement_reads,
  public.despimarkt_market_watchers,
  public.despimarkt_house_wallets,
  public.despimarkt_caute_accounts,
  public.despimarkt_nomination_drink_rules,
  public.paardenrace_wager_verifications
from anon, authenticated;

commit;
