-- v817+ safe SECURITY INVOKER hardening.
-- These views depend only on relations already directly readable by the same browser roles,
-- so owner-privileged view execution is unnecessary and adds avoidable risk.

alter view public.despimarkt_player_market_positions_view set (security_invoker = true);
alter view public.despimarkt_recent_bets_view set (security_invoker = true);
alter view public.klaverjas_match_player_rows set (security_invoker = true);
alter view public.klaverjas_online_kruip_stats set (security_invoker = true);
alter view public.klaverjas_player_stats_v set (security_invoker = true);
