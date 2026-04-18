KALE NEL v583 MOBILE DEEP FOLLOW-UP PATCH

Apply order
1) Upload all files in this zip as flat replacement files to the repo root.
2) Deploy main.
3) On a normal phone browser, hard refresh or clear site data once if stale shells persist.
4) Validate these routes first:
   - scorer.html
   - boerenbridge.html
   - rad.html
   - profiles.html
   - pikken.html
   - pikken_live.html
   - paardenrace.html
   - paardenrace_live.html
   - pikken_ladder.html
   - paardenrace_ladder.html
   - caute_coins_ladder.html
   - beurs.html
   - ballroom.html

What this patch is for
- deeper mobile hardening for Pikken and Paardenrace
- remove the manual Tick countdown button from Paardenrace and let code drive ticking more safely
- rename Nieuwe ronde resetten to Nieuwe Ronde Nieuwe Kansen
- calmer and safer mobile behavior across scorer / boerenbridge / rad / profiles / ballroom
- richer bragging/stat presentation for the newest ladder surfaces

No SQL is included in this patch.

Honesty note
This patch was built from a repo-wide static/code audit and direct source inspection. It is not based on true live device rendering from inside this environment.
