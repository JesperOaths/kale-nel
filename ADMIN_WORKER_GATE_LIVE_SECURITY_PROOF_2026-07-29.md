# Kalenel admin Worker gate live security proof — 2026-07-29

## Scope

Deployed and retested the Workers Free admin gate for `kalenel.nl` from branch `agent/v761-production-completion`.

No Cloudflare Zero Trust activation, billing setup, paid plan feature, R2, Queues, Workers AI, or paid Cloudflare service was used.

## Live deployment

- Worker: `kalenel-admin-gate`
- Latest clean live Worker version reported by Wrangler: `fa44258a-c434-40f0-b0c9-74f5bfc6e5ba`
- Live routes:
  - `admin.kalenel.nl/*`
  - `kalenel.nl/*`

The original granular route list could not deploy because Cloudflare rejects middle-wildcard route patterns such as `*_vault.html`, `*.md`, `*.sql`, and `*.patch`. The deployed Free-compatible fix routes the whole apex through the Worker and keeps the allow/redirect decision in Worker code: ordinary public pages pass through, protected admin/artifact paths redirect to `admin.kalenel.nl`.

## Fixes made during deployment

- Replaced Worker custom-domain config with classic Workers Free routes.
- Rotated `COOKIE_SECRET` because the configured secret existed but was too short; the replacement was generated locally and piped to Wrangler without printing it.
- Re-entered the OAuth Client ID from GitHub app settings into Wrangler without printing it.
- Added fail-closed validation/normalization for wrapped OAuth Client ID / Client Secret values.
- Fixed OAuth state cookie compatibility: the temporary OAuth state cookie now uses `SameSite=Lax` so GitHub's cross-site callback can return it; the final admin session cookie remains `SameSite=Strict`.
- Added a cache-busted live proof script: `scripts/proof-admin-worker-live-v762.mjs`.
- Updated local Worker tests to cover quoted/malformed OAuth config and OAuth-cookie SameSite behavior.

## Automated live proof

Artifact: `ADMIN_WORKER_GATE_LIVE_SECURITY_PROOF_2026-07-29.json`

Latest result after restoring the clean non-diagnostic Worker: **19/20 rows passed**.

Passed examples:

- `https://admin.kalenel.nl/`, `/admin.html`, and `/admin.js` return Worker login / unauthenticated denial instead of admin HTML.
- Tampered session cookie is denied.
- OAuth callback replay/mismatch is denied.
- Apex admin/support/admin JS/vault/repo-artifact paths redirect to `admin.kalenel.nl` with `Cache-Control: no-store`.
- Public pages remain public: `home.html`, `login.html`, `activate.html`, `request.html`, `paardenrace.html`, and `toepen.html`.

## Browser OAuth / inner-lock proof status

Outer GitHub OAuth browser proof progressed to GitHub consent for the approved account and confirmed the app/callback target. After fixing the OAuth state cookie, the callback reached the Worker, but token exchange could not complete because the configured `GITHUB_CLIENT_SECRET` still appears malformed to the Worker.

GitHub app settings only show the existing secret as a masked suffix, so the full secret cannot be recovered. Attempting to generate a new OAuth Client Secret requires GitHub sudo-mode approval in GitHub Mobile. A prompt was triggered, but the phone approval timed out. No secret values were copied into evidence or committed.

Because of that manual GitHub sudo blocker, approved GitHub OAuth completion and the downstream Supabase admin/TOTP inner-lock proof remain blocked. The Worker is currently clean and fail-closed, with no diagnostic error-reason header exposed.

## Required next step

Approve GitHub sudo mode when prompted, generate a new OAuth Client Secret, copy the one-time full value directly into Wrangler:

```powershell
npx wrangler secret put GITHUB_CLIENT_SECRET --config cloudflare/workers/admin-gate/wrangler.toml
```

Then rerun:

```powershell
node scripts/proof-admin-worker-live-v762.mjs | Set-Content -Encoding UTF8 ADMIN_WORKER_GATE_LIVE_SECURITY_PROOF_2026-07-29.json
```

After that, browser proof at `https://admin.kalenel.nl/admin.html` should complete the outer Worker gate and reach the existing Supabase/TOTP inner lock.

## Local verification

Passed after the Worker/config changes:

```txt
npm run admin-worker:test
npm run verify:static
npm run verify:js
```
