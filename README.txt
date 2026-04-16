GEJAST V552 CODEX REPO OVERLAY

Baseline:
- Built against the latest repo zip extracted from:
  C:\Users\jespe\Documents\wordt-er-gejast\tmp\artifact_review_20260416\kale-nel-main (12)\kale-nel-main

What this bundle contains:
- repo\  -> overlay files to copy onto the repo root
- sql\gejast_v552_codex_games_stats_bundle.sql -> one combined SQL handoff file
- sql\upstream\ -> the original SQL source files used to build the combined SQL
- docs\overlay_files.txt -> exact overlay file list
- apply_overlay.ps1 -> optional helper script to copy repo\ onto a target repo path

Main focus of this overlay:
- Pikken lobby-to-live handoff fix: restore active lobby state across pages, recover old `match_ref` / lobby-code links into the real game id, and treat `status=live` as a real start signal
- Pikken lobby cleanup + leave flow: add a clean leave button on the lobby page and ship a SQL patch that prunes currently empty Pikken lobbies when applied
- Pikken public stats page and scope-safe links
- Paardenrace public stats page, live/lobby scope-safe links, and room URL handling
- Rad public/admin stats and fixed target nomination logging
- Beurs d'Espinoza public/admin stats links and scope-safe navigation
- Shared game HQ pages plus required session/runtime files
- Boerenbridge table render cleanup to remove duplicate static/dynamic header ids

Suggested apply order:
1. Start from the latest GitHub repo baseline.
2. Copy everything from repo\ onto the repo root, overwriting files.
3. Run sql\gejast_v552_codex_games_stats_bundle.sql on the same database.
4. Smoke-test:
   - pikken.html / pikken_live.html / pikken_stats.html
   - paardenrace.html / paardenrace_live.html / paardenrace_stats.html
   - rad.html / rad_stats.html / admin_rad.html
   - despimarkt.html / despimarkt_stats.html / admin_despimarkt.html

Notes:
- This is a curated overlay of my edits only, not a dump of all historical differences in the local workspace.
- The combined SQL is assembled from the four upstream SQL files included in sql\upstream\.
- Running the combined SQL now also prunes already-empty Pikken lobbies once, immediately.
