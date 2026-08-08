# v766 Klaverjas live-alias audit — 2026-08-08

Branch: `agent/v766-klaverjas-live-aliases`
Base: v765 merge commit `8962f3e4b28f6ed9a4c215164cd7aa334578283f`
Mode: backend live-alias compatibility/security follow-up.

## v765 state inherited

v755r is deployed and independently verified:

- `save_klaverjas_match_v687(text,text,text,jsonb,text)` exists;
- finished-score UUID/text save is session-validated and creator-owned;
- same-owner replay is idempotent and cross-player reuse rejects;
- `klaverjas_upsert_match_state_scoped(...)` validates `_jas_session_player` and enforces ownership/client IDs;
- direct web-role DML on inventoried Klaverjas persistence surfaces is zero;
- controlled residue/push jobs are zero;
- Ice remains 2.8.

## Current runtime live contracts

`gejast-klaverjas-runtime.js` calls:

1. `start_klaverjas_live_match_v687(session_token_input, client_match_id_input, match_payload, site_scope_input)`;
2. `update_klaverjas_live_match_v687(session_token_input, client_match_id_input, patch_payload, site_scope_input)`;
3. `finish_klaverjas_live_match_v687(session_token_input, client_match_id_input, patch_payload, site_scope_input)`;
4. `get_klaverjas_live_state_public_v687(client_match_id_input, site_scope_input)`.

## Production preflight — complete

`LIVE_PREFLIGHT_V766_KLAVERJAS_LIVE_ALIASES.sql` was run read-only in production after v755r.

Confirmed:

- all four v687 live RPCs were not deployed: start, update, finish and public live-state getter;
- `save_klaverjas_match_v687` was deployed `SECURITY DEFINER` with session/client-id/owner/scope guards;
- hardened `klaverjas_upsert_match_state_scoped` was deployed `SECURITY DEFINER` with the same core guard fingerprint;
- legacy `klaverjas_get_live_match_public(bigint)` remained PUBLIC-executable but read-only and bigint-only;
- `klaverjas_matches` had unique text `client_match_id` plus `created_by_player_id`;
- v765 direct-DML boundary remained PASS with zero web-role INSERT/UPDATE/DELETE grants;
- baseline before v755s: matches=7, active=7, finished=0, abandoned=0, rounds=0, snapshots=0;
- controlled v766 residue=0;
- controlled v766 push rows=0;
- Ice=2.8.

## Confirmed UUID fallback incompatibility

The runtime generates UUID-capable `client_match_id` values. Its legacy live fallbacks target numeric APIs:

- start fallback can feed UUID client IDs to `match_id_input bigint`;
- update/finish/get fallbacks call `klaverjas_get_live_match_public(match_id_input bigint)`;
- therefore the old fallback cannot reliably support current UUID-backed live games.

## v755s repair — APPLIED + CONTROLLED PROOF PASS

Artifacts:

- `GEJAST_v755s_klaverjas_live_alias_contract.sql`
- `GEJAST_v755s_klaverjas_live_alias_contract_ROLLBACK.sql`
- `check-klaverjas-live-alias-contract-v755s.mjs`
- `LIVE_APPLY_AND_VERIFY_V755S_KLAVERJAS_LIVE_ALIASES.sql`
- `LIVE_POSTAPPLY_V755S_VERIFY.sql`

v755s adds the exact four runtime aliases over the v755r-hardened legacy persistence model:

- `start_klaverjas_live_match_v687(text,text,jsonb,text)` creates a 0-0 active match by text/UUID client ID, authenticates before writing, validates 2v2 names, enforces creator ownership and makes same-owner start replay idempotent;
- `update_klaverjas_live_match_v687(text,text,jsonb,text)` resolves by text client ID, authenticates, owner/scope checks, requires active status and persists score/round/note changes without classic rating/history writes;
- `finish_klaverjas_live_match_v687(text,text,jsonb,text)` authenticates and owner/scope checks, rejects tied final scores, marks the same live row finished and treats same-owner finished replay as idempotent;
- `get_klaverjas_live_state_public_v687(text,text)` is read-only, scope-filtered, UUID/text capable and returns the JSON shape expected by `klaverjas_live.html`.

Write aliases remove PUBLIC execute and retain anon/authenticated execution behind the database session guard. The public getter remains intentionally PUBLIC because it is read-only and scope-filtered. v755r direct table DML revokes are repeated defensively.

`LIVE_APPLY_AND_VERIFY_V755S_KLAVERJAS_LIVE_ALIASES.sql` completed successfully in production. The migration committed only after all controlled proof assertions passed:

- `valid_uuid_start`: PASS — UUID/text live match created active at 0-0 with correct creator and zero rounds;
- `same_owner_start_replay`: PASS — same-owner start replay returned the same active row;
- `public_uuid_get`: PASS — public scope-filtered getter resolved the UUID/text client ID;
- `owner_live_update`: PASS — owner update persisted 40-20 and public round_no=3;
- `cross_player_owner_guard`: PASS — different valid player rejected on live update;
- `session_guards`: PASS — missing, invalid and stale sessions rejected before live writes;
- `owner_live_finish`: PASS — owner finish persisted 120-90, round_no=8 and finished state;
- `same_owner_finish_replay`: PASS — finished replay idempotent and retained one row;
- `direct_dml_boundary`: PASS — PUBLIC/anon/authenticated direct INSERT/UPDATE/DELETE grants remain zero;
- `rpc_execute_boundary`: PASS — write aliases PUBLIC=false; guarded web-role execution retained;
- `rating_history_isolation`: PASS — jas_games/entries/rebuild queue unchanged;
- `baseline_restored`: PASS — controlled live match/round/snapshot fixture removed exactly;
- `controlled_residue`: PASS — no controlled v766 match/session rows remain;
- `controlled_push_jobs`: PASS — OC_V766 push rows=0;
- `ice_invariant`: PASS — Ice=2.8.

## Independent post-apply gate

Before PR #8 is merged, run `LIVE_POSTAPPLY_V755S_VERIFY.sql` read-only in production. It must independently confirm:

- all four aliases exist;
- all three write aliases remain non-PUBLIC and retain anon/authenticated guarded execution;
- all three write aliases contain the session and owner guard fingerprints;
- public getter remains PUBLIC, scope-filtered and read-only;
- direct web-role DML remains zero;
- controlled v766 residue and push jobs remain zero;
- Ice remains 2.8;
- current baseline counts are recorded.

## Separate frontend defects — immediate next phase

Two frontend defects are confirmed independently of the database aliases:

1. `startLive()` currently calls `normalizeMatchInput()` with 0-0 scores even though that validator rejects tied scores, so a normal live start can fail before RPC execution.
2. `klaverjas_live.html` says to start via the scorer, but the scorer has no start-live button.

These require a frontend release/version/cache-buster change and will be handled immediately after v755s is independently verified and merged. This backend branch deliberately does not change frontend files or the root version.
