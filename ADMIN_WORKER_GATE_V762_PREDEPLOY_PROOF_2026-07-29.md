# Kalenel admin Worker gate v762 — predeploy proof

Timestamp: 2026-07-29 02:26 Europe/Amsterdam.

## Scope

Prepared a replacement for the abandoned Cloudflare Zero Trust/Access plan. This version uses only Cloudflare Workers Free + Workers Static Assets for an outer GitHub OAuth gate on `admin.kalenel.nl`.

No payment method, billing address, paid subscription, overage authorization, R2, Queues, Workers AI, paid Workers plan, or Cloudflare Zero Trust activation was enabled.

## Repo artifacts

- Worker source: `cloudflare/workers/admin-gate/src/worker.js`
- Worker config: `cloudflare/workers/admin-gate/wrangler.toml`
- Static asset build script: `scripts/build-admin-worker-assets.mjs`
- Local Worker auth test: `scripts/test-admin-worker-gate.mjs`
- Live probe: `scripts/probe-admin-worker-gate-v762.ps1`
- Free-only implementation notes: `cloudflare/admin-worker-gate-v762.md`
- Rollback: `ADMIN_WORKER_GATE_ROLLBACK_v762.md`
- Predeploy probe output: `ADMIN_WORKER_GATE_PREDEPLOY_PROBE_v762.json`

The generated `cloudflare/workers/admin-gate/static/` bundle is intentionally ignored by Git and rebuilt before deploy with `npm run admin-worker:build`.

## Security implementation notes

Implemented in Worker source:

- GitHub OAuth state validation.
- Exact callback URL: `https://admin.kalenel.nl/oauth/callback`.
- Exact GitHub account allowlist via encrypted Worker secrets.
- Short-lived signed Worker sessions.
- HttpOnly, Secure, SameSite=Strict cookies.
- Logout clears Worker session/OAuth/attempt cookies.
- Bounded login attempts via signed attempt cookie.
- Safe `return_to` handling; external URLs, protocol-relative URLs, traversal, login/callback/logout targets are rejected or normalized to `/admin.html`.
- Path traversal rejection.
- Security headers.
- `Cache-Control: no-store` for auth and protected HTML.
- Fail-closed responses when Worker configuration/assets are missing.
- `run_worker_first = true` so Workers Static Assets cannot bypass Worker code on protected public apex routes.

The existing Supabase admin-session/TOTP gate is preserved behind the Worker as the inner lock; no service-role key or private Supabase secret is used by the Worker.

## Checks run

```txt
npm run admin-worker:build
npm run admin-worker:test
npm run admin-worker:dry-run
npm run verify:static
npm run verify:js
.\scripts\probe-admin-worker-gate-v762.ps1 > ADMIN_WORKER_GATE_PREDEPLOY_PROBE_v762.json
```

Results:

- `admin-worker:build` passed; 635 files copied into generated local static bundle.
- `admin-worker:test` passed.
- `admin-worker:dry-run` passed; Wrangler showed only `env.ASSETS` binding and no route/assets bypass warning.
- `verify:static` passed; Root VERSION remains `v761`.
- `verify:js` passed; 314 files checked.
- Predeploy live probe confirms current live state remains incomplete until deploy:
  - `admin.kalenel.nl` resolves through Cloudflare.
  - `admin.kalenel.nl` returns `404` before Worker deployment.
  - `kalenel.nl/admin.html` still returns public admin HTML before Worker route deployment.

## Deployment blocker

Wrangler is not authenticated locally (`npx wrangler whoami` says not authenticated), and the Worker cannot be deployed securely until Bruis locally creates/chooses the GitHub OAuth app and installs encrypted Worker secrets.

Required local-only setup:

1. Create a GitHub OAuth app with:
   - Homepage URL: `https://admin.kalenel.nl/`
   - Callback URL: `https://admin.kalenel.nl/oauth/callback`
2. Run `npx wrangler login` if Wrangler is not authenticated.
3. Set the required Worker secrets locally with `npx wrangler secret put ...`. Do not paste values into chat/docs/Git.
4. Then deploy:
   - `npm run admin-worker:build`
   - `npx wrangler deploy --config cloudflare/workers/admin-gate/wrangler.toml`

After deploy, run `./scripts/probe-admin-worker-gate-v762.ps1` and complete the approved/unapproved GitHub + Supabase inner-lock proof matrix.
