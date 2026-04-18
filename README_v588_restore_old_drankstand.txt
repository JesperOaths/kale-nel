KALE NEL v588 HOMEPAGE DRANKSTAND RESTORE PATCH

What this patch does
- restores the older homepage Drankstand implementation from the user-supplied previous index.html
- brings back the exact Drankstand button/box structure:
  - Vandaag
  - Verifiëren
  - Snelheids poging
  - Drinks toevoegen
- restores the four drinks ladder cards:
  - Vandaag / Units
  - All-time / Units
  - rotating speed Top 5 box by drink type / Seconden
  - Grootste Speler / All-time
- keeps the speed-rotation behavior and the non-shot drink type cycling logic from that earlier implementation
- updates the homepage page-version line to v588 and uses gejast-config.js?v588 as the cache-busting script URL
- keeps Beurs d'Espinoza pointed straight to despimarkt.html in this restored homepage shell

Notes
- This patch intentionally restores the older homepage Drankstand behavior using the uploaded previous index.html as source truth.
- No SQL is needed.
- Upload index.html to the repo root, deploy, and hard refresh the homepage once.
