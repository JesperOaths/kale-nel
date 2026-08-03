# Push delivery Phase 3 guard proof - 2026-08-02

Branch: `agent/v763-push-delivery-proof`
Scope: explicit-target and dry-run guards before the first real notification send.

No endpoint values, p256dh/auth values, service-role keys, VAPID private keys, or personal payload details are recorded here.

## Changes added

- Added SQL migration `GEJAST_v755i_targeted_push_test_guard.sql`.
- Added dispatcher explicit-target and dry-run support in `web_push_dispatcher.js`.
- Added manual GitHub Actions inputs to both dispatcher workflow files:
  - `dry_run`
  - `require_explicit_target`
  - `target_subscription_id`
  - `max_jobs`
- Added regression coverage: `check-web-push-dispatcher-guards.mjs`, included in `npm run verify`.

## SQL guard behavior

`admin_queue_targeted_web_push_test_v763(...)`:

- requires `admin_check_session(...).ok = true`;
- requires a non-null explicit `target_subscription_id_input`;
- validates the target subscription exists and is not disabled;
- requires fresh current presence for the same subscription with `permission_state='granted'` within 2 hours;
- validates scope;
- defaults to `dry_run=true`, returning a sanitized would-queue result without inserting a job;
- when `dry_run=false`, queues exactly one `admin_targeted_test` job for only that subscription.

Dispatcher targeted path:

- `WEB_PUSH_REQUIRE_EXPLICIT_TARGET=true` refuses to start unless `WEB_PUSH_TARGET_SUBSCRIPTION_ID` is set;
- targeted runs call `claim_web_push_jobs_targeted_v763(...)`, not the broad claim path;
- every claimed item is checked against the explicit target subscription before any send;
- `WEB_PUSH_DRY_RUN=true` validates payload shape, logs only sanitized metadata, then requeues the claimed job without sending;
- send failure logs redact URLs and endpoint/auth-like material;
- 404/410/gone/auth-invalid failures disable the subscription only in the new claim-token-validated v763 failure path.

## Live SQL application and verification

Applied `GEJAST_v755i_targeted_push_test_guard.sql` through the authenticated Supabase SQL editor. It creates/replaces guard functions only; it does not send notifications and does not change Ice/gameplay.

Sanitized live verification:

- Guard functions present: 5/5.
- Invalid admin token check: rejected after fixing the guard to require `admin_check_session(...).ok = true`.
- Target subscription selected for proof: `357`.
- Target has fresh granted presence: true.
- Ice invariant: `id=4`, `key=ice`, `unit_value=2.8`, `is_active=true`.
- Queued `admin_targeted_test` jobs before approval: `0`.

During guard verification, a pre-existing queued `self_test` job for target `357` was discovered/claimed by the verification worker marker. It was not sent. To preserve the approval gate, it was immediately moved out of `queued` state:

- final target queued count: `0`;
- final target claimed count: `0`;
- final target job state: one `self_test` held as `cancelled_before_approval`;
- queued/claimed `admin_targeted_test` jobs: `0`.

## Current stop point

No real notification has been sent by this Phase 3 work.

Stop before first real notification send. Next step requires explicit user approval to queue/send exactly one labelled notification to subscription `357` using the guarded path.
