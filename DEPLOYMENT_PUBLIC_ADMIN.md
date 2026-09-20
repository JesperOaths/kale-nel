# Public/admin deployment model — Kalenel

Updated: 2026-09-20.

## Current state

- Public host: `https://kalenel.nl`.
- The protected admin host `https://admin.kalenel.nl` is live behind the `kalenel-admin-gate` Cloudflare Worker.
- GitHub OAuth is the outer gate and Supabase admin-session/TOTP remains the independent inner lock.
- Public apex admin routes are intercepted by the Worker and redirect to the protected admin host instead of serving admin HTML directly.
- Protected responses use `Cache-Control: no-store`; direct anonymous access to protected admin pages is denied.
- The v847 Shop Operations console is live in the protected bundle.
- Protected admin frontend **source still exists in the public GitHub repository**. The migration tooling in `PRIVATE_ADMIN_SOURCE_MIGRATION_v847.md` prepares a separate private-source repository and fail-closed cutover without changing the live perimeter.

## Required free-only model

1. Keep public routes on `kalenel.nl`.
2. Serve protected admin routes from `admin.kalenel.nl` through Cloudflare Workers Free.
3. Use Workers Static Assets for the protected admin bundle.
4. Use GitHub OAuth inside the Worker as the outer gate.
5. Allow only the exact approved GitHub account specified locally by Bruis during setup.
6. Store OAuth client secret, cookie-signing secret, and private allowlist values only as encrypted Worker secrets.
7. Keep Supabase admin session/TOTP as the independent inner lock.
8. Ensure old public admin paths deny or redirect only after the protected admin hostname works.
9. Do not embed secrets in either static bundle.
10. Avoid broad service-worker control over protected admin routes.
11. Enforce `Cache-Control: no-store` and security headers at the Worker for auth and protected HTML.

Do **not** activate Cloudflare Zero Trust, request billing details, enter a payment method, enable paid subscriptions, authorize overages, use R2, Queues, Workers AI, paid Workers plan features, or any usage-billed service.

## Admin-only public paths to block or redirect at the edge

See `cloudflare/admin-perimeter-v761.md` for the canonical path list and proof matrix. The important classes are:

- `admin*.html`
- `admin-*.js`, `admin.js`, `admin_*.js`
- `gejast-admin*.js`, `gejast-push-admin-source.js`
- `drinks_admin.html`, `familie_admin.html`
- `match_control.html`, `match_swap.html`
- `*_vault.html`, `vault.html`
- repo artifacts such as `*.md`, `*.txt`, `*.sql`, `*.patch`, `mnt/*`, `sql/*`, deployment forensics

## Public pages that must stay available

Activation, request, login, homepage, public game pages, public stats/history pages, spectator pages, and non-admin feature pages remain on `kalenel.nl`.

## Implementation caution

A JavaScript redirect from public admin pages to `admin.kalenel.nl` is not a security perimeter by itself. Public admin paths and direct protected asset requests must be intercepted by Cloudflare Worker routes before static content is served.

## Private-source separation

The Worker perimeter is the security boundary; source privacy is an additional hardening layer, not a substitute for authentication.

- `npm run admin-source:extract` creates the one-time private-source migration package.
- `admin-source-manifest.json` SHA-256 binds the external private source.
- The admin Worker deploy workflow supports `external-private` mode.
- GEJAST CI can overlay the same verified private source in its ephemeral workspace.
- Do not remove current public protected source until the external-private deploy and CI overlay are both proven.
- See `PRIVATE_ADMIN_SOURCE_MIGRATION_v847.md`.

## Build/test/deploy

```powershell
npm run admin-worker:build
npm run admin-worker:test
npm run verify:static
npm run verify:js
npx wrangler deploy --config cloudflare/workers/admin-gate/wrangler.toml
```

## Probe

Run this after Worker deployment:

```powershell
.\scripts\probe-admin-worker-gate-v762.ps1
```

Passing shape:

- `admin.kalenel.nl` resolves and has valid HTTPS.
- anonymous `admin.kalenel.nl/admin.html` returns Worker GitHub login, not admin HTML.
- modified/expired Worker session cookies are rejected.
- public `kalenel.nl/admin.html` returns redirect/denial, not `200` HTML.
- public activation/request/login/game pages still return `200`.
- the Supabase admin-session/TOTP inner lock still blocks invalid admin sessions after Worker login.
