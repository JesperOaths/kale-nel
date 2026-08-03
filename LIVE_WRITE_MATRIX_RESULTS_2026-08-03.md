# Live write matrix results — 2026-08-03

Branch: `agent/v764-live-write-matrix`

## Baseline checks

- Local branch created from `main`; merge commit `f6fefc4a1793dacd5661a4f334750e882040f8a9` included.
- Inventory committed: `4e0f87a` (`docs: inventory live write surfaces`).
- Matrix plan committed: `00295e1` (`docs: plan live write matrix`).
- No production writes performed before the inventory/plan phase.

## Results

| Row ID | Date/time | Sanitized actor identity | Before-state | Action performed | Expected result | Actual result | Unauthorized result | Duplicate/replay result | Rollback result | Final status | Relevant commit/migration |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DRINK-02 | 2026-08-03T04:04Z | Public anonymous read path / static repo scan | Production `VERSION` returned `v761`; production `drink_event_types` public read for key `ice` returned one row with `unit_value=2.8`; production `drinks_add.html` still contained a fallback `Ice` unit value of `3`; `get_drinks_page_public` returned `v690_empty_compat` without `event_types` for anonymous/no-session read | Read-only production fetches for `VERSION`, `gejast-config.js?v761`, `drinks_add.html`, `drinks.html`, Supabase `get_drinks_page_public`, and REST `drink_event_types?key=eq.ice`; then local branch hotfix changed only the fallback value in `drinks_add.html` from `3` to `2.8` and added `check-ice-unit-invariant.mjs` to `npm run verify:static` | Ice must be exactly `2.8` through DB and application read paths; no repository fallback or regression should permit Ice to appear as `3.0` | DB/public table read passed at `2.8`; app anonymous RPC did not expose event types; production static fallback failed by showing Ice as `3`; local branch fix and regression now pass | N/A — read-only invariant; no mutation attempted | Regression re-run: `npm run verify:static` passed and asserts no Ice `3.0` fallback in active drinks code/repair SQL | N/A — no production write; local branch fix pending deploy | PASS WITH DOCUMENTED LIMITATION: production DB is correct, branch fixes stale static fallback; production static fallback remains old until PR merge/deploy | `GEJAST_v755h_ice_unit_value_repair.sql`; commit `79e831f` |
| BRIDGE-01 | 2026-08-03T04:10Z / post-apply 04:34Z | Invalid/missing player session, anonymous public REST role, stale browser player session | Pre-fix `boerenbridge_matches` count was `98`; no existing rows for controlled `OC_V764_MATRIX_*` labels; live ACL granted `INSERT/UPDATE/DELETE` to `anon` and `authenticated`; live function had `PUBLIC`, `anon`, and `authenticated` execute and did not reject null player resolution | Pre-fix: called `save_boerenbridge_match` with invalid session and controlled client IDs, then deleted exact probe rows. Pre-apply: captured ACL and `pg_get_functiondef`, compared parity, prepared rollback. Applied amended `GEJAST_v755l_boerenbridge_write_auth_guard.sql`. Post-apply: missing session, invalid session, anonymous direct insert/update/delete, ACL checks, stale-session authorized-attempt check, Ice/version/no-push/no-OC-row checks | Invalid/missing/expired sessions reject; direct table writes blocked for `PUBLIC`, `anon`, and `authenticated`; function callable only by `anon/authenticated` and internally session-guarded; no row may persist with null owner | v755l applied successfully. Post-apply missing/null session rejected with `boerenbridge_session_invalid`; invalid session rejected with `boerenbridge_session_invalid`; anonymous direct `INSERT/UPDATE/DELETE` all returned permission denied; SQL ACL check showed table DML false for `PUBLIC`, `anon`, and `authenticated`; function execute false for `PUBLIC`, true for `anon/authenticated`. A stale browser player session was rejected, so no authorized controlled write was performed. | Unauthorized invalid-session write is now rejected; anonymous direct insert/update/delete are now rejected. Authenticated direct DML was verified by SQL ACL as false for `authenticated`; no Supabase Auth JWT was available for an HTTP authenticated-role DML probe. | Same-owner retry and other-player overwrite proof remain blocked because the available browser player session is stale/invalid and no second valid test player session is available. | Pre-fix probe rows `OC_V764_MATRIX_20260803_READONLY_BRIDGE` and `OC_V764_MATRIX_PROBE` were deleted exactly; post-apply no authorized row was created; final `OC_V764_MATRIX_*` lookup returned `[]`; match count returned to/stayed `98`; no push job sent/created | PASS for unauthorized/grant repair; BLOCKED for authorized same-owner/other-player behavior until valid test player sessions are available | `GEJAST_v755l_boerenbridge_write_auth_guard.sql`; rollback `GEJAST_v755l_boerenbridge_write_auth_guard_ROLLBACK.sql`; pre-apply review `BOERENBRIDGE_V755L_PREAPPLY_REVIEW_2026-08-03.md` |

## Post-apply verification summary

Commands passed after v755l apply:

- `npm run verify` — static checks and active JS syntax ok; files checked `330`.
- `npm run smoke:live` — live `VERSION` `v761`; core routes HTTP 200.
- `npm run smoke:beta:read` — 43 read-only beta/admin-protected routes ok.
- `npm run smoke:push` — latest workflow success, push health ok; no real push send triggered by this work.

Final production invariants:

- `VERSION` remains `v761`.
- Ice remains exactly `2.8`.
- `boerenbridge_matches` count is `98`; no `OC_V764_MATRIX_*` rows remain.
- `web_push_jobs` sent/failed/delivered/clicked targeted-test count remains `0` for this pass.
- Admin Worker/frontend were not changed.

## Current blocker / next executable row

Further authorized write rows (`PROFILE-01`, `DRINK-01/03`, `TOE-01`, and full Boerenbridge same-owner/other-player behavior) require valid test player sessions and exact rollback paths. Admin rows require a human admin login/TOTP.
