# PUSH_DELIVERY_PHASE4_SECURITY_QUEUE_GATE_PROOF_2026-08-02

Branch: `agent/v763-push-delivery-proof`

Scope: SQL-only security hardening after the first approved attempt (`GEJAST web push dispatcher #1642`) sent nothing because no durable targeted job existed.

## Prior attempt clarification

The dispatcher run `#1642` was submitted with guarded inputs (`dry_run=false`, explicit target `357`, `max_jobs=1`) and completed successfully with sanitized dispatcher output equivalent to `no-web-push-jobs` for `targetSubscriptionId=357`.

That confirms no provider send happened. The retained evidence does not contain a successful durable queue RPC response before run `#1642`. The v763 queue RPC default is `dry_run=true`; its dry-run branch returns sanitized fields including:

```json
{
  "dry_run": true,
  "would_queue": true,
  "queued_count": 0
}
```

The GitHub Actions `dry_run=false` input does not create a job retroactively.

## SQL migration

Created and applied SQL-only migration:

- `GEJAST_v755j_targeted_push_security_hardening.sql`

Changes:

- Revokes dispatcher RPC execution from `public`, `anon`, and `authenticated`.
- Grants dispatcher RPC execution only to `service_role`:
  - `claim_web_push_jobs_targeted_v763(bigint, integer, text, uuid)`
  - `mark_web_push_job_sent_v763(bigint, uuid, text, text)`
  - `mark_web_push_job_failed_v763(bigint, uuid, text, text, text, text, boolean)`
  - `requeue_web_push_job_dry_run_v763(bigint, uuid, text)`
- Revokes `PUBLIC` execution from `admin_queue_targeted_web_push_test_v763(...)`.
- Leaves admin queue callable by `anon`, `authenticated`, and `service_role` only because it validates the inner admin-session token.
- Makes targeted claim select only:
  - `status = 'queued'`
  - `target_subscription_id = explicit target`
  - `trigger_kind = 'admin_targeted_test'`
- Makes normal scheduled claim path exclude:
  - `trigger_kind = 'admin_targeted_test'`
- Rejects duplicate/open admin-targeted queue attempts for the same target while a queued/claimed admin-targeted row exists.

## Local regressions

Added static regression:

- `check-web-push-sql-hardening-v763.mjs`

Updated `npm run verify:static` to include it.

Local gates passed:

- `node check-web-push-sql-hardening-v763.mjs`
- `npm run verify`
- `npm run smoke:live`
- `npm run smoke:beta:read`
- `npm run smoke:push`

Observed:

- Live VERSION remains `v761`.
- Push health smoke remains OK.
- Ice remains `2.8`.

## Live SQL/access verification

Live SQL proof returned sanitized booleans:

```json
{
  "dispatcher_rpc_access_ok": true,
  "admin_queue_public_revoked_ok": true,
  "normal_claim_source_excludes_admin_targeted": true,
  "targeted_claim_source_requires_admin_targeted": true
}
```

Anon REST proof:

- `claim_web_push_jobs_targeted_v763`: `401 / 42501`
- `mark_web_push_job_sent_v763`: `401 / 42501`
- `mark_web_push_job_failed_v763`: `401 / 42501`
- `requeue_web_push_job_dry_run_v763`: `401 / 42501`
- anon read of `web_push_subscriptions` key material for target `357`: `200` with `0` rows.

Invalid admin queue proof:

```json
{
  "beforeOpenAdminTargeted": 0,
  "invalidToken": {
    "status": 400,
    "code": "P0001",
    "message": "admin_session_invalid"
  },
  "afterOpenAdminTargeted": 0
}
```

Safety readback after controlled regression attempts:

```json
{
  "ice_unit": 2.8,
  "target_357_open": { "queued": 0, "claimed": 0 },
  "queued_non_admin": 0,
  "regression_rows_left": 0,
  "queued_admin_targeted": 0,
  "claimed_admin_targeted": 0
}
```

## Queue-only production check status

Blocked before queue-only production check because no active inner admin/TOTP admin session token is available in the admin frontend. I did not bypass the required queue RPC with direct SQL. No durable admin-targeted job was queued in this phase.

Before any real send, a fresh explicit approval is required after a successful queue-only proof with `dry_run=false` through `admin_queue_targeted_web_push_test_v763(...)`.

## Preserved invariants

- Public frontend remains `v761`.
- Ice remains exactly `2.8`.
- Admin Worker was not modified or redeployed; required deployment remains `79e680cd-4baf-433f-8310-da2d1f1c2b9c`.
- Gameplay was not changed.
- No dispatcher run was started after this security-sensitive change.
- No notification was sent.
