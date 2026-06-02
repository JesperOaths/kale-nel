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

1. Confirm live backend state for Paardenrace.
2. Apply the v729 homepage-runtime overload SQL if approved/needed.
3. Deploy the v729 frontend cache-bust bump.
4. Run real account/device live tests for the main games.
5. Fix any blocker found during live tests.
6. Start performance pass on homepage, profiles, Paardenrace, and global analytics/presence.
7. Clean documentation so this dated file and the current README point to the correct source of truth.

## Safety Notes

- Never store, print, commit, or summarize account PINs, passwords, API keys, service keys, or user credentials.
- Use credentials only in legitimate login fields when live testing actually requires them.
- Avoid destructive backend/admin actions unless explicitly approved.
- Preserve existing features and content unless the user explicitly approves removal.
