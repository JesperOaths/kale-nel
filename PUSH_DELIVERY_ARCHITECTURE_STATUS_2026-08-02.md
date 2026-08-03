# Push delivery architecture status - 2026-08-02

Branch: `agent/v763-push-delivery-proof`  
Baseline: `main` after Ice repair commit `4943ded`; first branch commit `d496dfa`.  
Public frontend remains `v761`. Ice remains exactly `2.8`. Admin Worker was not changed or redeployed; required Worker version remains `79e680cd-4baf-433f-8310-da2d1f1c2b9c`.

No secret values, subscription endpoints, endpoint auth material, player private data, or tokens are included here.

## Phase 1 summary

`smoke:beta:read` now treats only the explicitly listed protected admin routes as expected 401 cases, and checks them on the canonical `https://admin.kalenel.nl` host with redirects disabled.

Protected routes must return exactly HTTP 401. Unexpected HTTP 200, redirects, 403, 404, 5xx, network errors, or obvious failure text still fail.

Regression coverage added: `check-beta-readonly-surfaces-regression.mjs`, included in `npm run verify`.

Verification run before commit:

- `node check-beta-readonly-surfaces-regression.mjs`: passed.
- `npm run smoke:beta:read`: passed; 43 routes checked; admin routes returned expected 401.
- `npm run verify`: passed.
- `npm run smoke:live`: passed; live `/VERSION` observed as `v761`.
- `npm run smoke:push`: passed.

Phase 1 commit: `d496dfa test: treat protected admin 401 as beta smoke pass`.

## Current push architecture map

| Area | Current implementation | Status | Notes |
| --- | --- | --- | --- |
| Browser permission flow | `gejast-push-runtime.js` checks secure context, Notification API, service workers, PushManager, platform/install mode, and permission. `requestPermissionAndSync()` requests notification permission from a user gesture and then subscribes/syncs. | Implemented but current live DB has no enabled/granted subscription. | Must be performed on the intended device/browser; cannot be done headlessly without user approval/browser permission. |
| Browser subscription | `ensureSubscription()` subscribes using `WEB_PUSH_PUBLIC_KEY`; `syncSubscription()` sends endpoint/p256dh/auth to `register_web_push_subscription_v3`. | Implemented, unverified for intended current device. | Subscription endpoint/auth values are sensitive and must not be logged or committed. |
| Service worker registration | `gejast-push-runtime.js` registers `./gejast-sw.js?<version>` with scope `./`. | Implemented. | `gejast-sw.js` handles install/activate/push/click/subscriptionchange. |
| Service worker notification payload | `gejast-sw.js` normalizes `title`, `body`, `url`, `tag`, job/trace/request fields, optional action tokens, `requireInteraction`, and actions. | Implemented. | Defaults to `./drinks_pending.html` or `./drinks_speed.html` for speed requests. |
| Click destination handling | `notificationclick` closes the notification, consumes verify/reject action tokens if used, then focuses/navigates existing client or opens a new window with status/query params. | Implemented but real click proof is still missing. | Needs real device notification click verification. |
| Public runtime diagnostics | `getSelfDiagnostics()` syncs subscription/presence and calls `get_web_push_self_diagnostics_v3`; `push_beta_test.html` displays readiness and can queue exactly one self-test through the existing frontend RPC. | Implemented but not currently green for a real device. | Live DB shows no current enabled/granted subscription. |
| Supabase tables | `web_push_subscriptions`, `web_push_active_presence`, `web_push_jobs`, `web_push_job_attempts`, `web_push_action_tokens_v714`. | Implemented. | Existing migrations include indexes, scope fields, job attempts, claim/mark lifecycle, and action tokens. |
| Supabase subscription RPCs | `register_web_push_subscription_v3`, `touch_active_web_push_presence_v3`, `get_web_push_self_diagnostics_v3`. | Implemented. | Frontend uses publishable key and player session token. |
| Queue RPCs | `queue_test_web_push`, `queue_nearby_verification_pushes_v3`, `admin_queue_active_web_push_v3`/fallback contracts. | Implemented but real delivery unverified. | Existing `queue_test_web_push` queues for all enabled subscriptions belonging to the current player/scope; Phase 3 should add an explicit target-subscription test-send path before any test. |
| Dispatcher workflow | `.github/workflows/web-push-dispatcher.yml` runs every 3 minutes and manually via `workflow_dispatch`; installs npm deps and runs `node web_push_dispatcher.js`. | Working at workflow level. | Latest public workflow run observed completed/success. It had no jobs during smoke probe. |
| Dispatcher code | `web_push_dispatcher.js` requires Supabase URL/service-role key and VAPID keys, requeues stale claims, claims jobs, mints action tokens when needed, calls `webpush.sendNotification`, then marks sent/failed. | Implemented but needs hardening before controlled proof. | Logs currently include job id/kind and failure code/text; must avoid endpoint/key/personal-data leaks. |
| VAPID public key | Public key is in `gejast-config.js` and `gejast-sw.js` as intended public browser configuration. | Working/expected public config. | Public VAPID key is not secret. |
| VAPID private key | Used only by dispatcher via `WEB_PUSH_VAPID_PRIVATE_KEY` GitHub Actions secret. | Configuration-sensitive. | Do not print, chat, or commit the value. |
| Required GitHub Actions secrets | Workflow references `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_VAPID_SUBJECT`. | Names identified; existence not directly listable here because `gh` is unavailable. | Latest dispatcher workflow success suggests required runtime env exists sufficiently for no-job runs, but real send still must be proven. |
| Expired/invalid subscription cleanup | Dispatcher classifies 404/410/gone/notregistered as `endpoint_gone`; DB mark-failed v2 can disable subscriptions if passed a flag. Current v3 wrapper in use does not expose a disable flag. | Implemented but incomplete/broken for automatic disable in current v3 path. | Phase 3 should repair v3 failure marking to disable/remove expired subscriptions safely. |
| Duplicate prevention | DB has `web_push_jobs_dedupe_uidx` on `dedupe_key`; nearby queue uses `on conflict (dedupe_key) do nothing`; admin/self-test keys include scope/subscription/time bucket. | Implemented but test-send path needs explicit no-duplicate proof. | Current self-test can target all player subscriptions; not safe enough for controlled single-device proof. |
| Friends/family separation | Runtime infers/normalizes scope; tables and queue/diagnostics functions carry `site_scope`; nearby queue matches scope. | Implemented, needs proof during real test. | Live sanitized inspection showed only `friends` rows. |
| Admin authorization for test sends | `gejast-push-admin-source.js` requires admin session token and calls admin RPC/contract fallbacks; admin perimeter is Worker-protected. | Implemented and security-sensitive. | No admin push should be broadcast during test. Add explicit target subscription and dry-run before real send. |

