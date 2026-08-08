# v766 Klaverjas live-alias audit — 2026-08-08

Branch: `agent/v766-klaverjas-live-aliases`
Base: v765 merge commit `8962f3e4b28f6ed9a4c215164cd7aa334578283f`
Mode: backend live-alias compatibility/security follow-up. No v766 production writes yet.

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

- all four v687 live RPCs are **not deployed**: start, update, finish and public live-state getter;
- `save_klaverjas_match_v687` is deployed `SECURITY DEFINER` with session/client-id/owner/scope guards;
- hardened `klaverjas_upsert_match_state_scoped` is deployed `SECURITY DEFINER` with the same core guard fingerprint;
- legacy `klaverjas_get_live_match_public(bigint)` remains deployed and PUBLIC-executable, but is read-only and bigint-only;
- `klaverjas_matches` has the required unique text `client_match_id` plus `created_by_player_id` ownership field;
- v765 direct-DML boundary remains PASS with zero web-role INSERT/UPDATE/DELETE grants;
- legacy baseline: matches=7, active=7, finished=0, abandoned=0, rounds=0, snapshots=0;
- controlled v766 legacy residue=0;
- controlled v766 push rows=0;
- Ice=2.8.

## Confirmed UUID fallback incompatibility

The runtime generates UUID-capable `client_match_id` values. Its legacy live fallbacks target numeric APIs:

- start fallback can feed UUID client IDs to `match_id_input bigint`;
- update/finish/get fallbacks call `klaverjas_get_live_match_public(match_id_input bigint)`;
- therefore the old fallback cannot reliably support current UUID-backed live games.

## v755s repair — prepared

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

## Transaction-gated production proof

`LIVE_APPLY_AND_VERIFY_V755S_KLAVERJAS_LIVE_ALIASES.sql` applies v755s and proves it in one transaction. It commits only if all of these pass:

- valid UUID/text 0-0 start with correct creator and zero scoring rounds;
- same-owner start replay returns the same active row;
- public UUID/text getter resolves the live row;
- owner update persists 40-20 with public `round_no=3`;
- cross-player update rejects with `klaverjas_match_owner_mismatch`;
- missing, invalid and stale sessions reject before writes;
- owner finish persists 120-90, `round_no=8`, status finished;
- same-owner finish replay is idempotent;
- direct web-role DML remains zero;
- write aliases are not PUBLIC executable;
- classic `jas_games`, entries and rating rebuild queue are unchanged;
- exact controlled match/session cleanup restores legacy baselines;
- controlled v766 residue=0;
- controlled v766 push jobs=0;
- Ice=2.8.

Any failed assertion aborts the migration and all controlled writes.

## Separate frontend defects — immediate next phase, not mixed into v766 backend repair

Two frontend defects are confirmed independently of the database aliases:

1. `startLive()` currently calls `normalizeMatchInput()` with 0-0 scores even though that validator rejects tied scores, so a normal live start can fail before RPC execution.
2. `klaverjas_live.html` says to start via the scorer, but the scorer has no start-live button.

These require a frontend release/version/cache-buster change and will be handled immediately after v755s is production-proven and merged. This backend branch deliberately does not change frontend files or the root version.
