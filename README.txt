v578 version convergence patch

What this does
- sets window.GEJAST_PAGE_VERSION to v578 on the main entry HTML pages
- updates gejast-config.js query strings to ?v578 on those pages
- bumps direct live-game owner script URLs to ?v578 for:
  - gejast-pikken.js
  - gejast-paardenrace.js
- keeps Pikken / Paardenrace lobby, live, and stats pages explicitly clean of the version watermark by adding data-hide-version-watermark="1"

Why it is delivered as an in-place script
- this avoids overwriting newer HTML content in your repo with stale full-page copies
- it makes the change directly against whatever the current repo HTML is

How to use
1. Put this script in the repo root
2. Run:
   python apply_v578_version_convergence.py
3. Commit the changed HTML files
4. Deploy / wait for hosting sync
5. On mobile, hard refresh or clear site data once

Expected primary files touched
- index.html
- profiles.html
- pikken.html
- pikken_live.html
- pikken_stats.html
- paardenrace.html
- paardenrace_live.html
- paardenrace_stats.html

The script also attempts the earlier wave pages and admin/ladder entry pages so they converge if present.
