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
| DRINK-02 | 2026-08-03T04:04Z | Public anonymous read path / static repo scan | Production `VERSION` returned `v761`; production `drink_event_types` public read for key `ice` returned one row with `unit_value=2.8`; production `drinks_add.html` still contained a fallback `Ice` unit value of `3`; `get_drinks_page_public` returned `v690_empty_compat` without `event_types` for anonymous/no-session read | Read-only production fetches for `VERSION`, `gejast-config.js?v761`, `drinks_add.html`, `drinks.html`, Supabase `get_drinks_page_public`, and REST `drink_event_types?key=eq.ice`; then local branch hotfix changed only the fallback value in `drinks_add.html` from `3` to `2.8` and added `check-ice-unit-invariant.mjs` to `npm run verify:static` | Ice must be exactly `2.8` through DB and application read paths; no repository fallback or regression should permit Ice to appear as `3.0` | DB/public table read passed at `2.8`; app anonymous RPC did not expose event types; production static fallback failed by showing Ice as `3`; local branch fix and regression now pass | N/A — read-only invariant; no mutation attempted | Regression re-run: `npm run verify:static` passed and asserts no Ice `3.0` fallback in active drinks code/repair SQL | N/A — no production write; local branch fix pending commit/deploy | PASS WITH DOCUMENTED LIMITATION: production DB is correct, branch fixes stale static fallback; production static fallback remains old until PR merge/deploy | `GEJAST_v755h_ice_unit_value_repair.sql`; pending branch fix commit |

## Current blocker / next executable row

The next rows that mutate production (`PROFILE-01`, `DRINK-01/03`, `TOE-01`) require a valid test player session and exact rollback path confirmation from live schema. Admin rows require a human admin login/TOTP. No production write has been attempted yet.