## Sanitized live DB inspection

Read-only Supabase SQL inspection returned:

- Ice invariant: `id=4`, `key=ice`, `unit_value=2.8`, `is_active=true`.
- `web_push_subscriptions` by scope:
  - `friends`: total `2`, enabled `2`, enabled+granted `0`, latest seen/success `2026-06-15T21:40:08.140315+00:00`.
- `web_push_active_presence` by scope:
  - `friends`: total `19`, active in last 15 minutes `0`, latest seen `2026-07-27T01:37:23.514245+00:00`.
- `web_push_jobs` in last 7 days: none.
- `web_push_job_attempts` in last 7 days: none.

Conclusion: there is no currently active, permission-granted target subscription to prove real delivery. Real send must stop until the intended test device creates/syncs one.

## Phase 3 blocker and safe next step

Blocked before real delivery because no active granted subscription exists for the intended test device.

Exact UI steps for the user/test device, without sharing secrets:

1. Open `https://kalenel.nl/push_beta_test.html` on the intended device/browser.
2. Log in as the intended test player if prompted.
3. Tap **Check status**.
4. Tap **Vraag permissie + sync** and approve the browser/OS notification permission prompt.
5. Tap **Check status** again.
6. Stop there. Do **not** tap **Queue precies 1 test push** yet.
7. Tell me only whether the page shows subscription/backend/presence ready. Do not paste raw diagnostics if they include endpoint/auth material.

After that, Phase 3 should add/verify:

- dry-run mode for dispatcher/test send;
- explicit target subscription id for test sends;
- no broadcast during testing;
- sanitized failure logging;
- v3 expired-subscription disable/remove behavior;
- one clearly-labelled manual test notification only after explicit approval.

## Secret names and origins

Do not paste these values into chat. If any are missing, enter them in GitHub: repository **Settings → Secrets and variables → Actions → Repository secrets → New repository secret**.

| Secret name | Origin of value | Destination |
| --- | --- | --- |
| `SUPABASE_URL` | Supabase project settings / existing public project URL. | GitHub Actions repository secret. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project API settings, service-role key. | GitHub Actions repository secret only. Never commit or expose. |
| `WEB_PUSH_VAPID_PUBLIC_KEY` | VAPID keypair public key used by the site. | GitHub Actions repository secret; public browser config also uses the public key. |
| `WEB_PUSH_VAPID_PRIVATE_KEY` | Matching VAPID keypair private key. | GitHub Actions repository secret only. Never commit or expose. |
| `WEB_PUSH_VAPID_SUBJECT` | Contact/origin subject for VAPID, e.g. site origin or mailto contact. | GitHub Actions repository secret. |

## Security-sensitive findings

- Historical setup documentation in the repository appears to contain VAPID private material. This branch does not repeat or expose it, but it should be treated as compromised unless already rotated.
- Current `v3` mark-sent/mark-failed wrappers mark by job id without claim-token/worker validation. That is acceptable only as existing compatibility context, not as a pattern for a new targeted test path.
- Current frontend self-test queues to all enabled subscriptions for the logged-in player/scope, not one explicit subscription. For controlled proof, do not use it until an explicit target-subscription/dry-run guard exists.
