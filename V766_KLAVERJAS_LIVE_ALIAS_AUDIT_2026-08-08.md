# v766 Klaverjas live-alias audit — 2026-08-08

Branch: `agent/v766-klaverjas-live-aliases`
Base: v765 merge commit `8962f3e4b28f6ed9a4c215164cd7aa334578283f`
Mode: backend live-alias compatibility/security follow-up. No production writes yet.

## v765 state inherited

v755r is deployed and independently verified:

- `save_klaverjas_match_v687(text,text,text,jsonb,text)` exists;
- current finished-score UUID/text save is session-validated and creator-owned;
- same-owner replay is idempotent and cross-player reuse rejects;
- legacy `klaverjas_upsert_match_state_scoped(...)` now validates `_jas_session_player` and enforces ownership;
- direct web-role DML on inventoried Klaverjas persistence surfaces is zero;
- controlled residue/push jobs are zero;
- Ice remains 2.8.

## Current runtime live contracts

`gejast-klaverjas-runtime.js` currently calls:

1. `start_klaverjas_live_match_v687(session_token_input, client_match_id_input, match_payload, site_scope_input)`;
2. `update_klaverjas_live_match_v687(session_token_input, client_match_id_input, patch_payload, site_scope_input)`;
3. `finish_klaverjas_live_match_v687(session_token_input, client_match_id_input, patch_payload, site_scope_input)`;
4. `get_klaverjas_live_state_public_v687(client_match_id_input, site_scope_input)`.

v765 production preflight already proved `start_klaverjas_live_match_v687` and `finish_klaverjas_live_match_v687` were absent before the v755r repair. v755r deliberately did not invent these aliases.

## Confirmed fallback incompatibility

The runtime generates UUID-capable `client_match_id` values. Its legacy live fallbacks still target numeric APIs:

- `startLive()` falls back to `klaverjas_upsert_match_state_scoped(... match_id_input bigint ...)` but `legacyPayload()` passes UUID client IDs through as `match_id_input`;
- `updateLive()` / `finishLive()` fall back through `klaverjas_get_live_match_public(match_id_input bigint)` before calling the hardened upsert;
- `getLive()` falls back through the same bigint public read function.

Therefore UUID-backed live games require the v687 text-client-ID aliases; the old numeric fallback is not a reliable compatibility path.

## Separate frontend defects found, deliberately out of v766 backend scope

Two frontend defects are also confirmed:

1. `startLive()` currently calls `normalizeMatchInput()` with 0–0 scores, while that validator rejects any tied score. A normal new live game can therefore fail before RPC execution.
2. `klaverjas_live.html` says a live game should be started via the scorer, but the current scorer page has no start-live button; it only has the finished-match Save action and a link to the live viewer.

Those frontend changes require the project-wide frontend version/cache-buster convention and will be handled as the immediate next frontend phase after the backend live alias contract is proven. They are not silently mixed into this database-only branch.

## v766 objectives

1. Inventory which of the four current v687 live RPCs are actually deployed after v755r.
2. Capture their signatures/SECURITY DEFINER status/ACLs and definitions if present.
3. Add missing aliases as narrow wrappers over the now-hardened legacy persistence model using text `client_match_id` lookup.
4. Require `_jas_session_player` before start/update/finish writes.
5. Enforce creator ownership on update/finish.
6. Keep public live reads read-only and scoped.
7. Preserve the existing `klaverjas_matches` / rounds / snapshots model and avoid classic `jas_games` rating side effects.
8. Prove start → update → finish → read with a controlled text/UUID client ID in one transaction, then remove all controlled rows.
9. Preserve v765 ACL boundaries, zero controlled push jobs, and Ice 2.8.

## Next artifact

`LIVE_PREFLIGHT_V766_KLAVERJAS_LIVE_ALIASES.sql` is read-only and inventories the live RPC deployment, grants, definitions, schema invariants, baseline statuses, residue and v765 boundary state.
