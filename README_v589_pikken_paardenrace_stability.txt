KALE NEL v589 — PIKKEN / PAARDENRACE STABILITY PATCH

What this patch targets
- mobile crashes / freezes on paardenrace_live.html
- mobile freezes / crashy interaction on pikken.html and pikken_live.html

Main fixes
1) Paardenrace live
- declares the missing live-loader state flags that were being used before declaration
- reduces poll pressure from 1200ms to 1800ms
- prevents overlapping live loads with a single-flight queue
- avoids full board rerenders when the board state did not actually change
- keeps the bounce-to-lobby behavior when a room is gone or closed

2) Paardenrace mobile helper
- removes the full-body MutationObserver loop
- replaces it with a lightweight periodic refresh for the mini latest-card surface

3) Pikken mobile helper
- removes the full-body MutationObserver loop
- replaces it with a lightweight UI refresh pass
- slows open-lobby refresh from 5s to 10s
- fixes fallback live-link construction to use lobby_code / match_ref style params instead of the loose lobby param

4) Cache busting / activation
- gejast-config.js bumped to v589 so the helper modules load with a fresh query line
- pikken.html, pikken_live.html, paardenrace_live.html point to gejast-config.js?v635

Files included
- gejast-config.js
- pikken.html
- pikken_live.html
- paardenrace_live.html
- pikken-deep-mobile-v578.js
- paardenrace-deep-mobile-v578.js
- PATCH_MANIFEST_v589.txt

No SQL is needed for this patch.

Apply order
1) Upload these files to the repo root.
2) Deploy.
3) Clear site data / hard refresh on the affected phone browser once.
4) Re-test only these pages first:
   - /pikken.html
   - /pikken_live.html
   - /paardenrace_live.html

Honesty note
This patch fixes the two strongest concrete crash sources visible in the current repo code:
- undeclared live-loader flags in paardenrace_live.html
- expensive full-body MutationObserver loops in the mobile helper modules
