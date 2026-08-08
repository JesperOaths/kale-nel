-- GEJAST v755q — Klaverjas direct-write boundary guard
-- Security-only repair. Does not alter scoring, ratings, payloads, RLS policies, or RPC bodies.
--
-- Production preflight (2026-08-08) proved:
-- - save_klaverjas_match_v687 is not deployed;
-- - current compatibility RPCs are SECURITY DEFINER;
-- - PUBLIC/anon/authenticated can directly INSERT/UPDATE/DELETE several Klaverjas persistence tables;
-- - jas_games, jas_game_entries and game_rating_rebuild_queue have RLS disabled;
-- - PUBLIC can EXECUTE create_jas_game and klaverjas_upsert_match_state_scoped.
--
-- This patch closes only those privilege boundaries while retaining guarded RPC execution for
-- anon/authenticated. SELECT privileges are deliberately untouched.

begin;

revoke insert, update, delete on table public.jas_games from public, anon, authenticated;
revoke insert, update, delete on table public.jas_game_entries from public, anon, authenticated;
revoke insert, update, delete on table public.game_rating_rebuild_queue from public, anon, authenticated;
revoke insert, update, delete on table public.klaverjas_online_games from public, anon, authenticated;
revoke insert, update, delete on table public.klaverjas_online_player_stats from public, anon, authenticated;

revoke execute on function public.create_jas_game(text, jsonb) from public;
grant execute on function public.create_jas_game(text, jsonb) to anon, authenticated;

revoke execute on function public.klaverjas_upsert_match_state_scoped(
  text,
  bigint,
  text,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  text,
  timestamp with time zone
) from public;
grant execute on function public.klaverjas_upsert_match_state_scoped(
  text,
  bigint,
  text,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  text,
  timestamp with time zone
) to anon, authenticated;

commit;
