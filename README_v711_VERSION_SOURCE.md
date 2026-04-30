# GEJAST v711 Version Source-of-Truth Update

Purpose: stop version drift by making root `VERSION` the practical source of truth for visible page version labels and by adding scripts that find/fix stale hardcoded page/script versions.

## Files

- `VERSION` — set to `v711`.
- `gejast-version-source-of-truth.js` — browser runtime that reads `./VERSION` and updates `window.GEJAST_SITE_VERSION`, `window.GEJAST_PAGE_VERSION`, `window.GEJAST_CONFIG.VERSION`, and all visible `Made by Bruis` watermarks.
- `fix-version-drift.mjs` — rewrites stale `?v###`, `GEJAST_PAGE_VERSION`, `GEJAST_SITE_VERSION`, `VERSION:'v###'`, and visible `Made by Bruis` labels to the root version.
- `check-version-drift.mjs` — fails if active frontend files still contain stale versions.
- `gejast-config.v711.patch` — patch snippet to load the browser version source-of-truth runtime from `gejast-config.js`.

## Required repo steps

```bash
node fix-version-drift.mjs
node check-version-drift.mjs
```

Then commit every touched active page/helper file.

## Important

This is intentionally not SQL. It does not alter game truth, stats truth, push truth, profile truth, or any Supabase-owned state.
