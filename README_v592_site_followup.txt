KALE NEL v592 site follow-up

This frontend patch focuses on:
- homepage live-pill and route cleanup
- newest ladder/top-5 pages opening the correct dedicated stats pages
- Pikken lobby flow moved much closer to the Paardenrace lobby model
- badge art cleanup for the remaining die-heavy badges

What changed
1. index.html
- homepage top-5 cards for Pikken, Paardenrace and Caute Coins now route to their dedicated stats pages instead of the old generic ladder.html route
- homepage live pill no longer stays stuck on Stand-by when the old shell bundle path misses ladders/live data; it now still falls back to the direct loaders

2. ladder.html
- if someone still lands on ladder.html with game=pikken / paardenrace / caute-coins / despimarkt, the page redirects to the dedicated stats page instead of surfacing game_key ongeldig

3. pikken.html + gejast-pikken.js
- one shared lobby code field for create + join, like Paardenrace
- visible live/open lobby lists on the lobby page
- room rail added to the top of the lobby page
- host can now delete the lobby, leave the lobby, start the game, and (after SQL) kick players out of the lobby
- create flow can rename the generated lobby to the typed code after creation when the SQL helper is present

4. badges
- the die motif stays on Pikmeester / De Dobbelbaas as the best-fitting badge
- replacement art supplied for:
  - pikken_dubbelzes
  - pikken_eersteprik
  - pikken_zesjesregen
  - pikken_dobbelbaron
  - dobbelofniets
- matching mini-48 and mini-64 versions are included
- BADGE_ART_PROMPTS_v592.txt contains the reusable prompts/style notes for the new direction

Separate SQL
- Run gejast_v592_pikken_lobby_and_ballroom_reset.sql after deploying the frontend files
- That SQL adds:
  - Ballroom daily 06:00 reset behavior on safe-state reads
  - Pikken custom lobby-code helper
  - Pikken open/live lobby listing helper
  - Pikken host kick helper

Important honesty notes
- The dedicated Pikken / Paardenrace / Despimarkt stats pages already existed; the main problem was that the homepage and generic ladder route were still pointing at the wrong page for those newer game keys.
- The Ballroom reset fix is backend/SQL work, not a frontend-only fix.
