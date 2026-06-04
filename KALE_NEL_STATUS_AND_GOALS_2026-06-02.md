# Kale Nel / kalenel.nl Status And Goals - 2026-06-02

## Verified Baseline

- Active source-of-truth checkout: `C:\Users\jespe\Documents\wordt-er-gejast\tmp\github-kale-nel-main`
- Git remote: `https://github.com/JesperOaths/kale-nel.git`
- GitHub `main`: `829588a22ef5037b79844a656ec5f9c7c607369b`
- Local worktree: clean before this status file was added
- Repo version after this pass: `v729`
- Live `https://kalenel.nl/VERSION` before deployment of this pass: `v728`
- Live homepage: HTTP 200

## Verification Run

Passed:

- `node check-version-drift.mjs`
- `node check-rpc-coverage.mjs`
- `node check-local-refs.mjs`
- Active JS syntax sweep across 147 JavaScript files
- Live route smoke checks for:
  - `/`
  - `/index.html`
  - `/pikken.html`
  - `/paardenrace.html`
  - `/scorer.html`
  - `/beerpong.html`
  - `/boerenbridge.html`
  - `/despimarkt.html`
  - `/beurs.html`
  - `/rad.html`
  - `/profiles.html`
  - `/login.html`

Added in the continuation pass:

- `npm run verify` now runs version drift, RPC coverage, local reference, and active JavaScript syntax checks.
- `npm run smoke:live` now checks `https://kalenel.nl/VERSION` plus the main public routes.
- `npm.cmd run verify` passed on Windows PowerShell. Use `npm.cmd` instead of `npm` on machines where `npm.ps1` is blocked by execution policy.
- `GEJAST_EXPECTED_VERSION=v729 npm.cmd run smoke:live` passed: live `VERSION` was `v729` and every main public route returned HTTP 200.
- Public Supabase probe still returned `PGRST203` for `get_homepage_runtime_bundle_v687` with only `site_scope_input`, so the `GEJAST_v729_homepage_runtime_bundle_overload_fix.sql` drop-overload fix still appears unapplied in Supabase.
- The defensive three-argument homepage runtime call returned HTTP 200, so the live frontend path remains protected.
- Public Paardenrace create probe reached the expected player-login guard (`Log eerst in als speler.`), confirming the RPC is reachable; a real logged-in two-player test is still needed to prove the v728 duplicate-room-code fix.
- Homepage image startup hints were tightened: large decorative images and repeated plus icons now include dimensions, async decoding, and low-priority/lazy loading hints where safe.

Continuation on 2026-06-03:

- GitHub `main` and local checkout are aligned at `5d8a25c` (`Record live push delivery repair`).
- Latest committed repair files after the v729 status pass:
  - `GEJAST_v730_paardenrace_drinks_push_live_repair.sql`
  - `GEJAST_v731_live_push_delivery_repair.sql`
- Public GitHub Actions metadata confirms `.github/workflows/web-push-dispatcher.yml` is active. Latest checked scheduled run was `#902`, completed successfully against `5d8a25c`.
- Added `check-live-push-health.mjs` and `npm run smoke:push`.
- `npm run smoke:push` passed:
  - push dispatcher workflow latest run completed successfully
  - `get_drinks_pending_verification_summary_v661` returned HTTP 200
  - `get_drinks_push_eligibility_summary_v661` returned HTTP 200
  - `queue_nearby_verification_pushes_v3` returned HTTP 200 with safe zero-queue state because no active push subscriptions were visible for the public probe
  - `queue_test_web_push` rejected an invalid session with `MISSING_SESSION`, as expected
- `npm run verify` passed after adding the push-health checker.
- `GEJAST_EXPECTED_VERSION=v729 npm run smoke:live` passed after adding the push-health checker.
- Added `check-live-game-flows.mjs` and `npm run smoke:games`.
- `npm run smoke:games` passed in public-probe mode:
  - Pikken open-lobby and live-match RPC surfaces responded
  - Paardenrace open-room and stats RPC surfaces responded
  - true two-player creation/start cleanup is ready behind `GEJAST_PLAYER1_TOKEN` and `GEJAST_PLAYER2_TOKEN`
