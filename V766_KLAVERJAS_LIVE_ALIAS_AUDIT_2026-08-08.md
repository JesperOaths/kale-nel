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

`LIVE_PREFLIGHT_V766_KLAVERJAS_LIVE_ALIASES.sql` confirmed before v755s:

- all four v687 live RPCs were not deployed;
- `save_klaverjas_match_v687` and hardened `klaverjas_upsert_match_state_scoped` retained session/client-id/owner/scope guards;
- legacy `klaverjas_get_live_match_public(bigint)` remained PUBLIC-executable but read-only and bigint-only;
- `klaverjas_matches` had unique text `client_match_id` plus `created_by_player_id`;
- v765 direct-DML boundary remained PASS with zero web-role INSERT/UPDATE/DELETE grants;
- baseline before v755s: matches=7, active=7, finished=0, abandoned=0, rounds=0, snapshots=0;
- controlled v766 residue=0;
- controlled v766 push rows=0;
- Ice=2.8.

## Confirmed UUID fallback incompatibility

The runtime generates UUID-capable `client_match_id` values. Its legacy live fallbacks target numeric APIs, so the old fallback cannot reliably support current UUID-backed live games.

## v755s repair — APPLIED + CONTROLLED PROOF PASS

v755s installs the exact text/UUID start/update/finish/get v687 aliases over the v755r-hardened persistence model. Write aliases authenticate, enforce creator ownership/scope, remove PUBLIC execute and preserve guarded anon/authenticated execution. The public getter is read-only and site-scope filtered. Direct table DML remains revoked.

`LIVE_APPLY_AND_VERIFY_V755S_KLAVERJAS_LIVE_ALIASES.sql` completed successfully in production and passed 0-0 UUID start, same-owner replay, public UUID read, owner update, cross-owner rejection, missing/invalid/stale sessions, owner finish, finish replay, direct-DML boundary, RPC execute boundary, rating/history isolation, exact cleanup, zero residue/push and Ice 2.8.

## Independent post-apply verifier correction

The first `LIVE_POSTAPPLY_V755S_VERIFY.sql` run passed every check except `public_live_getter_boundary`, which reported `PUBLIC=true, scope_filter=false, read_only=true`.

This was a verifier false negative, not a production scope leak. The deployed getter contains `where m.site_scope=v_scope`; the verifier searched for the formatting-specific string `m.site_scope = v_scope`. `pg_get_functiondef` preserved the no-space deployed formatting.

The corrected verifier now removes whitespace before checking:

- `v_scope := public._klaverjas_safe_scope(site_scope_input)`; and
- `where m.site_scope=v_scope`.

No production migration needs to be re-applied. One corrected read-only rerun is the only remaining v766 gate.

## Separate frontend defects — immediate next phase

1. `startLive()` currently runs through the finished-match validator and rejects a normal 0-0 start before RPC execution.
2. `klaverjas_live.html` says to start via the scorer, but the scorer has no Start Live action.

These require a frontend release/version/cache-buster change and will be handled immediately after v755s is independently verified and merged.
