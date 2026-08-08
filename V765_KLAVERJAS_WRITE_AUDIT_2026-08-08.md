# v765 Klaverjas write-path audit — 2026-08-08

Branch: `agent/v765-klaverjas-write-hardening`
Mode: narrow security/correctness follow-up after v764.

## Current frontend path

The current scorer uses `GEJAST_KLAVERJAS_RUNTIME.saveMatch(...)`.

Current runtime behavior:

1. Normalize 2v2 names, scores, roem, notes and a generated UUID `client_match_id`.
2. Primary RPC: `save_klaverjas_match_v687` with both session-token keys, `client_match_id_input`, `match_payload`, and `site_scope_input`.
3. Compatibility fallback only when the primary RPC is missing: `klaverjas_upsert_match_state_scoped(..., status='finished')`.

## Production captures — final findings

Read-only production captures proved:

- `save_klaverjas_match_v687`: **not deployed** before v755r.
- `start_klaverjas_live_match_v687` / `finish_klaverjas_live_match_v687`: **not deployed**.
- `klaverjas_upsert_match_state_scoped(...)`: deployed `SECURITY DEFINER`, but its pre-v755r body never validated or used the supplied `session_token`.
- The pre-v755r fallback accepted `match_id_input bigint`, while the current scorer generates text/UUID client IDs.
- The pre-v755r fallback could insert/update caller-selected numeric match IDs, delete/rewrite child rounds/snapshots, and had no creator/owner check.
- `klaverjas_matches` already has `client_match_id text NOT NULL UNIQUE` and `created_by_player_id bigint`, so the database schema supports safe idempotency/ownership without a new table.
- `klaverjas_matches`, `klaverjas_rounds`, and `klaverjas_match_snapshots` have RLS enabled, but direct `anon`/`authenticated` INSERT/UPDATE/DELETE grants existed before v755r.
- Direct web-role DML also existed on `jas_games`, `jas_game_entries`, `game_rating_rebuild_queue`, `klaverjas_online_games`, and `klaverjas_online_player_stats`.
- RLS is disabled on `jas_games`, `jas_game_entries`, and `game_rating_rebuild_queue`.
- Historical `create_jas_game(text,jsonb)` authenticates via `_jas_session_player`, writes `jas_games`/`jas_game_entries`, fires two ELO triggers, queues a Klaverjas rating rebuild, and processes the rebuild queue. It is not behaviorally interchangeable with the current scorer persistence path.
- `_jas_session_player(text)` validates current sessions and rejects missing/expired/invalid sessions.
- Pre-repair baseline: legacy `klaverjas_matches=7`, `klaverjas_rounds=0`, `klaverjas_match_snapshots=0`; classic `jas_games=15`, `jas_game_entries=60`, `game_rating_rebuild_queue=87`; controlled push rows `0`; Ice `2.8`.

## Superseded v755q

The earlier ACL-only `GEJAST_v755q_klaverjas_write_boundary_guard.sql` is deliberately **SUPERSEDED** and aborts if executed. Exact function capture proved that ACL-only hardening while leaving the unauthenticated `SECURITY DEFINER` fallback callable would preserve a write bypass.

## v755r combined repair

Artifacts:

- `GEJAST_v755r_klaverjas_save_contract_guard.sql`
- `check-klaverjas-save-contract-v755r.mjs`
- `LIVE_APPLY_AND_VERIFY_V755R_KLAVERJAS_SAVE_GUARD.sql`
- `LIVE_POSTAPPLY_V755R_VERIFY.sql`

v755r:

1. replaces `klaverjas_upsert_match_state_scoped` with a session-validated, creator-owned implementation while preserving the existing round/progress/scoring calculations;
2. uses `client_match_id` as the idempotency key when present;
3. rejects unknown-owner and cross-player overwrite attempts;
4. installs the missing current `save_klaverjas_match_v687(text,text,text,jsonb,text)` signature used by the frontend;
5. accepts text/UUID client IDs and maps the simple scorer payload into the same one-round compatibility representation the frontend fallback already intended to use;
6. does not call `create_jas_game`, does not enqueue/process rating rebuilds, and does not write classic `jas_games`/`jas_game_entries`;
7. revokes direct `PUBLIC`/`anon`/`authenticated` INSERT/UPDATE/DELETE across the inventoried legacy/classic/online persistence tables while leaving SELECT untouched;
8. removes `PUBLIC EXECUTE` from the write RPCs while retaining `anon`/`authenticated` execution on guarded RPCs.

## Production apply and controlled proof — PASS

`LIVE_APPLY_AND_VERIFY_V755R_KLAVERJAS_SAVE_GUARD.sql` was executed successfully in production on 2026-08-08. The file applies the migration and runs the controlled proof in one transaction, committing only after cleanup and all assertions pass.

Returned proof:

- `valid_uuid_save`: **PASS** — text/UUID-style client ID persisted once with creator and 120-90 score.
- `same_owner_replay`: **PASS** — same match id, `already_saved=true`, one row.
- `cross_player_owner_guard`: **PASS** — a different valid player was rejected with `klaverjas_match_owner_mismatch`.
- `missing_session_rejected`: **PASS** — rejected before write.
- `invalid_session_rejected`: **PASS** — rejected before write.
- `stale_session_rejected`: **PASS** — expired controlled session rejected before write.
- `direct_dml_boundary`: **PASS** — PUBLIC/anon/authenticated INSERT/UPDATE/DELETE grants are zero on target tables.
- `rpc_execute_boundary`: **PASS** — PUBLIC execute removed; guarded web-role RPC execution retained.
- `rating_history_isolation`: **PASS** — `jas_games`, `jas_game_entries`, and rating rebuild queue unchanged by the current scorer proof.
- `baseline_restored`: **PASS** — controlled legacy match/round/snapshot fixture removed exactly.
- `controlled_residue`: **PASS** — no controlled v765 Klaverjas match/session rows remain.
- `controlled_push_jobs`: **PASS** — controlled push rows `0`.
- `ice_invariant`: **PASS** — Ice remains `2.8`.

This proves the v755r production repair is applied and the controlled transaction completed cleanly with no controlled residue.

## Independent post-apply gate

`LIVE_POSTAPPLY_V755R_VERIFY.sql` is the final independent read-only production check. It verifies the deployed RPC signatures/guards, ACL boundaries, zero controlled residue, zero controlled push jobs, Ice `2.8`, and current baseline counts without creating persistent data.

PR #7 remains draft until that independent post-apply check is clean and final branch CI passes on the evidence-only head.

## Deliberate scope boundary

v755r fixes the **finished simple scorer save contract** and hardens the deployed legacy upsert. It does not invent missing `start_klaverjas_live_match_v687` / `finish_klaverjas_live_match_v687` APIs in the same repair. Those live-runtime aliases remain a separate follow-up after this finished-save path is fully closed, to avoid expanding this production change beyond the identified blocker.
