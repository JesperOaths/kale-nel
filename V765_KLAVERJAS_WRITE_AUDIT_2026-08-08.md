# v765 Klaverjas write-path audit — 2026-08-08

Branch: `agent/v765-klaverjas-write-hardening`
Mode: narrow security/correctness follow-up after v764. No finished production Klaverjas game has been written by v765 outside controlled transaction-gated proof planning.

## Current frontend path

The current scorer uses `GEJAST_KLAVERJAS_RUNTIME.saveMatch(...)`.

Current runtime behavior:

1. Normalize 2v2 names, scores, roem, notes and a generated UUID `client_match_id`.
2. Primary RPC: `save_klaverjas_match_v687` with both session-token keys, `client_match_id_input`, `match_payload`, and `site_scope_input`.
3. Compatibility fallback only when the primary RPC is missing: `klaverjas_upsert_match_state_scoped(..., status='finished')`.

## Production captures — final findings

Read-only production captures proved:

- `save_klaverjas_match_v687`: **not deployed**.
- `start_klaverjas_live_match_v687` / `finish_klaverjas_live_match_v687`: **not deployed**.
- `klaverjas_upsert_match_state_scoped(...)`: deployed `SECURITY DEFINER`, but its body never validates or uses the supplied `session_token`.
- The deployed fallback accepts `match_id_input bigint`, while the current scorer generates text/UUID client IDs.
- The fallback can insert/update caller-selected numeric match IDs, delete/rewrite child rounds/snapshots, and has no creator/owner check.
- `klaverjas_matches` already has the correct fields needed for a safe current contract:
  - `client_match_id text NOT NULL UNIQUE`
  - `created_by_player_id bigint`
- `klaverjas_matches`, `klaverjas_rounds`, and `klaverjas_match_snapshots` all have RLS enabled, but direct `anon`/`authenticated` INSERT/UPDATE/DELETE grants still exist.
- Direct web-role DML also existed on `jas_games`, `jas_game_entries`, `game_rating_rebuild_queue`, `klaverjas_online_games`, and `klaverjas_online_player_stats`.
- RLS is disabled on `jas_games`, `jas_game_entries`, and `game_rating_rebuild_queue`.
- Historical `create_jas_game(text,jsonb)` authenticates via `_jas_session_player`, writes `jas_games`/`jas_game_entries`, fires two ELO triggers, queues a Klaverjas rating rebuild, and processes the rebuild queue. It is therefore not behaviorally interchangeable with the legacy/current scorer persistence path.
- `_jas_session_player(text)` validates current sessions before returning a player and rejects missing/expired/invalid sessions.
- `klaverjas_matches` baseline: `7` rows; `klaverjas_rounds=0`; `klaverjas_match_snapshots=0` at final capture.
- Classic baseline at prior capture: `jas_games=15`, `jas_game_entries=60`, `game_rating_rebuild_queue=87`.
- Controlled `OC_V765` push rows: `0`.
- Ice: `2.8`.

## Superseded v755q

The earlier ACL-only `GEJAST_v755q_klaverjas_write_boundary_guard.sql` is deliberately **SUPERSEDED** and aborts if executed. Exact function capture proved that ACL-only hardening while leaving the unauthenticated `SECURITY DEFINER` fallback callable would preserve a write bypass.

## v755r combined repair

Prepared:

- `GEJAST_v755r_klaverjas_save_contract_guard.sql`
- `check-klaverjas-save-contract-v755r.mjs`
- `LIVE_APPLY_AND_VERIFY_V755R_KLAVERJAS_SAVE_GUARD.sql`
- `LIVE_POSTAPPLY_V755R_VERIFY.sql`

v755r does all of the following without switching persistence models:

1. Replaces `klaverjas_upsert_match_state_scoped` with a session-validated, creator-owned implementation while preserving its existing round/progress/scoring calculations.
2. Uses `client_match_id` as the idempotency key when present.
3. Rejects unknown-owner and cross-player overwrite attempts.
4. Installs the missing current `save_klaverjas_match_v687(text,text,text,jsonb,text)` signature used by the frontend.
5. Accepts text/UUID client IDs and maps the simple scorer payload into the same one-round compatibility representation the existing frontend fallback already intended to use.
6. Does not call `create_jas_game`, does not enqueue/process rating rebuilds, and does not write classic `jas_games`/`jas_game_entries`.
7. Revokes direct `PUBLIC`/`anon`/`authenticated` INSERT/UPDATE/DELETE across the inventoried legacy/classic/online persistence tables while leaving SELECT untouched.
8. Removes `PUBLIC EXECUTE` from the write RPCs while retaining `anon`/`authenticated` execution on the now-guarded RPCs.

## Transaction-gated production apply

`LIVE_APPLY_AND_VERIFY_V755R_KLAVERJAS_SAVE_GUARD.sql` is the intended production execution artifact. It performs the migration and its controlled proof in a single transaction.

Before COMMIT it requires all of these to pass:

- valid text/UUID-style client-ID save;
- correct creator ownership;
- exact score persistence;
- one canonical scorer round;
- same-owner deterministic replay with one row only;
- cross-player overwrite rejection;
- missing/invalid/stale session rejection before write;
- direct DML grants reduced to zero on target tables;
- PUBLIC execute removed from write RPCs;
- classic `jas_games` / entries / rating rebuild queue unchanged by the current scorer proof;
- exact controlled match/session cleanup;
- legacy match/round/snapshot baseline restored;
- controlled push residue `0`;
- Ice `2.8`.

Any failed assertion aborts the whole transaction, including the function/ACL changes and controlled data writes. The migration commits only if the complete proof reaches the cleanup and invariant checks.

## Deliberate scope boundary

v755r fixes the **finished simple scorer save contract** and hardens the deployed legacy upsert. It does not invent missing `start_klaverjas_live_match_v687` / `finish_klaverjas_live_match_v687` APIs in this same repair. Those live-runtime aliases can be handled separately after the finished-save path is proven, to avoid expanding the production change beyond the identified v765 blocker.
