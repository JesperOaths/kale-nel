KALE NEL V580 NO-SCRIPT REPLACEMENT BUNDLE

Upload these files directly to the repo / hosting as normal replacement files.
This bundle is focused on the current breakpoints:
- homepage staying stale outside incognito
- Beurs card/page placeholder behavior
- Pikken mobile lobby scrollability
- route-specific watermark suppression for Pikken / Paardenrace pages

Recommended order:
1. gejast-config.js
2. index.html
3. home-deep-links-v578.js
4. beurs.html
5. pikken.html
6. pikken-deep-mobile-v578.js
7. profiles-mobile-art-v578.js
8. paardenrace-deep-mobile-v578.js

After deploy:
- refresh once in a normal browser
- if a device still shows older shells, clear site data one time

No SQL is required for these frontend/cache-shell fixes.
