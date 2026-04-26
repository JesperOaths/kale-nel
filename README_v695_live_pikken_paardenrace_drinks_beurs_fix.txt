GEJAST v695 live/Pikken/Paardenrace/drinks/Beurs fixpack

Apply order:
1. Upload/copy the changed site files.
2. Run GEJAST_v695_live_pikken_paardenrace_drinks_beurs_fix.sql in Supabase SQL editor.
3. Hard-refresh the site so v695 script URLs and gejast-config.js are used.

What this fixes:
- Pikken lobby lists now accept lobby_code or code fields and show backend errors instead of silently empty feeds.
- Pikken starts by generating server-side dice hands in pikken_round_hands; each logged-in player receives only their own hand in pikken_get_state_scoped.
- Pikken hand UI explains that 1 is pik/joker and gives a clear backend-hand warning if the SQL has not been run.
- Paardenrace player upsert no longer depends on ON CONFLICT(room_id, player_name_norm), fixing the missing unique/exclusion constraint error.
- Paardenrace Bakken obligations are copied into the drink_events pending verification flow through an after-insert trigger.
- Homepage no longer shows Offline just because ladder telemetry failed; local participant cards can become live spectator links for Pikken, Paardenrace and Beerpong.
- Beerpong no longer injects the empty runtime-admin/status chip.
- Profiles badge gallery now sorts easy-to-hard instead of hard-first.
- Beurs/Despimarkt frontend no longer displays the bad 1000 default as the visible default wallet when there is no ledger; v695 SQL also normalizes stale 1000 no-ledger wallets to 100 where the expected tables exist.

Main files:
- GEJAST_v695_live_pikken_paardenrace_drinks_beurs_fix.sql
- gejast-pikken.js
- gejast-pikken-contract.js
- gejast-despimarkt.js
- gejast-config.js
- index.html
- profiles.html
- beerpong.html
- beurs.html / despimarkt*.html
- VERSION
