# Kale Nel Function And Feature Audit - 2026-06-03

Source of truth checked: `C:\Users\jespe\Documents\wordt-er-gejast\tmp\github-kale-nel-main`

Live site checked: `https://kalenel.nl`

Current version: `v732`

Latest commit checked: `a5af49d Fix push subscription readiness badge`

## Folder Scope

- [VERIFIED] The parent `wordt-er-gejast` folder contains many archives, patch bundles, old extracted checkouts, images, SQL dumps, and temporary browser/profile folders.
- [VERIFIED] The active implementation source is the Git checkout under `tmp/github-kale-nel-main`.
- [REFERENCE] Older folders such as `kale-nel-main`, `kale-nel-main (1)`, `kale-nel-main (14)`, `kale-nel-main(18)`, `patch_bundles`, and `migration handof` are useful history, but should not be treated as the current editable source unless explicitly chosen.

## Verification Run

- [VERIFIED COMPLETE] `npm.cmd run verify`
  - version drift: clean
  - RPC coverage: ok, 104 frontend RPCs mapped against 561 SQL functions
  - local static references: all active HTML `src`/`href` refs found
  - active JS syntax: ok, 146 files checked
- [VERIFIED COMPLETE] `npm.cmd run smoke:live`
  - live `VERSION`: `v732`
  - public routes HTTP 200: `/`, `/index.html`, `/pikken.html`, `/paardenrace.html`, `/scorer.html`, `/beerpong.html`, `/boerenbridge.html`, `/despimarkt.html`, `/beurs.html`, `/rad.html`, `/profiles.html`, `/login.html`
- [VERIFIED COMPLETE] `npm.cmd run smoke:push`
  - GitHub Actions push dispatcher latest checked run completed successfully
  - drinks pending summary RPC returned HTTP 200
  - drinks push eligibility RPC returned HTTP 200
  - nearby push queue RPC returned HTTP 200 safe zero-queue state
  - invalid test push session rejected as expected
- [VERIFIED SURFACE] `npm.cmd run smoke:games`
  - Pikken open lobby and live match surfaces responded
  - Paardenrace open room and stats surfaces responded
  - true token-backed two-player flow is available behind env tokens and was previously run successfully, but the public smoke run skips it by design

## Active Code Counts

- [VERIFIED] Active repo files scanned: 1164
- [VERIFIED] HTML files: 158
- [VERIFIED] JavaScript files: 154
- [VERIFIED] SQL files: 154
- [VERIFIED] SQL function definitions found by the repo checker: 561
- [VERIFIED] frontend RPC references covered by checker: 104

## Feature And Function Inventory

