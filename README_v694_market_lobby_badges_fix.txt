GEJAST v694 market/lobby/badges fix

Apply order:
1. Upload the files from this bundle to the GitHub repo.
2. Run GEJAST_v694_market_lobby_badges_fix.sql in Supabase SQL editor after v693.
3. Hard refresh the browser or clear the GitHub Pages cache once after deploy.

What this fixes:
- Paardenrace create lobby ambiguity by dropping all create_paardenrace_room_safe/create_paardenrace_room_fast_v687 overloads and recreating one canonical signature.
- Pikken open lobby feed now hides stale one-person lobby rows older than 90 minutes and de-duplicates by lobby code.
- Site version is bumped to v694 in shared config and touched pages.
- Beurs d'Espinoza is restored as the active Despimarkt market hub with open markets, wallet, market creation, debts and ladder links.
- Klaverjassen scorer opens the setup popup immediately and refreshes active-player names in the background instead of blocking page startup.
- Klaverjassen mojibake in visible scorer controls is cleaned.
- Profiles badge gallery now uses the actual badge-progress export and renders accordion rows with rarity, description and requirements.
- Rad pointer triangle is flipped to point toward the wheel.

Notes:
- This SQL does not recreate admin login/session/mail owner functions.
- The Despimarkt RPC names remain v669 because those are the existing production market RPCs; the shipped page/cache version is v694.
