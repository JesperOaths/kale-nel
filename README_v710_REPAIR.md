# GEJAST v710 Repair Update

This is an update-folder style delivery for the v709 repair line.

## Upload/add to GitHub

Add this new frontend file:

- `gejast-v710-repair.js`

Apply this small patch to existing files:

- `APPLY_v710_REPAIR.patch`

That patch:

- bumps `VERSION` from `v709` to `v710`;
- bumps `GEJAST_CONFIG.VERSION` from `v709` to `v710`;
- loads `gejast-v710-repair.js?v710` from `gejast-config.js`.

## Run in Supabase

Run separately:

- `GEJAST_v710_verified_speed_leaderboards.sql`

This adds `get_verified_speed_leaderboards_v710(site_scope_input text)` for the drinks page speed dropdown/list.

## What the repair runtime does

- Moves the Pikken live action dock to the top of the page flow, directly after the topbar, so it is visible from the start.
- Keeps the dock sticky, mobile-friendly, and in-flow so it does not cover the dice hand.
- Removes the useless `mobileContext` / statuslaag dock box from Pikken live.
- Adds client-side host/requirements guardrails for Pikken start.
- Adds client-side host/requirements guardrails for Paardenrace start.
- Keeps Paardenrace start using the existing server RPC `start_paardenrace_countdown_safe`; it does not fake a start locally.
- Filters shots/shotjes/shooters from drinks speed dropdown display.
- Uses the new SQL RPC to render all verified speed attempt players per drink type when available.
- Adds CSS guards so badge images in profile badge accordions keep a square, non-distorted size.

## Plan only

`GEJAST_v710_ELO_PREDICTION_INTEGRATION_PLAN.md` is intentionally a plan only. Do not execute it as part of this repair patch.

## Verification still required

This patch has syntax-checked `gejast-v710-repair.js`, but it has not been live-tested against Supabase/mobile browsers in this environment.

Required browser checks:

1. Pikken live: dock visible immediately, sticky, does not cover dice, bid/reject/vote buttons usable on mobile.
2. Pikken lobby: only host can start, and only after all requirements are met.
3. Paardenrace lobby: only host can start, and only after all requirements are met.
4. Paardenrace: start button calls existing start RPC and redirects/updates after success.
5. Drinks page: speed dropdown excludes shots and displays verified speed attempts by player.
6. Profiles: badge table/accordion icons remain square and not stretched.
