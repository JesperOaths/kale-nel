# GEJAST v713 - Drinks, Push Notifications, and ELO Prediction Status Plan

Date: 2026-04-30
Scope: repair-first status report for the current local repo copy under `kale-nel-main/kale-nel-main`.

## Executive Status

VERIFIED: The repo already contains a real Web Push pipeline. It is not just frontend text. The browser runtime, service worker, Supabase RPC names, and Node dispatcher files are present.

VERIFIED: The current pipeline is fragmented by age. The main site version is v713 after this patch, but push/drinks bridge files still carry older internal labels such as v661/v665.

SUSPECTED: Push is not reliably reaching phones/laptops because the server-side dispatch part is either not scheduled, missing secrets, not linked to every drink-verification write path, or all three.

SUSPECTED: iPhone push will not behave like Android/desktop browser push unless the site is installed as a Home Screen web app and permission is requested from a direct tap/click.

## Verified Push Pipeline Files

VERIFIED: `gejast-push-runtime.js`

- Registers the service worker.
- Requests notification permission.
- Subscribes the browser through `PushManager`.
- Sends subscription data to Supabase through `register_web_push_subscription_v3`.
- Touches active push presence through `touch_active_web_push_presence_v3`.
- Queues nearby drinks verification pushes through `queue_nearby_verification_pushes_v3`.
- Provides self diagnostics through `get_web_push_self_diagnostics_v3`.

VERIFIED: `gejast-sw.js`

- Receives push events.
- Displays notifications.
- Handles notification clicks.
- Supports verify/reject action token flow through `consume_web_push_action_v3`.
- Handles `pushsubscriptionchange`.

VERIFIED: `web_push_dispatcher.js`

- Requires server-side environment/secrets:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `WEB_PUSH_VAPID_PUBLIC_KEY`
  - `WEB_PUSH_VAPID_PRIVATE_KEY`
  - optional `WEB_PUSH_VAPID_SUBJECT`
- Claims jobs through `claim_web_push_jobs_v3`.
- Sends Web Push with the `web-push` package.
- Mints action tokens through `mint_web_push_action_tokens_v3`.
- Marks jobs sent or failed.

VERIFIED: `gejast-drinks-push-bridge.js`

- Reads admin/status RPCs:
  - `admin_get_drinks_push_audit_v661`
  - `get_drinks_push_phase_summary_v661`
  - `get_drinks_pending_verification_summary_v661`
  - `get_drinks_push_eligibility_summary_v661`
- Still has stale v661 naming and should be admin-only or diagnostics-only.

## Current Intended Flow

INFERRED from code:

1. Player logs in and has a real session token.
2. Player taps a notification enable button.
3. `gejast-push-runtime.js` registers `gejast-sw.js`.
4. Browser asks notification permission.
5. Browser creates a VAPID push subscription.
6. Frontend stores that subscription in Supabase through `register_web_push_subscription_v3`.
7. Frontend periodically touches device presence through `touch_active_web_push_presence_v3`.
8. A drinks verification event queues push jobs through SQL/RPC.
9. `web_push_dispatcher.js` claims pending jobs with a service-role key.
10. Dispatcher sends push notifications to device endpoints.
11. Service worker displays the notification.
12. Notification actions verify/reject through action tokens.

## Problems To Fix Next

VERIFIED: `gejast-drinks-push-bridge.js` is too old and contains mojibake in user-facing strings. It should not be public UI.

SUSPECTED: Some drinks pages still call page bundle RPCs directly and display schema-cache errors when old RPC overloads are missing. The verify pipeline needs one canonical entrypoint and one canonical admin/audit view.

SUSPECTED: Public pages may still load diagnostic/observability code that slows the site. Public pages should only load the subscription runtime when needed. Admin pages can load audit panels.

UNKNOWN: Whether GitHub Actions or another server runner is currently executing `web_push_dispatcher.js` on a schedule. Without that runner, queued push jobs will sit in the database and phones will never receive notifications.

UNKNOWN: Whether all required VAPID and Supabase service role secrets exist in GitHub/Supabase runtime settings.

## iPhone, Android, and Laptop Reality

VERIFIED from Apple/WebKit: iOS/iPadOS Web Push works for Home Screen web apps, using Push API, Notifications API, and Service Workers, and permission must follow direct user interaction. Source: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/