- To run the destructive-but-cleaning two-player proof, set `GEJAST_PLAYER1_TOKEN` and `GEJAST_PLAYER2_TOKEN`. The script creates, starts, and cleans a Pikken game plus a Paardenrace room, and never prints the tokens.

Supabase/live backend continuation:

- Applied the combined `GEJAST_v729_homepage_runtime_bundle_overload_fix.sql` + `GEJAST_v728_paardenrace_room_create_surgical_fix.sql` script in the Supabase SQL editor for project `jas-site`.
- Supabase showed the expected destructive-operation confirmation because the v729 script drops the old one-argument homepage overload; the run was confirmed intentionally.
- Public RPC verification after SQL apply:
  - `get_homepage_runtime_bundle_v687(site_scope_input)` returned HTTP 200; the earlier `PGRST203` ambiguity is resolved.
  - `get_homepage_runtime_bundle_v687(site_scope_input, session_token, session_token_input)` still returned HTTP 200.
  - `_paardenrace_next_despinoza_room_code_v728()` returned HTTP 200, proving the helper is live.
- Pikken logged-in single-session regression passed: create lobby, ready state update, and backend cleanup/destroy returned OK.
- Paardenrace logged-in single-session backend flow passed: create room, save suit/wager, host verify wager, set ready, and disband cleanup returned OK.
- Remaining live gameplay gap: a true two-player Paardenrace start/live-board test still needs a second logged-in player session. A one-player test cannot honestly prove join/start/multi-suit behavior.

Continuation on 2026-06-04:

- Current local and live site version: `v739`.
- Recent committed beta work in Git history includes:
  - beta audit/readiness tracking
  - beta performance route probe
  - lighter active image assets
  - Paardenrace countdown visual sync fix
  - live Pikken and Paardenrace visual proof tracking
  - extended beta read-only gate
  - guarded live-write beta gate
- `npm.cmd run verify` passed:
  - no version drift
  - RPC coverage OK: frontend RPCs `104`, SQL functions `561`
  - active local HTML references exist
  - active JavaScript syntax OK across `151` files
- `npm.cmd run smoke:live` passed against `https://kalenel.nl`:
  - live `VERSION` is `v739`
  - main public routes returned HTTP 200
- `npm.cmd run smoke:push` passed:
  - latest checked dispatcher workflow run `#911` completed successfully
  - drinks pending/eligibility RPCs returned HTTP 200
  - nearby push queue probe returned safe zero-active-subscriptions state
  - invalid test-push session was rejected as expected
- `npm.cmd run smoke:games` passed in public-probe mode:
  - Pikken public live/lobby RPC surfaces respond
  - Paardenrace public room/stats RPC surfaces respond
  - token-backed two-player flow was not rerun in this pass because `GEJAST_PLAYER1_TOKEN` and `GEJAST_PLAYER2_TOKEN` were not present in the environment
- `npm.cmd run smoke:beta:read` passed across 42 live beta routes.
- `npm.cmd run smoke:beta:extended` passed across stats, ladder, scope, and admin observability read-only surfaces.
- `npm.cmd run smoke:beta:perf` passed for homepage, profiles, Pikken, Paardenrace, and drinks routes. Heaviest same-origin active assets now observed:
  - `415 KB /kale9goed-scene.png`
  - `315 KB /playingcard-accent1-trimmed-scene.png`
  - `205 KB /site-bg-desktop.webp`
  - `43 KB /logo-small.png`
  - `39 KB /site-bg-mobile.webp`
- `npm.cmd run beta:write:readiness` passed as a safety gate by refusing to arm live-write tests without explicit approval and required player/admin/device inputs. No live data was changed.
- `npm.cmd run beta:write:plan` now prints a sanitized, non-mutating execution/evidence checklist for the remaining live-write beta targets. Use `GEJAST_BETA_WRITE_TARGET=<item id>` to focus one target.
- `npm.cmd run beta:readiness` reports 6 of 12 beta gaps verified complete. Remaining items are intentionally blocked by permission/device requirements:
  - real device push delivery
  - drinks create/verify/reject write flow
  - admin mutations
  - badge awards
  - secondary game save/spin flows
  - profile editing

