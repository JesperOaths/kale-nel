# Kale Nel Beta Run Gap Plan - 2026-06-03

Source: `KALE_NEL_FUNCTION_FEATURE_AUDIT_2026-06-03.md`

Current live version: `v732`

Goal: turn the site from "static and surface verified" into a working beta run where the important live flows are proven with real users/devices, and every unproven feature has either a passing test or a clear fix.

## Beta Status Legend

- `DONE`: verified as working enough for beta.
- `READY TO TEST`: code exists and public/surface checks pass, but the real flow still needs proof.
- `NEEDS FIX IF TEST FAILS`: do not rewrite first; test the real flow, then patch only the failing owner.
- `NEEDS PERMISSION`: mutates live data or admin state, so only run after explicit approval.

## Not Fully Verified / Complete Yet

| Priority | Area | Current status | What is missing for beta-complete |
|---:|---|---|---|
| 1 | Real device push delivery | READY TO TEST | Prove a phone/laptop actually receives a pushed drink verification notification from the dispatcher, not just that browser subscription and queue RPCs exist. |
| 2 | Pikken two-player visual live run | READY TO TEST | Prove two logged-in players can create/join/start, see live dice/state changes, finish/cleanup, and spectator view stays correct. |
| 3 | Paardenrace two-player visual live run | READY TO TEST | Prove two logged-in players can create/join, choose suits/wagers, verify, ready/start, see the live board/countdown/cards, and cleanup. |
| 4 | Drinks create/verify/reject flow | NEEDS PERMISSION | Prove a real drink request can be created, appears in pending, can be verified/rejected by eligible players, updates history/stats, and queues notification where appropriate. |
| 5 | Admin mutation flows | NEEDS PERMISSION | Prove claims approval/requeue, Despimarkt market admin, wallet mutations, upload checklist actions, and release tools work without corrupting live state. |
| 6 | Badge award correctness | READY TO TEST | Prove badge criteria trigger correctly after real/scaffolded game and drink outcomes. Static assets exist, but rules need scenario proof. |
| 7 | Family/friends scope isolation | READY TO TEST | Prove family users/data never leak into friends pages and friends users/data never leak into family pages across login, games, stats, admin, and drinks exclusions. |
| 8 | Beerpong result/save flow | READY TO TEST | Prove logged-in save flow, stats update, vault/history, odds/shared stats update. |
| 9 | Boerenbridge result/save flow | READY TO TEST | Prove logged-in save/live/spectator flow, stats update, vault/history, shared stats update. |
| 10 | Klaverjas/scorer full save flow | READY TO TEST | Prove player loading, score entry, save, stats/vault/history update, live/spectator route if intended. |
| 11 | Rad spin persistence | READY TO TEST | Prove a spin can run, result persists, drinks/stats side effects are correct if intended. |
| 12 | Profile editing | READY TO TEST | Prove display name and avatar update, persist, render safely on profiles/leaderboards/game rows. |
| 13 | Stats/ELO/prediction mounting | READY TO TEST | Prove stats and win probability widgets appear only in intended slots and use current SQL data. |
| 14 | Analytics/admin observability | READY TO TEST | Prove admin analytics and health pages load real data with admin session and do not leak private data publicly. |
| 15 | Performance beta pass | NEEDS FIX IF TEST FAILS | Measure startup weight and reduce oversized images/startup scripts without changing site identity. |

## Plan To Add / Fix / Make / Install

### Phase 1 - Make Beta Tests Repeatable

1. Add a beta checklist doc or JSON status file that tracks each live proof with date, account pair, route, result, and cleanup.
   - Implemented: `beta-readiness.json`
   - Implemented: `npm.cmd run beta:readiness`
   - Optional strict mode for CI/manual gates: `set GEJAST_BETA_FAIL_ON_OPEN=1 && npm.cmd run beta:readiness`
2. Extend `check-live-game-flows.mjs` only if needed:
   - keep token input via environment variables only
   - never print tokens
   - add optional `GEJAST_VISUAL_PROOF=1` mode later if browser automation is stable
3. Add one non-destructive live read script for each major surface:
   - account/profile read
   - drinks read
   - badge/profile read
   - scope read
   - admin diagnostics read
   - Implemented first pass: `npm.cmd run smoke:beta:read`
4. Keep `npm.cmd run verify`, `smoke:live`, `smoke:push`, and `smoke:games` as the baseline gate before and after any patch.

### Phase 2 - Prove User-Facing Core