| Area | Status | Main files / modules | Notes |
|---|---|---|---|
| Versioning and deployment guardrails | VERIFIED COMPLETE | `VERSION`, `gejast-version-source.js`, `gejast-version-source-of-truth.js`, `fix-version-drift.mjs`, `check-version-drift.mjs`, `check-live-routes.mjs` | `v732` is live and route smoke passes. |
| Static reference and JS syntax checks | VERIFIED COMPLETE | `check-local-refs.mjs`, `check-active-js-syntax.mjs`, `package.json` | Current verification command passes. |
| Account activation and login | VERIFIED SURFACE | `login.html`, `activate.html`, `request.html`, `gejast-account-runtime.js`, `gejast-login-names-fallback.js`, `admin_claims.html` | UI and active-login dropdown were live-tested. Full admin approval/email flow still needs admin-side manual proof if desired. |
| Player session/runtime | VERIFIED SURFACE | `gejast-player-session-ui.js`, `gejast-home-gate.js`, `gejast-home-profile-runtime.js`, `gejast-player-selector.js`, `admin-session-sync.js` | Login/session works for live browser checks. |
| Profiles | VERIFIED SURFACE | `profiles.html`, `my_profile.html`, `gejast-profile-source.js`, `gejast-profiles-restore.js`, `profiles-mobile-art-v578.js` | Public profile route loads; profile editing not mutation-tested in this pass. |
| Badges | VERIFIED SURFACE | `gejast-badges.js`, `badge-registry.js`, `assets/badges/*`, `badge-metadata.json` | Assets and modules present; static refs pass. Award correctness needs scenario tests. |
| Homepage/runtime bundle | VERIFIED COMPLETE | `index.html`, `home.html`, `gejast-home-profile-runtime.js`, `GEJAST_v729_homepage_runtime_bundle_overload_fix.sql` | Live route passes and earlier RPC overload ambiguity was resolved. |
| Pikken lobby/live game | VERIFIED SURFACE | `pikken.html`, `pikken_live.html`, `pikken_spectator.html`, `gejast-pikken-contract.js`, `gejast-pikken-live.js`, `gejast-pikken-shared-stats.js`, `check-live-game-flows.mjs` | Public smoke passes; prior token-backed two-player harness passed. Browser board rendering still deserves a visual pass. |
| Paardenrace lobby/live game | VERIFIED SURFACE | `paardenrace.html`, `paardenrace_live.html`, `paardenrace_spectator.html`, `gejast-paardenrace.js`, `gejast-paardenrace-input-guard.js`, `check-live-game-flows.mjs` | Public smoke passes; single-session backend flow and prior token-backed flow passed. Visual live-board proof still remains. |
| Klaverjas/scorer | VERIFIED SURFACE | `scorer.html`, `score.html`, `klaverjas_live.html`, `klaverjas/score.html`, `gejast-klaverjas-api.js`, `gejast-klaverjas-scorer-bridge.js`, `gejast-klaverjassen.js` | Main `/scorer.html` route passes. `/klaverjas.html` is not a current route. |
| Beerpong | VERIFIED SURFACE | `beerpong.html`, `beerpong_vault.html`, `gejast-beerpong.js`, `gejast-beerpong-odds.js`, `gejast-beerpong-shared-stats.js` | Public route passes. Save/result flow needs user-approved live mutation test. |
| Boerenbridge | VERIFIED SURFACE | `boerenbridge.html`, `boerenbridge_live.html`, `boerenbridge_spectator.html`, `gejast-boerenbridge.js`, `gejast-boerenbridge-odds.js`, `gejast-boerenbridge-shared-stats.js` | Public route passes. Save/result flow needs user-approved live mutation test. |
| Rad | VERIFIED SURFACE | `rad.html`, `rad_stats.html`, `gejast-drinks-workflow.js`, `gejast-player-session-ui.js` | Public route passes. Spin persistence not mutation-tested in this pass. |
| Drinks pages and stats | VERIFIED SURFACE | `drinks.html`, `drinks_add.html`, `drinks_pending.html`, `drinks_history.html`, `drinks_player.html`, `drinks_speed.html`, `drinks_stats.html`, `gejast-drinks-workflow.js`, `gejast-drinks-analytics.js` | Live drinks pending page loads and status layer works. Creating/confirming real drink requests was not done to avoid unwanted mutations. |
| Push notifications | VERIFIED COMPLETE FOR CURRENT BROWSER | `gejast-push-runtime.js`, `gejast-sw.js`, `web_push_dispatcher.js`, `gejast-push-admin-source.js`, `check-live-push-health.mjs` | Live browser shows `Meldingen actief - volledig actief` after v732 badge fix. End-to-end phone delivery still needs real device proof. |
| Despimarkt / Beurs | VERIFIED SURFACE | `despimarkt.html`, `beurs.html`, `despimarkt_market.html`, `despimarkt_wallet.html`, `gejast-despimarkt.js`, `gejast-despimarkt-auto-markets.js`, `gejast-despimarkt-phase-bridge.js` | Public routes pass. Admin/market mutation flows need explicit permission before testing. |
| Admin core | VERIFIED SURFACE | `admin.html`, `admin_claims.html`, `admin-dev.html`, `admin-session-sync.js`, `admin-topnav.js`, `admin-gate-v105.js` | Admin pages and modules exist; admin actions not mutation-tested in this pass. |
| Admin diagnostics/health | VERIFIED SURFACE | `admin_system_health.html`, `admin_release_readiness.html`, `admin_runtime_verification.html`, `admin_deployment_verification.html`, `admin_ops_observability.html`, `gejast-health-beacon.js`, `gejast-ops-observability.js` | Static and JS verification passes. |
| Family/friends scope split | VERIFIED SURFACE | `familie/*`, `familie.html`, `familie_admin.html`, `gejast-scope.js`, `gejast-scope-context.js`, `gejast-family-rollout.js` | Family pages exist and active refs pass. Needs role/scope scenario testing. |
| Stats, ELO, predictions | VERIFIED SURFACE | `gejast-public-stats-bridge.js`, `gejast-shared-stats.js`, `gejast-shared-stats-config.js`, `gejast-pikken-probability.js`, `gejast-beerpong-odds.js`, `gejast-boerenbridge-odds.js` | Modules and RPCs exist. Prediction UI is not uniformly mounted everywhere. |
| Analytics | VERIFIED SURFACE | `site-analytics.js`, `admin_analytics.html`, `gejast-client-error-capture.js` | Route/static checks pass. Data correctness needs admin/live review. |
| Upload/checklist/tooling | VERIFIED SURFACE | `gejast-upload-checklist.js`, `admin_upload_checklist.html`, `gejast-sql-run-tracker.js`, `gejast-rollback-checkpoints.js` | Tooling exists; no destructive/admin actions performed. |
| Visual assets | VERIFIED STATIC | `assets/*`, `wordtergejast.png`, `logo.png`, card/race/badge assets | Static refs pass. Performance optimization remains an open target. |

## Exported Frontend Runtime Modules

These are the main `window.*` runtime APIs found in active code:

