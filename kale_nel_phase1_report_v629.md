# Kale Nel Phase 1 Report — v629

## Scope completed
Phase 1 from the prior plan:
- version drift hardening
- login dropdown/runtime mismatch fix
- universal logged-out redirect hardening
- scope + activation-aware player dropdown helper
- preserve the existing index speed-attempt routing if already correct
- preserve the existing drydock removal on drinks speed if already correct

## VERIFIED findings from this pass
- The current root `gejast-config.js` in the repo snapshot and GitHub main was effectively stripped to a version-only stub. That meant helper functions expected by pages like `login.html` did not exist at runtime.
- The current root `gejast-home-gate.js` was older and weaker than the stronger copy present in `repo/gejast-home-gate.js`.
- `login.html` already expected `readCachedLoginNames`, `writeCachedLoginNames`, and an activation-aware name helper from `GEJAST_CONFIG`.
- `index.html` already routes the **Snelheids poging** box to `./drinks_speed.html`, so no functional correction was needed there.
- `drinks_speed.html` already filtered out `shot`, `drydock`, and `dry_dock`, and already filtered rendered top attempts down to verified attempts.

## Root causes addressed
### 1. Login dropdown mismatch
The page-side login logic was newer than the active root config file. The page expected helper methods that were missing because the deployed root config had regressed to a tiny version-only file.

### 2. Incomplete session gating
The root gate script only handled the no-token case immediately and did not consistently force users home once async validation concluded that the session was invalid or mismatched.

### 3. Version drift across pages
A large portion of root HTML files referenced mixed `?v...` values. That makes browsers hold onto stale JS even after a deploy, which directly explains “still seeing old errors” style behavior.

## What was changed
### Core runtime files
- `gejast-config.js`
  - replaced the stripped root config with a fuller runtime config based on the stronger repo copy
  - bumped visible/runtime version to **v629**
  - restored watermark/version-label handling
  - restored session helpers (`getPlayerSessionToken`, `setPlayerSessionToken`, `clearPlayerSessionTokens`, keepalive helpers, redirect builders, etc.)
  - added login-name cache helpers:
    - `readCachedLoginNames(scope)`
    - `writeCachedLoginNames(names, scope)`
  - added activation-aware dropdown helper:
    - `fetchScopedActivePlayerNames(scope)`
    - alias `getActivatedPlayerNamesForScope(scope)`
  - activation helper behavior:
    - prefers stronger activation-bearing sources when available
    - accepts PIN-like signals or statuses `active` / `approved` / `activated`
    - falls back to softer scoped/generic sources so dropdowns do not go empty when stronger metadata is absent
  - re-exposed `getPlayerName()` for consumers that expect it

- `gejast-home-gate.js`
  - replaced root copy with the stronger repo copy
  - hardened async validation behavior so invalid or scope-mismatched sessions are cleared and redirected home
  - still preserves the softer “unknown/transient backend issue” path so temporary lookup failures do not nuke a valid session

### Version drift controls
- added `VERSION` at repo root with `629`
- added `bump-version.sh` at repo root
- also added `scripts/bump-version.sh`
- bulk-normalized local JS query versions in root HTML pages to `?v629`
- bulk-normalized `window.GEJAST_PAGE_VERSION` markers to `v629`

### Gate coverage
Injected `gejast-home-gate.js?v661` into root pages that had config loaded but were missing the player gate, including the despimarkt/admin/live/ladder pages that were still missing it in the snapshot.

## What was intentionally left alone
- No SQL changes were made.
- No existing features or data surfaces were removed.
- `index.html` speed-attempt routing was already correct and was preserved.
- `drinks_speed.html` drydock/shots filtering was already correct and was preserved.

## Files materially touched in Phase 1
High-signal runtime files:
- `gejast-config.js`
- `gejast-home-gate.js`
- `VERSION`
- `bump-version.sh`
- `scripts/bump-version.sh`

Broad version/gate normalization touched the root HTML surface set as well, so the patch bundle includes the changed HTML files.

## Expected outcomes
- login dropdown/runtime mismatch should stop occurring from the missing-helper side
- pages that already prefer the shared config helper for player lists should now use the correct scope-aware / activation-aware source path
- invalid sessions should be redirected home more reliably instead of lingering on private pages
- stale-JS behavior from mixed query versions should be significantly reduced because root HTML now points at one unified frontend version

## Remaining limitations / honesty boundary
- This patch is built from the uploaded GitHub zip snapshot plus direct checks of current GitHub main for key files, not from a full live deployment trace.
- I did not change backend SQL/RPC signatures in this phase.
- If a specific dropdown still shows the wrong users after this patch, the next place to inspect is that page’s local fallback logic or the backend rows returned by the scoped RPC/table source.
