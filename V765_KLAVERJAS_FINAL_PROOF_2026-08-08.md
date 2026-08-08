# v765 Klaverjas final proof — 2026-08-08

Branch: `agent/v765-klaverjas-write-hardening`
PR: #7
Production migration: `GEJAST_v755r_klaverjas_save_contract_guard.sql`
Production execution artifact: `LIVE_APPLY_AND_VERIFY_V755R_KLAVERJAS_SAVE_GUARD.sql`

## Defect proven before repair

Production did not expose `save_klaverjas_match_v687`, while the current frontend prefers that RPC and generates text/UUID client IDs. Its deployed fallback `klaverjas_upsert_match_state_scoped(...)` was `SECURITY DEFINER`, accepted `session_token` but never validated it, accepted caller-selected `bigint` IDs, and could rewrite match/round/snapshot state without creator ownership checks. Direct web-role table DML was also present across Klaverjas persistence surfaces.

## Repair deployed

v755r:

- installs `save_klaverjas_match_v687(text,text,text,jsonb,text)`;
- validates a real player session before writes;
- accepts text/UUID client IDs;
- uses `client_match_id` for deterministic idempotency;
- scopes replay/update to `created_by_player_id`;
- rejects cross-player reuse with `klaverjas_match_owner_mismatch`;
- hardens `klaverjas_upsert_match_state_scoped` with the same session/owner boundary;
- revokes PUBLIC/anon/authenticated direct INSERT/UPDATE/DELETE on inventoried Klaverjas persistence tables;
- removes PUBLIC EXECUTE from write RPCs while retaining guarded anon/authenticated RPC execution;
- leaves current scorer writes isolated from `create_jas_game`, `jas_game_entries` ELO triggers, and rating rebuild processing.

## Production controlled proof

`LIVE_APPLY_AND_VERIFY_V755R_KLAVERJAS_SAVE_GUARD.sql` completed successfully and committed the repair only after every assertion below passed:

| Check | Result | Evidence |
| --- | --- | --- |
| baseline_restored | PASS | controlled legacy match/round/snapshot fixture removed exactly |
| controlled_push_jobs | PASS | OC_V765 push rows=0 |
| controlled_residue | PASS | no controlled v765 Klaverjas match/session rows remain |
| cross_player_owner_guard | PASS | different valid player rejected with `klaverjas_match_owner_mismatch` |
| direct_dml_boundary | PASS | PUBLIC/anon/authenticated INSERT/UPDATE/DELETE grants=0 on target tables |
| ice_invariant | PASS | Ice=2.8 |
| invalid_session_rejected | PASS | invalid session rejected before write |
| missing_session_rejected | PASS | missing session rejected before write |
| rating_history_isolation | PASS | jas_games/entries/rebuild queue unchanged by current scorer proof |
| rpc_execute_boundary | PASS | PUBLIC execute removed; guarded web-role RPC execution retained |
| same_owner_replay | PASS | same match id, already_saved=true, one row |
| stale_session_rejected | PASS | expired controlled session rejected before write |
| valid_uuid_save | PASS | text/UUID-style client id persisted once with creator and 120-90 score |

## Residue / invariants after controlled proof

- Controlled v765 Klaverjas match/session residue: `0`.
- Controlled v765 push jobs: `0`.
- Ice: `2.8`.
- Classic `jas_games` / `jas_game_entries` / rating rebuild queue were unchanged by the current scorer proof.

## Sole remaining gate

Run `LIVE_POSTAPPLY_V755R_VERIFY.sql` read-only in production. Required final state:

- `save_rpc_exists`: PASS;
- `rpc_auth_boundary`: PASS;
- `direct_dml_boundary`: PASS;
- `controlled_v765_residue`: PASS;
- `controlled_push_jobs`: PASS;
- `ice_invariant`: PASS;
- `baseline_snapshot`: informational PASS with the current production counts.

No persistent writes are performed by the independent postcheck.

After that check passes, the remaining steps are repository-only: record evidence, final CI, mark PR #7 ready, merge to `main`, and verify the merged state.

## Scope boundary

Missing `start_klaverjas_live_match_v687` and `finish_klaverjas_live_match_v687` aliases are not included in v755r. They remain a separate follow-up so this repair stays limited to the proven finished-score save vulnerability/correctness defect.
