KALE NEL v582 MOBILE FOLLOW-UP PATCH

Type
- frontend/code patch only
- no SQL in this patch

Apply order
1) Upload all files in this zip to the repo root, replacing existing files with the same names.
2) Deploy main.
3) On mobile, clear site data once if old shells remain sticky.
4) Test these pages first:
   - scorer.html
   - boerenbridge.html
   - rad.html
   - paardenrace_live.html
   - pikken.html
   - pikken_live.html
   - beurs.html / despimarkt route
   - profiles.html
   - ballroom.html
   - pikken_ladder.html
   - paardenrace_ladder.html
   - caute_coins_ladder.html

Main contents
- scorer mobile cleanups
- boerenbridge popup density cleanup
- rad mobile centering and top-text removal
- paardenrace lobby-bounce safety for closed rooms
- pikken wording + unresolved-state bounce safety
- beurs direct alias to despimarkt
- profiles active-user inclusion + larger badge popup flow
- ballroom portrait best-effort hint/lock attempt
- richer ladder/stat presentation ideas and support blueprint
- shared mobile baseline version bump to v582

Notes
- Portrait cannot be hard-forced reliably in normal mobile browsers; this patch adds a best-effort orientation lock attempt and a portrait hint overlay.
- The ladder stats support file documents richer telemetry and ELO ideas that still need backend/stat capture work for the full version.
