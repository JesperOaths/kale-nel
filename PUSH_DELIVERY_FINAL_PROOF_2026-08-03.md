# PUSH_DELIVERY_FINAL_PROOF_2026-08-03

Branch: `agent/v763-push-delivery-proof`

Scope: final controlled proof for one targeted admin web-push delivery attempt after PR #3 merged to `main` and after the v763 queue/readiness hardening work.

## Constraints preserved

- No additional notification was queued after job `24`.
- No second send attempt was made.
- No broadcast path was used.
- No fallback target was used.
- Public frontend remains `v761`.
- Ice remains exactly `2.8`.
- Gameplay was not changed.
- Existing Worker code/gate was not changed during this final proof pass.
- Secrets, cookies, session tokens, subscription endpoints, push keys, VAPID values, raw trace IDs, and raw diagnostics were not recorded in this proof.

## Queue-only state before send

Prior queue-only verification created exactly one durable admin-targeted row through the protected admin queue page and RPC path:

```json
{
  "job_id": 24,
  "status": "queued",
  "trigger_kind": "admin_targeted_test",
  "target_subscription_id": 357,
  "site_scope": "friends"
}
```

The normal scheduled dispatcher safety guard was verified before the real attempt: `claim_web_push_jobs_v2(...)` still contains the `admin_targeted_test` exclusion, so scheduled runs cannot claim targeted proof jobs.

## Approved single real attempt

User approval: run exactly one real targeted dispatcher attempt for queued job `24`, targeting subscription `357` only.

GitHub Actions run:

- Workflow: `GEJAST web push dispatcher`
- Run: `#1650`
- Branch/commit: `agent/v763-push-delivery-proof` / `fe629ce`
- Inputs:
  - explicit target: `357`
  - max jobs: `1`
  - dry run: `false`
  - require explicit target: `true`

Sanitized dispatcher output:

```json
{
  "sent": {
    "jobId": 24,
    "targetSubscriptionId": 357,
    "kind": "admin_targeted_test"
  },
  "complete": {
    "total": 1,
    "sent": 1,
    "failed": 0,
    "dryRun": 0,
    "targetSubscriptionId": 357
  }
}
```

Interpretation: the push provider accepted the notification through the guarded targeted claim path.

## Final sanitized database proof

Final read-only proof returned:

```json
{
  "job_24": {
    "id": 24,
    "status": "sent",
    "site_scope": "friends",
    "has_sent_at": true,
    "trigger_kind": "admin_targeted_test",
    "has_failed_at": false,
    "has_claimed_at": true,
    "has_error_text": false,
    "trace_id_sanitized": "sha256:00d8b702d5ceb210447524bcb26d004e4f7b735cd586ee46a3815e88ff234a51",
    "target_subscription_id": 357,
    "has_provider_message_id": true
  },
  "attempts": [
    {
      "stage": "claim_targeted_v763",
      "job_id": 24,
      "status": "ok",
      "error_code": null,
      "has_error_text": false
    },
    {
      "stage": "mark_sent_v763",
      "job_id": 24,
      "status": "ok",
      "error_code": null,
      "has_error_text": false
    }
  ],
  "open_admin_targeted_count": 0,
  "processed_admin_targeted_ids": [24],
  "processed_admin_targeted_count": 1,
  "non24_processed_admin_targeted_count": 0
}
```

Final invariant readback:

```json
{
  "job_24_status": "sent",
  "ice_unit_value": 2.8,
  "processed_admin_targeted_ids": [24]
}
```

## Device delivery and click navigation

The user confirmed after the send:

- The notification appeared.
- It was clicked exactly once.
- The click opened the intended target page:
  - `push_beta_test.html?push_test=targeted`
  - with `action_status=opened`
  - with `job_id=24`

Device delivery and click navigation are therefore passed.

The database did not contain a separate action-token consumption row for this `admin_targeted_test` notification, which is expected for a plain open action: the service worker open path appends status parameters and focuses/opens the target URL; it only consumes action tokens for explicit verify/reject actions.

## Separate no-subscription / missing-subscription investigation

This does not invalidate delivery or click proof.

The push test page computes `subscription_missing` / `no-subscription` from the currently opened browser context using local browser state:

- `navigator.serviceWorker.ready`
- `registration.pushManager.getSubscription()`
- local notification permission
- local player session token
- backend sync and presence touch

Observed states during proof:

- The provider and dispatcher accepted/sent job `24` to subscription `357`.
- The user observed delivery and click navigation to the intended URL.
- A later page view can still show `subscription: missing` / `no-subscription` or `MISSING_SESSION` if that browser context lacks the exact local subscription or has an invalid/missing player session.
- In the OpenClaw browser check, the page showed a local subscription present but `MISSING_SESSION`; this is the same class of local readiness issue and is separate from the completed provider delivery proof.

No retry was performed.

## Final verification gates

Passed after the final proof:

- `npm run verify`
- `npm run smoke:live`
- `npm run smoke:beta:read`

Observed live invariant from smoke:

- Live `VERSION`: `v761`
- Protected admin read-only routes still return expected `401` on unauthenticated public access.

## Outcome

Push delivery proof is complete for the controlled target:

- exactly one queued job (`24`)
- exactly one real targeted dispatcher attempt
- exactly one processed `admin_targeted_test` job
- provider accepted the send
- target subscription was only `357`
- user-confirmed notification delivery and click navigation passed
- no other admin-targeted job was processed
- no follow-up notification was queued or sent
