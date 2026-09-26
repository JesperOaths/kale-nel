begin;

alter view public.despimarkt_open_debts_view set (security_invoker = true);
alter view public.despimarkt_dry_dock_stats_view set (security_invoker = true);
alter view public.despimarkt_market_follow_counts_view set (security_invoker = true);
alter view public.despimarkt_house_wallet_balance_view set (security_invoker = true);
alter view public.despimarkt_market_totals_view set (security_invoker = true);
alter view public.despimarkt_caute_balance_view set (security_invoker = true);
alter view public.despimarkt_wall_of_shame_view set (security_invoker = true);
alter view public.despimarkt_top_balances_view set (security_invoker = true);

revoke select on table
  public.despimarkt_open_debts_view,
  public.despimarkt_dry_dock_stats_view,
  public.despimarkt_market_follow_counts_view,
  public.despimarkt_house_wallet_balance_view,
  public.despimarkt_market_totals_view,
  public.despimarkt_caute_balance_view,
  public.despimarkt_wall_of_shame_view,
  public.despimarkt_top_balances_view
from anon, authenticated;

commit;