1. Real device push:
   - install/open the site on one phone and one desktop/laptop browser
   - log in
   - enable notifications from a real tap
   - confirm `Meldingen actief - volledig actief`
   - create/queue a safe test push
   - verify notification arrives and click/action routes correctly
   - if it fails, inspect `web_push_dispatcher.js`, GitHub Actions secrets/schedule, service worker events, and `claim_web_push_jobs_v3`
2. Pikken:
   - run token-backed harness
   - open two browser tabs/sessions
   - create lobby, join, ready/start
   - verify dice/state/bid/reject/round resolution updates
   - verify spectator route
   - cleanup/destroy
   - if it fails, patch only `gejast-pikken-contract.js`, `gejast-pikken-live.js`, or the specific SQL RPC owner
3. Paardenrace:
   - run token-backed harness
   - open two browser tabs/sessions
   - create room, join, choose suits/wagers, verify, ready/start
   - verify countdown, horse board, card draw/state, spectator route
   - cleanup/disband
   - if it fails, patch only `gejast-paardenrace.js`, `gejast-paardenrace-input-guard.js`, or the specific SQL RPC owner
4. Drinks:
   - after permission, create one clearly marked beta test drink request
   - verify pending list, nearby eligibility, approve/reject action, history/stats update, and notification queue
   - cleanup or mark test entry so it does not pollute real stats if possible

### Phase 3 - Prove Admin And Scope

1. Admin core:
   - log in as admin through the normal route
   - verify session renewal, logout, return target, and device remember behavior
   - test read-only dashboards first
2. Admin mutations:
   - only run with explicit approval
   - use one reversible/small test item per subsystem
   - verify audit log before and after
3. Family/friends split:
   - test one family login and one friends login
   - verify route visibility and query scope
   - verify games/stats/profiles do not cross scopes
   - verify drinks/beerpong exclusions on family routes if that is still intended

### Phase 4 - Prove Secondary Game/Stats Systems

1. Klaverjas/scorer:
   - enter a small match
   - save
   - verify vault/history/stats and live route
2. Beerpong:
   - save one result
   - verify vault/stats/shared odds
3. Boerenbridge:
   - save one result/live flow
   - verify vault/stats/shared odds
4. Rad:
   - run one beta spin
   - verify persistence and stats/drinks side effects
5. Badges:
   - trigger known simple badge criteria
   - verify database result, profile display, leaderboard display, and asset path
6. Stats/ELO:
   - verify stats panels for each game
   - verify prediction chips render only in intended existing slots

### Phase 5 - Performance And Polish

1. Measure live load on homepage, profiles, Pikken, Paardenrace, and drinks pages.
   - Implemented first pass: `npm.cmd run smoke:beta:perf`
2. Convert or add WebP/AVIF alternatives for heavy images where safe.
3. Lazy-load non-critical visual assets and secondary modules.
4. Defer analytics, presence, push diagnostics, and non-critical widgets until idle/visible.
5. Re-run all smoke checks and one manual browser proof after each performance patch.

## Install / Setup Needed For Beta Proof

- A normal browser session for one account.
- A second browser profile/session for the second account.
- At least one real phone or desktop browser with notification permission available.
- Existing GitHub Actions web push secrets must remain configured:
  - Supabase URL
  - Supabase service role key
  - VAPID public/private keys
  - optional VAPID subject
- Optional but useful:
  - GitHub CLI for checking workflow runs locally
  - browser automation access for screenshots
  - a small beta test account pair reserved for non-production-looking entries

## Fix Rules

- Do not delete old features while proving beta readiness.
- Do not rewrite broad modules if one RPC/page owner is failing.
- Do not run admin destructive flows without explicit approval.
- Do not commit credentials, tokens, push secrets, service keys, or login data.
- Prefer one small patch, one version bump, one verification run, and one live proof per issue.

## Suggested Beta Completion Order

1. Real-device push delivery.
2. Two-player Pikken visual run.
3. Two-player Paardenrace visual run.
4. Drinks create/verify/reject with notification queue.
5. Family/friends isolation scenario test.
6. Klaverjas, Beerpong, Boerenbridge, and Rad save-flow tests.
7. Badge award scenario tests.
8. Admin read-only dashboards, then approved admin mutations.
9. Performance pass.

## Definition Of Working Beta

The site is a working beta when:

- all public routes load
- login works for real users
- core games can be played or scored by real logged-in users
- drinks requests can be created and verified
- notifications work on at least one real device path
- family/friends scope is proven isolated
- admin dashboards work and dangerous actions are audited
- badges/stats update after real actions
- the repo verification and smoke commands pass after every patch
