# Push v761 real-device/browser proof — 2026-07-27

Production project: `jas-site`  
Frontend version: `v761`  
Branch: `agent/v761-production-completion`

## Scope

Controlled backend web-push proof using the already permissioned Chrome/OpenClaw browser profile on `https://kalenel.nl/push_beta_test.html`.

No PINs, player session tokens, admin tokens, VAPID keys, service-role keys, or browser subscription secrets are recorded here.

## Temporary account

- Name: `AutoV761PushDevice_202607270136`
- Player ID: `159`
- Scope: `friends`
- Creation path: authenticated admin browser session + normal `login_player` RPC
- PIN: generated temporarily and not recorded
- Canonical player session: obtained through normal login and not recorded

## Browser/device readiness before queue

Browser/runtime diagnostics from `window.GEJAST_PUSH_RUNTIME`:

- `Notification.permission`: `granted`
- service worker ready: `true`
- push subscription present: `true`
- backend sync: `synced=true`
- presence touch: `touched=true`
- readiness: `ready_actionable` / `actie-klaar`

## Queue proof

Exactly one backend queue attempt was run through `queue_test_web_push` from the valid temporary player session.

Result:

```json
{
  "queued_exactly_one_attempt": true,
  "queued": {
    "queued": true,
    "payload": {
      "ok": true,
      "queued_count": 1,
      "reason": null
    },
    "reason": null
  },
  "token_recorded": false
}
```

Read-only SQL proof before cleanup:

```json
{
  "checked_at": "2026-07-27T01:48:58.468285+00:00",
  "temp_player": {
    "id": 159,
    "active": true,
    "approved": true,
    "site_scope": "friends",
    "display_name": "AutoV761PushDevice_202607270136"
  },
  "push_subscriptions_for_temp": 1,
  "latest_jobs": [
    {
      "id": 21,
      "status": "queued",
      "sent_at": null,
      "failed_at": null,
      "has_error": false,
      "created_at": "2026-07-27T01:37:26.827535+00:00",
      "error_code": null,
      "site_scope": "friends",
      "trigger_kind": "self_test"
    }
  ]
}
```

## Delivery blocker

Actual delivery through the dispatcher was not run because the local dispatcher environment is absent.

Presence check only, no values read or printed:

- `SUPABASE_URL=missing`
- `SUPABASE_SERVICE_ROLE_KEY=missing`
- `WEB_PUSH_VAPID_PUBLIC_KEY=missing`
- `WEB_PUSH_VAPID_PRIVATE_KEY=missing`
- `WEB_PUSH_VAPID_SUBJECT=missing`

Dispatcher requirements from `web_push_dispatcher.js`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY`

Therefore the real-device backend push exit gate is **not complete**: browser subscription/backend queue proof passed, but real delivery/click proof remains blocked until the dispatcher can run with the proper secret environment or production dispatcher evidence is available.

## Cleanup

Browser storage cleanup:

- temporary Kalenel player session keys were cleared from the Kalenel browser origin;
- no token values were recorded.

Database cleanup was scoped to `AutoV761PushDevice_202607270136` / player `159`:

- deleted queued push job: `[21]`
- deleted subscriptions: `1`
- deleted sessions: `1`
- deactivated player `159`
- set player `approved=false`
- cleared player `pin_hash`
- cleared player `session_token`

Post-cleanup verification:

```json
{
  "player": {
    "id": 159,
    "active": false,
    "approved": false,
    "display_name": "AutoV761PushDevice_202607270136",
    "has_pin_hash": false,
    "has_session_token": false
  },
  "remaining_jobs": 0,
  "remaining_sessions": 0,
  "remaining_subscriptions": 0,
  "other_players_touched": false
}
```

## Result

- Browser permission/subscription/backend sync/presence proof: **passed**.
- Backend queue proof: **passed**, exactly one self-test job queued.
- Real push delivery/click proof: **blocked externally** by missing dispatcher secret environment / no production dispatcher run evidence in this session.
- Cleanup: **complete** for the controlled temporary account and controlled queued job.
