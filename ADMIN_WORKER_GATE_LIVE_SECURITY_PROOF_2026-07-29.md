# Kalenel admin Worker gate live security proof — 2026-07-29

## Scope

Deployed the Workers Free admin gate for `kalenel.nl` from branch `agent/v761-production-completion` after starting at commit `1643394`.

No Cloudflare Zero Trust activation, billing setup, paid plan feature, R2, Queues, Workers AI, or paid Cloudflare service was used.

## Live deployment

- Worker: `kalenel-admin-gate`
- Final live Worker version reported by Wrangler: `70db44db-8469-43ec-a748-9a9f986bcd80`
- Live routes:
  - `admin.kalenel.nl/*`
  - `kalenel.nl/*`

The original granular route list could not deploy because Cloudflare rejects middle-wildcard route patterns such as `*_vault.html`, `*.md`, `*.sql`, and `*.patch`. The deployed Free-compatible fix routes the whole apex through the Worker and keeps the allow/redirect decision in Worker code: ordinary public pages pass through, protected admin/artifact paths redirect to `admin.kalenel.nl`.

## Fixes made during deployment

- Replaced Worker custom-domain config with classic Workers Free routes.
- Rotated `COOKIE_SECRET` because the configured secret existed but was too short; the replacement was generated locally and piped to Wrangler without printing it.
- Added fail-closed validation for malformed `GITHUB_CLIENT_ID` so broken OAuth config does not send users to a malformed GitHub URL.
- Added a cache-busted live proof script: `scripts/proof-admin-worker-live-v762.mjs`.
- Updated local Worker tests to cover malformed GitHub client IDs.

## Automated live proof

Artifact: `ADMIN_WORKER_GATE_LIVE_SECURITY_PROOF_2026-07-29.json`

Result: **19/20 rows passed**.

Passed examples:

- `https://admin.kalenel.nl/`, `/admin.html`, and `/admin.js` return Worker login / unauthenticated denial instead of admin HTML.
- Tampered session cookie is denied.
- OAuth callback replay/mismatch is denied.
- Apex admin/support/admin JS/vault/repo-artifact paths redirect to `admin.kalenel.nl` with `Cache-Control: no-store`.
- Public pages remain public: `home.html`, `login.html`, `activate.html`, `request.html`, `paardenrace.html`, and `toepen.html`.

## Remaining blocker

`login starts GitHub OAuth` is blocked because the configured `GITHUB_CLIENT_ID` Worker secret is malformed. Browser proof showed GitHub receiving a malformed `client_id`, and the final Worker now correctly fails closed for that condition.

To complete approved GitHub + inner Supabase/TOTP proof, re-enter the real GitHub OAuth app Client ID locally with:

```powershell
npx wrangler secret put GITHUB_CLIENT_ID --config cloudflare/workers/admin-gate/wrangler.toml
```

Do not paste the value into chat, docs, or Git. After replacing it, rerun:

```powershell
node scripts/proof-admin-worker-live-v762.mjs | Set-Content -Encoding UTF8 ADMIN_WORKER_GATE_LIVE_SECURITY_PROOF_2026-07-29.json
```

Then complete browser proof at `https://admin.kalenel.nl/admin.html`: approved GitHub account should pass the outer Worker gate and land on the existing Supabase admin/TOTP inner lock.

## Local verification

Passed after the Worker/config changes:

```txt
npm run admin-worker:test
npm run verify:static
npm run verify:js
```
