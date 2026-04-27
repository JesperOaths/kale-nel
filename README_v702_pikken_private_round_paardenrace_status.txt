GEJAST v702 - Pikken private reveal + round resolution + Paardenrace status cleanup

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
- GEJAST_v702_pikken_private_reveal_round_resolution_paardenrace_status.sql

What this fixes:
- Pikken no longer exposes everyone else's dice in last_reveal. The backend now stores only the bid result, counted hits, loser, loser seat, and loser dice count after penalty.
- The bidder cannot approve/reject/vote on his own challenged bid.
- When all non-bidders have voted, the backend resolves the challenge, subtracts exactly one die from the loser, eliminates at zero dice, deals a fresh next round, and starts the next round without leaking hidden hands.
- Paardenrace ready is redefined as a single unambiguous RPC signature.
- Paardenrace lobby page clears stale "Room niet gevonden" after a successful state load, so a visible lobby does not keep showing the wrong red error.

Important:
- This folder is not a zip.
- The SQL sends PostgREST reload notifications at the end. If Supabase still shows an old function signature immediately after running it, wait briefly and refresh the page hard.
