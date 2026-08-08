# v765 Klaverjas write-path audit — 2026-08-08

Branch: `agent/v765-klaverjas-write-hardening`
Mode: repository read-only analysis. No production SQL mutation and no finished live game write.

## Current frontend path

The current root `score.html` redirects to `klaverjas_scorer_v596_repo_ready.html`.

That scorer uses `GEJAST_KLAVERJAS_RUNTIME.saveMatch(...)` rather than calling a database RPC directly.

Current `gejast-klaverjas-runtime.js` behavior:

1. Normalize the 2v2 player list, final scores, roem, notes and a generated `client_match_id`.
2. Primary save RPC: `save_klaverjas_match_v687` with both `session_token` and `session_token_input`, `client_match_id_input`, `match_payload`, and `site_scope_input`.
3. Compatibility fallback only when the primary RPC is missing: `klaverjas_upsert_match_state_scoped(..., status='finished')`.
4. Live start/update/finish similarly prefer v687 RPCs and use `klaverjas_upsert_match_state_scoped` only for legacy IDs when the v687 function is missing.

Important correction to the v764 inventory: `create_jas_game(text,jsonb)` remains a historical/classic score surface in database evidence, but it is not the direct active call in the current scorer runtime inspected for v765. It must still be inventoried because it may remain callable and may still be reached by older/compatibility paths, but it should not be treated as the only current save contract.

## Existing v764 evidence to preserve

- Reversible Klaverjas online-room create/save/read/delete/cleanup already passed.
- Invalid online-room sessions reject.
- Direct anonymous REST insert to `klaverjas_online_games` was rejected by RLS.
- Finished score/history was deliberately not written in production because rating/stat rollback was not proven safe.
- Last recorded baseline before v765: `jas_games=15`, `jas_game_entries=60`, controlled Klaverjas residue `0`.
- Earlier live inventory reported broad RPC execute availability and direct grants on some Klaverjas tables, although RLS blocked the tested direct online-room insert.

## v765 questions that must be answered before any repair

1. Does production currently expose `save_klaverjas_match_v687`, or is the frontend actually falling back to `klaverjas_upsert_match_state_scoped`?
2. Which session resolver does each active save/finish RPC use, and does invalid/stale resolution happen before any write?
3. Is an existing `client_match_id` owner-scoped, or can another valid player overwrite/replay someone else's match?
4. Which functions enqueue/rebuild Klaverjas ratings/history and at what point in the transaction?
5. Are direct INSERT/UPDATE/DELETE grants still present on `jas_games`, `jas_game_entries`, rating/rebuild tables or online tables, and which of those boundaries rely only on RLS?
6. Is `create_jas_game(text,jsonb)` still executable by web roles/PUBLIC even though the current scorer uses v687 first?
7. Can a transaction-only controlled proof exercise the finished-save contract and roll back *all* game/entry/rating/queue/stat side effects atomically?

## Next artifact

`LIVE_PREFLIGHT_V765_KLAVERJAS_WRITE_SURFACE.sql` is a read-only catalog/baseline preflight. It inventories the deployed function definitions, execution grants, direct table DML grants, RLS flags, triggers, ratings/rebuild references, baseline counts, controlled v765 residue and the Ice invariant.

No repair should be authored or applied until that production preflight is reviewed.
