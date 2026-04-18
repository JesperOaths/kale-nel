KALE NEL v584 — ladder / ELO / telemetry follow-up

What this patch does
- upgrades Pikken and Paardenrace ladder pages from generic placeholder ladders to richer pages that can consume real per-game stats
- adds real SQL ladder RPCs for Pikken and Paardenrace based on existing stored match/history data
- gives the newer ladder pages clearer bragging/story sections and an explicit calculation note
- improves the Caute Coins ladder with extra story/vibes sections so it feels less like a plain top-5 dump

Apply order
1) Upload the frontend/code files from the zip to the repo root, replacing the existing files.
2) Deploy the site.
3) Run the separate SQL file: gejast_v584_pikken_paardenrace_ladders_and_telemetry.sql
4) After SQL finishes, hard refresh the ladder pages.

Important notes
- SQL is intentionally separate and is NOT inside the zip.
- This SQL uses existing stored Pikken and Paardenrace match/history data; it does not wait for a future telemetry phase to become useful.
- Where the current stored data is richer, the ladder pages will immediately look better. Where the current stored data is thinner, the pages still degrade gracefully.

Touched ladder surfaces
- pikken_ladder.html
- paardenrace_ladder.html
- caute_coins_ladder.html
- gejast-despimarkt.js
- despimarkt-theme.css
- gejast-config.js
