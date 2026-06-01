# GEJAST v725 local repair status

Date: 2026-06-01

## Local frontend repair completed

- Root `VERSION` is `v725`.
- `gejast-config.js` declares `v725` and loads `gejast-v725-repair.js`.
- Active frontend cache-busters/page labels are aligned to `v725`.
- `gejast-v725-repair.js` maps Pikken/Paardenrace calls to committed canonical RPC names:
  - `get_pikken_open_lobbies_fast_v687`
  - `get_pikken_live_matches_fast_v687`
  - `pikken_create_lobby_fast_v687`
  - `pikken_join_lobby_fast_v687`
  - `pikken_start_game_scoped`
  - `pikken_update_lobby_config_v715`
  - `cleanup_stale_pikken_rooms_v706`
  - `get_paardenrace_room_state_fast_v687`
  - `cleanup_stale_paardenrace_rooms_v718`
- `admin_despimarkt_runtime.html` had a broken inline script callback and now parses.

## Guardrails added/updated

- `check-version-drift.mjs`
- `fix-version-drift.mjs`
- `check-rpc-coverage.mjs`
- `check-local-refs.mjs`

## Local verification passed

- Active JS syntax sweep passed.
- Active inline HTML script parse sweep passed.
- `node check-version-drift.mjs` passed.
- `node check-rpc-coverage.mjs` passed.
- `node check-local-refs.mjs` passed.
- Local HTTP smoke returned `200` for 122 active HTML pages.

## Backend / deployment boundary

No Supabase SQL was applied from this local repair pass.

Recommended backend path before live browser testing:

1. Confirm the existing Pikken SQL lineage through at least `v715`, `v716`, and current production repair files is applied.
2. Apply the safer wrapper repair `GEJAST_v725a_SURGICAL_rpc_wrapper_repair.sql` if Paardenrace RPC ambiguity or `Room niet gevonden` / schema-cache issues remain.
3. Avoid running `GEJAST_v725_pikken_paardenrace_pipeline_contract.sql` unless you intentionally want the broader Pikken + Paardenrace pipeline rewrite. The `v725a` notes explicitly say the broad `v725` SQL was too broad.
4. Reload PostgREST schema after SQL changes.
5. Hard refresh deployed pages after uploading the frontend.

## Live verification still required

- Pikken: create lobby, join, ready, start, bid/reject/vote, finish, archive/stat persistence.
- Paardenrace: create room, join from visible lobby card, suit/wager, ready/unready, host start, live page URL normalization.
- Beurs/Despimarkt: dashboard, wallet, market create, positions, admin actions.
- Drinks/push: create/verify flows and push health only after the above is stable.
