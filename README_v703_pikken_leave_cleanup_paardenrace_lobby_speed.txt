GEJAST v703 - Pikken leave cleanup + Paardenrace lobby speed/recognition

Upload/copy these frontend files to the site root:
- VERSION
- gejast-config.js
- gejast-pikken-contract.js
- gejast-pikken-live.js
- gejast-pikken.js
- pikken.html
- pikken_live.html
- paardenrace.html

Run this SQL in Supabase:
- GEJAST_v703_pikken_leave_cleanup_paardenrace_lobby_speed.sql

Fixes:
- Pikken live/lobby clears the stored match as soon as the current viewer is no longer a participant, so leaving a match cannot auto-forward you back into the live page.
- Pikken leave RPC now removes the leaving player from votes/hands/players and marks the match deleted once only 1 active player remains.
- Paardenrace clears stale "Room niet gevonden" any time a real room state is applied.
- Paardenrace lobby polling prioritizes the current room state and throttles open-lobby refreshes to reduce lag.
- Paardenrace open-lobby calls use shorter timeouts and no longer block the main room sync.

Note:
- This is a normal folder update, not a zip.
