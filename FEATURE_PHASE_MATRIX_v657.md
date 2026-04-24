# GEJAST v657 Feature Phase Matrix — Stats substrate bundle

## Bundle implemented

This bundle targets phases **2 + 7 + 8 + 12** on top of the previous diagnostic layer.

| Phase | Workstream | v657 status | Evidence |
|---:|---|---|---|
| 2 | Cross-game stats | Partially implemented | `get_cross_game_player_summary_v657` + `GEJAST_SHARED_STATS.crossGame()` |
| 7 | Shared stats framework/cache | Partially implemented | `gejast_shared_stats_cache_v657`, refresh RPC, summary/leaderboard RPCs, browser helper |
| 8 | Klaverjassen shared stats | Partially implemented | `get_klaverjas_shared_stats_v657`, admin surface and public leaderboard bridge |
| 12 | Klaverjassen cleanup/shared stats continuation | Partially implemented | Klaverjas stats are surfaced through the shared substrate without moving legacy ownership |

## Important boundary

This is a substrate/read-layer implementation. It does **not** rewrite match-entry pages, ELO triggers, legacy ladders, or player profile ownership. Live correctness must be proven after running the separate SQL in Supabase.
