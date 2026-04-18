KALE NEL v591 — PIKKEN LOBBY FLOW MORE LIKE PAARDENRACE

What this patch does
- reshapes the Pikken lobby page so creation/joining feels more like Paardenrace
- uses one shared lobby code field for both create and join
- adds live/open lobby lists directly on the page
- adds a room rail summary for the current lobby
- keeps the core Pikken lobby logic and participant/state truth intact
- keeps admin pages untouched

Files
- gejast-config.js
- pikken.html
- pikken_live.html
- pikken-deep-mobile-v578.js

Apply order
1. Upload these replacement files to the repo root
2. Deploy
3. Hard refresh pikken.html and pikken_live.html once

Notes
- No SQL is needed
- This is a frontend/code patch
- Visible version line bumped to v591