VERIFIED from Apple Developer docs: web push requires webpage subscription code, a server that sends pushes, and a service worker that receives/displays notifications. Source: https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers

VERIFIED from MDN: Push API lets web apps receive server-pushed messages even when the app is not foregrounded, but subscriptions must be handled carefully. Source: https://developer.mozilla.org/en-US/docs/Web/API/Push_API

Practical consequence:

- Android Chrome/Edge: can work as a normal installed web app or browser site after permission.
- Desktop Chrome/Edge/Firefox/Safari: can work after permission if the service worker and HTTPS context are valid.
- iPhone/iPad: make the site installable and guide users to Add to Home Screen first; then ask permission from a button inside the installed app.

## Better Push Implementation Plan

1. Create one small notification CTA after login and on drinks pages: `Zet meldingen aan`.
2. Never auto-prompt on page load. Prompt only after a tap/click.
3. Add device readiness checks:
   - service worker supported
   - PushManager supported
   - notification permission state
   - installed Home Screen mode on iOS
   - subscription stored in Supabase
4. Keep readiness UI compact and only in profile/settings/admin, not as random boxes across public pages.
5. Route every drink verification request through one SQL/RPC queue function.
6. Make every "bak drinken" event create a verification request when the rules require verification.
7. Dispatch push jobs server-side only:
   - preferred: Supabase Edge Function + cron
   - acceptable: GitHub Action running `web_push_dispatcher.js` every minute
8. Store delivery status and last error per device/job.
9. Admin screens should show:
   - pending jobs
   - sent jobs
   - failed jobs
   - active devices
   - players missing notification permission
10. Public pages should not show raw RPC/schema-cache errors. Show a short user message and log details admin-side.

## Drinks Verification Plan

1. Build a canonical drinks verification contract:
   - `create_drink_verify_request`
   - `queue_drink_verify_pushes`
   - `resolve_drink_verify_request`
   - `get_drinks_page_public`
   - `admin_get_drinks_verify_status`
2. Replace duplicate page-specific RPC fallbacks with this contract.
3. For game integrations, call the same contract when a bak/penalty is created:
   - Paardenrace wagers and penalties
   - Pikken round losses if they imply drinking
   - Klaverjassen/Boerenbridge penalties
   - Beerpong results
4. Keep all final drink totals computed in SQL, not localStorage.
5. Keep the 06:00 day boundary in SQL so pages agree.

## ELO Prediction Win Percent Status

VERIFIED: Prediction code already exists but is not consistently mounted.

Existing files:

- `gejast-pikken-probability.js`
- `gejast-pikken-shared-stats.js`
- `gejast-beerpong-odds.js`
- `gejast-despimarkt-auto-markets.js`
- `gejast-public-stats-bridge.js`

Current issue:

- Pikken probability only renders where `[data-pikken-probability]` exists.
- Beerpong odds are separate.
- Despimarkt has odds payload support but the Beurs page still needs the active market UI tied back into that data.
- There is no single lightweight inline prediction mount used across live/spectator/match rows.

Repair plan without adding random new boxes:

1. Create one tiny inline helper: `gejast-elo-prediction-inline.js`.
2. It should render only into existing slots such as:
   - match header subline
   - spectator title row
   - existing market row metadata
   - existing leaderboard/profile stat row
3. If no prediction RPC exists or it times out, render nothing.
4. Use SQL/RPC for actual calculations:
   - input: game key, player/team ids, optional current score/state
   - output: player/team ELO, win probability, confidence, source version
5. Do not add panels. Do not add dashboard boxes. Treat prediction as a chip or compact subline.

## Immediate Next Implementation Checklist

1. Run v713 SQL to restore `start_paardenrace_room_safe(...)` and related start aliases.
2. Confirm Paardenrace start button calls no missing RPC.
3. Confirm Pikken lobby can choose starting dice count.
4. Verify all push RPCs exist in Supabase:
   - `register_web_push_subscription_v3`
   - `touch_active_web_push_presence_v3`
   - `queue_nearby_verification_pushes_v3`
   - `claim_web_push_jobs_v3`
   - `mint_web_push_action_tokens_v3`
   - `consume_web_push_action_v3`
5. Verify dispatcher is scheduled with secrets.
6. Remove or admin-gate public diagnostic panels.
7. Mount prediction win% only inside existing row/header slots.