Current next action:

The remaining beta list is no longer a coding-only list. It needs either a real permissioned device or explicit approval to write beta test records. Without those, the useful autonomous work is to keep the non-mutating gates green and patch only regressions they reveal.

Observed:

- `/klaverjas.html` returns 404. Current Klaverjas route appears to be `/scorer.html`, so this is only a blocker if links or users expect `/klaverjas.html`.
- `GEJAST_v728_paardenrace_room_create_surgical_fix.sql` is present in the repo and is the likely backend fix for the earlier live Paardenrace duplicate room-code failure.
- `GEJAST_v729_homepage_runtime_bundle_overload_fix.sql` was added to remove a live Supabase/PostgREST overload ambiguity on `get_homepage_runtime_bundle_v687`.
- `gejast-home-profile-runtime.js` now sends both nullable session parameters when calling the homepage runtime bundle, avoiding the same overload ambiguity from the frontend side.
- Heavy root assets remain a performance target, especially `wordtergejast.png`, `kale9goed.png`, and playing-card/Paardenrace PNGs.

## Main Goals

1. Keep GitHub as the source of truth.
   - Do not use old extracted `kale-nel-main` folders as implementation sources.
   - Treat old local folders and patch bundles as reference only.

2. Finish live gameplay verification.
   - Pikken: create, join, ready, start, dice/state, cleanup.
   - Paardenrace: create, join, choose suit/wager, verify wager, ready, start, live board.
   - Klaverjas/scorer: load players, save score, update stats if intended.
   - Beerpong and Boerenbridge: session/player selectors and save flows.
   - Despimarkt/Beurs: read-only market/state probes, then admin flows only with explicit permission.
   - Rad: spin flow and result persistence if intended.

3. Resolve the Paardenrace backend uncertainty.
   - Confirm whether `GEJAST_v728_paardenrace_room_create_surgical_fix.sql` has been applied in Supabase.
   - If not applied, apply it through the legitimate Supabase/admin path with permission.
   - Re-run a two-player live Paardenrace create/join/start test.

4. Resolve the homepage runtime bundle overload.
   - Apply `GEJAST_v729_homepage_runtime_bundle_overload_fix.sql` in Supabase; the overload still existed in the public probe during the continuation pass.
   - Keep the frontend `session_token:null` compatibility payload in place as a defensive fix.

5. Add permanent guardrails before big changes.
   - Keep version drift, RPC coverage, local reference, and JS syntax checks passing.
   - Add a single verification command if the repo does not already have one.
   - Consider adding a small route smoke script for the live site and local static server.

6. Make the site feel faster without changing its identity.
   - Keep the weird/fun GEJAST feel.
   - Reduce startup work, duplicate RPC calls, and polling.
   - Convert oversized PNGs to WebP/AVIF where safe.
   - Lazy-load non-critical visuals and widgets.
   - Defer analytics, push/presence, and low-priority homepage modules until idle or visible.

## Priority Order

1. Run real device push verification with an actual subscribed browser/device, because public probes can prove the RPC/workflow surface but cannot prove end-to-end phone delivery.
2. If approved, run one clearly marked drinks create/verify/reject beta test and inspect pending/history/stats/push-queue behavior.
3. If approved, run controlled live-write save/spin tests for Klaverjas/scorer, Beerpong, Boerenbridge, and Rad.
4. If approved, run reversible profile-edit and badge-award scenarios using beta/test records only.
5. Keep `npm.cmd run verify`, `smoke:live`, `smoke:push`, `smoke:games`, `smoke:beta:read`, `smoke:beta:extended`, `smoke:beta:perf`, and `beta:write:readiness` green.
6. Patch only blockers or regressions found by those gates or by approved live beta tests.

## Safety Notes

- Never store, print, commit, or summarize account PINs, passwords, API keys, service keys, or user credentials.
- Use credentials only in legitimate login fields when live testing actually requires them.
- Avoid destructive backend/admin actions unless explicitly approved.
- Preserve existing features and content unless the user explicitly approves removal.
