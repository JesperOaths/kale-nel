GEJAST v696 follow-up

Apply order:
1. Upload the v696 site files.
2. Run GEJAST_v696_live_pikken_paardenrace_beurs_followup.sql in Supabase.
3. Hard-refresh the browser.

Fixes in this follow-up:
- Paardenrace lobby page no longer runs idle-lobby cleanup inside the hot polling loop. That cleanup could race the newly created room and make lobby/admin info appear for a moment and then disappear.
- Pikken lobby page now sends every participant to pikken_live.html as soon as the game leaves lobby phase.
- Pikken live page now polls faster, detects deleted games faster, and returns players to the lobby page when a destroyed game is gone.
- Pikken dice now render in the live page status box area, sorted 2,3,4,5,6,pik.
- Pikken live totals now use SQL dice_totals with a frontend fallback, so a 2-player 6-dice start displays 12/12 instead of 0/0.
- Beurs now has visible active bets/positions on the hub, visible Admin bets navigation, and admin market cards render resolve/refund/delete buttons from the shared runtime JS.

Important:
- The Beurs frontend can only show markets/positions returned by the existing v669 Despimarkt RPCs. This follow-up makes the UI complete for that payload and exposes the admin controls; if Supabase is returning zero markets, the missing piece is in the market RPC/data, not the page shell.