- `GEJAST_ACCOUNT_RUNTIME`
- `GEJAST_ADMIN_BUCKETS`
- `GEJAST_ADMIN_DEVICE`
- `GEJAST_ADMIN_SESSION`
- `GEJAST_BEERPONG`
- `GEJAST_BEERPONG_ODDS`
- `GEJAST_BEERPONG_SHARED_STATS`
- `GEJAST_BOERENBRIDGE`
- `GEJAST_BOERENBRIDGE_ODDS`
- `GEJAST_BOERENBRIDGE_SHARED_STATS`
- `GEJAST_CLIENT_ERROR_CAPTURE`
- `GEJAST_CONFIG`
- `GEJAST_DEPLOYMENT_HANDOFF`
- `GEJAST_DEPLOYMENT_VERIFICATION`
- `GEJAST_DESPIMARKT`
- `GEJAST_DESPIMARKT_AUTO_MARKETS`
- `GEJAST_DESPIMARKT_PHASE_BRIDGE`
- `GEJAST_DRINKS_ANALYTICS`
- `GEJAST_DRINKS_PUSH_BRIDGE`
- `GEJAST_DRINKS_WORKFLOW`
- `GEJAST_FAIRNESS`
- `GEJAST_FAST_RUNTIME`
- `GEJAST_GAME_GROUP_A_RUNTIME`
- `GEJAST_GAME_GROUP_B_BRIDGE`
- `GEJAST_GAME_PHASE_BRIDGE`
- `GEJAST_GATE_BOOTSTRAP`
- `GEJAST_GEO`
- `GEJAST_HEALTH_BEACON`
- `GEJAST_HOME_GATE`
- `GEJAST_HOME_PROFILE_RUNTIME`
- `GEJAST_IMPLEMENTATION_MATRIX`
- `GEJAST_KLAVERJAS_API`
- `GEJAST_KLAVERJAS_BRIDGE`
- `GEJAST_KLAVERJASSEN`
- `GEJAST_KLAVERJASSEN_ALIGNMENT`
- `GEJAST_KLAVERJASSEN_SHARED_STATS`
- `GEJAST_LADDER_LAB`
- `GEJAST_LIVE_SMOKE_CLIENT`
- `GEJAST_LIVE_SUMMARY`
- `GEJAST_LOGIN_NAMES_FALLBACK`
- `GEJAST_OPS_OBSERVABILITY`
- `GEJAST_OWNER_TRACE_HELPER`
- `GEJAST_PAARDENRACE`
- `GEJAST_PAARDENRACE_INPUT_GUARD`
- `GEJAST_PERF_GUARDS`
- `GEJAST_PHASE_COMPLETION`
- `GEJAST_PIKKEN_CONTRACT`
- `GEJAST_PIKKEN_SHARED_STATS`
- `GEJAST_PLAYER_SELECTOR`
- `GEJAST_PROFILES_RESTORE`
- `GEJAST_PUBLIC_STATS_BRIDGE`
- `GEJAST_PUSH_ADMIN_SOURCE`
- `GEJAST_PUSH_RUNTIME`
- `GEJAST_ROLLBACK_CHECKPOINTS`
- `GEJAST_RUNTIME_SMOKE_TESTS`
- `GEJAST_SCOPE_UTILS`
- `GEJAST_SCRIPT_VERSION_NORMALIZER`
- `GEJAST_SHARED_STATS`
- `GEJAST_SHARED_STATS_CONFIG`
- `GEJAST_SQL_RUN_TRACKER`
- `GEJAST_UPLOAD_CHECKLIST`
- `GEJAST_VERSION_SOURCE`
- `GEJAST_VERSION_SOURCE_OF_TRUTH`
- `PIKKEN_DICE_ART`

## Remaining Items That Are Not Honestly Complete Yet

- [NEEDS REAL DEVICE] End-to-end push delivery to phone/laptop outside the managed browser.
- [NEEDS VISUAL BROWSER PROOF] Two-player Paardenrace live board rendering after real start.
- [NEEDS VISUAL BROWSER PROOF] Two-player Pikken live dice/state rendering after real start.
- [NEEDS PERMISSION] Admin destructive flows: market settlement/refund/delete, wallet mutation, claims approval/requeue, upload operations.
- [NEEDS PERMISSION] Real drink create/verify/reject flows, because they mutate live site data.
- [NEEDS SCENARIO TEST] Badge awarding correctness across games.
- [NEEDS SCENARIO TEST] Family/friends isolation across every game and admin view.
- [OPEN PERFORMANCE WORK] Oversized images and startup scripts still need a dedicated performance pass.

## Current Verdict

- [COMPLETE] Static integrity, version alignment, JS syntax, live route availability, public push health, and public game RPC surfaces.
- [COMPLETE] Current-browser notification readiness badge after v732.
- [MOSTLY COMPLETE] Account/session, profiles, game entry pages, drinks status pages, admin diagnostics, Despimarkt read surfaces.
- [NOT COMPLETE WITHOUT MANUAL/LIVE MUTATION PROOF] Real device push delivery, game board visual proof, admin mutations, drink mutations, badge scenario correctness, and scope-isolation scenario tests.
