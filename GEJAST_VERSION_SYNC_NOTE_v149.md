# GEJAST Sitewide Version Sync Note v149

## Root rule
All visible watermarks/version labels must be driven by `gejast-config.js`, not by hardcoded page strings.

## What was changed
- Added wider selector coverage in `gejast-config.js` so it also updates `.watermark`.
- Added `data-version-watermark` to visible version tags across root HTML pages.
- Added a small inline version-sync call before `</body>` so pages re-apply the config label after DOM load.

## Admin session cleanup phase
This phase continues the shared admin-session direction: the site should reuse one admin session across admin pages instead of asking for repeated logins.
