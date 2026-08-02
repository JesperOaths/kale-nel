# Kalenel admin perimeter — Cloudflare Workers Free gate (v762 admin surface)

Status: implementation prepared; deployment requires local secret entry by Bruis and Cloudflare Workers Free deploy.

This replaces the earlier Cloudflare Access proposal. Do **not** activate Cloudflare Zero Trust, request billing details, enter a payment method, enable a paid Workers plan, R2, Queues, Workers AI, or any usage-billed service.

## Architecture

- Public gameplay site remains on `https://kalenel.nl` and stays at the existing v761 frontend behaviour.
- Admin outer gate is a Cloudflare Worker on Workers Free.
- Protected hostname: `https://admin.kalenel.nl`.
- Static admin bundle is served through Workers Static Assets from `cloudflare/workers/admin-gate/static`.
- Outer authentication: GitHub OAuth handled inside the Worker.
- Inner authentication remains unchanged: existing Supabase admin-session/TOTP validation inside the admin pages and protected RPCs.
- Secrets are Worker encrypted secrets only. They must never be committed, printed into logs, put into frontend JavaScript, or documented with values.

## Worker security properties

Implemented in `cloudflare/workers/admin-gate/src/worker.js`:

- GitHub OAuth `state` cookie validation.
- OAuth callback fixed to exactly `https://admin.kalenel.nl/oauth/callback`.
- Exact approved GitHub account allowlisting via `APPROVED_GITHUB_ID` and/or `APPROVED_GITHUB_LOGIN` Worker secrets.
- Short-lived signed Worker session cookie, currently 30 minutes.
- `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/` cookies.
- Logout clears Worker session, OAuth, and attempt cookies.
- Bounded login attempts with a signed attempt cookie.
- No open redirect via `return_to`; only safe same-origin relative paths are accepted.
- Path traversal is rejected.
- Security headers are added to auth and protected responses.
- `Cache-Control: no-store` for auth and protected HTML.
- Fail-closed response when the Worker is misconfigured or the static assets binding is missing.

## Required local setup values

Bruis must create a GitHub OAuth app locally. Use exactly:

- Homepage URL: `https://admin.kalenel.nl/`
- Authorization callback URL: `https://admin.kalenel.nl/oauth/callback`

Then set these locally as encrypted Worker secrets without exposing values in chat, docs, logs, or Git:

```powershell
npx wrangler secret put GITHUB_CLIENT_ID --config cloudflare/workers/admin-gate/wrangler.toml
npx wrangler secret put GITHUB_CLIENT_SECRET --config cloudflare/workers/admin-gate/wrangler.toml
npx wrangler secret put COOKIE_SECRET --config cloudflare/workers/admin-gate/wrangler.toml
npx wrangler secret put APPROVED_GITHUB_ID --config cloudflare/workers/admin-gate/wrangler.toml
# optional secondary exact check:
npx wrangler secret put APPROVED_GITHUB_LOGIN --config cloudflare/workers/admin-gate/wrangler.toml
```

The GitHub client id is not inherently secret, but keeping all OAuth/allowlist values out of Git avoids accidental drift.

## Build and deploy

```powershell
npm run admin-worker:build
npm run admin-worker:test
npm run verify:static
npm run verify:js
npx wrangler deploy --config cloudflare/workers/admin-gate/wrangler.toml
```

The Worker config uses:

- Custom Domain: `admin.kalenel.nl`
- Worker routes for protected public apex paths such as `/admin*.html`, protected admin JS, vault pages, repo-sensitive files, `mnt`, `deployment_forensics_v761`, and `sql`.

## Public routes that must remain open

Do not block:

```txt
/
/index.html
/home.html
/login.html
/request.html
/activate.html
/invite.html
/klaverjas*.html
/paardenrace*.html
/pikken*.html
/toepen.html
/drinks*.html except drinks_admin.html
/boerenbridge*.html except *_vault.html
```

## Evidence to record without secrets

- DNS result for `admin.kalenel.nl`.
- Worker deployment name and timestamp.
- Confirmation account remains on Workers Free and no billing/payment/paid service was enabled.
- Anonymous `admin.kalenel.nl/admin.html` returns Worker login, not admin HTML.
- Modified/expired session cookies are rejected.
- Approved GitHub account can reach protected admin HTML after OAuth.
- Unapproved GitHub account is denied.
- Logout clears Worker access.
- Public `kalenel.nl/admin*` and protected assets redirect/deny without exposing content.
- Public `activate.html`, `request.html`, `login.html`, `home.html`, and live gameplay pages still return public content.
- Inner Supabase admin session/TOTP gate still blocks invalid admin sessions after Worker login.
- Protected RPCs still reject anonymous and normal player sessions; valid admin succeeds.

## Free-plan failure model

Cloudflare Worker routes are the security boundary. If Workers Free limits are exceeded, protected routes must fail closed by returning a Cloudflare/Worker error rather than bypassing to the public GitHub Pages origin. Do not add DNS or route fallbacks that serve protected admin files directly from the public origin.
