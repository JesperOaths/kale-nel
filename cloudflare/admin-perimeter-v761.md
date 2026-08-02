# Kalenel admin perimeter — v761/v762 Cloudflare implementation plan

Status: **Cloudflare Access proposal superseded**. Do not activate Cloudflare Zero Trust, request billing details, enter a payment method, enable paid subscriptions, or authorize overages. The active plan is the free Cloudflare Workers gate in `cloudflare/admin-worker-gate-v762.md`.

This is the operator-facing perimeter configuration. It intentionally does not contain credentials, tokens, API keys, service-role keys, cookie values, or private identity values.

## Hosting architecture

- Public gameplay site remains on `https://kalenel.nl` with v761 behaviour unchanged.
- Protected admin site is `https://admin.kalenel.nl`.
- `admin.kalenel.nl` is Cloudflare-proxied and must be served by the `kalenel-admin-gate` Worker Custom Domain.
- Cloudflare Workers Free protects `admin.kalenel.nl/*` **before** any static HTML, JS, or assets are served.
- Workers Static Assets serves the protected admin bundle.
- GitHub OAuth in the Worker is the outer gate.
- The existing Supabase admin session + TOTP validation remains the independent inner lock after the Worker gate.
- Do not rely on JavaScript redirects, hidden DOM, or static repo files for perimeter enforcement.

## DNS and Worker routing

`admin.kalenel.nl` must resolve through Cloudflare. The Worker config adds:

- Custom Domain: `admin.kalenel.nl`
- Worker routes for public apex protected paths on `kalenel.nl`

Protected public paths redirect to the matching `admin.kalenel.nl` route or fail safely:

```txt
/admin*.html
/admin-*.js
/admin_*.js
/admin.js
/gejast-admin*.js
/gejast-push-admin-source.js
/drinks_admin.html
/familie_admin.html
/match_control.html
/match_swap.html
/*_vault.html
/vault.html
/familie/admin.html
/repo/admin*.html
```

Sensitive repo artifacts should not be publicly served:

```txt
/admin-dev.html
/admin_v60_orig.html
/*_orig.html
/*.md
/*.txt
/*.sql
/*.patch
/mnt/*
/deployment_forensics_v761/*
/sql/*
```

Public pages that must remain available on `kalenel.nl` include:

```txt
/
/index.html
/home.html
/login.html
/request.html
/activate.html
/invite.html
/profiles.html
/player.html
/my_profile.html
/leaderboard.html
/ladder.html
/score.html
/scorer.html
/ballroom.html
/beerpong.html
/boerenbridge.html
/boerenbridge_live.html
/boerenbridge_spectator.html
/drinks*.html except drinks_admin.html
/klaverjas*.html
/paardenrace*.html
/pikken*.html
/toepen.html
/despimarkt*.html
/beurs.html
/rad.html
/rad_stats.html
```

Exception: admin/vault variants remain protected even if their prefix also appears in a public feature.

## Worker application

Worker:

- Runtime: Cloudflare Workers Free.
- Static content: Workers Static Assets.
- Hostname: `admin.kalenel.nl`.
- Path: `/*`.
- Session duration: short-lived Worker cookie; Supabase remembered-device rules remain inner-lock behaviour.
- Outer identity: GitHub OAuth.
- Allow policy: exact approved GitHub account specified locally by Bruis during setup, stored as encrypted Worker secrets only.
- No Cloudflare Zero Trust, payment method, billing address, paid Workers plan, R2, Queues, Workers AI, or usage-billed service.

## Required proof matrix

Do not treat JavaScript redirects or hidden DOM as perimeter proof. Required perimeter evidence:

- `admin.kalenel.nl` resolves and TLS validates.
- Anonymous `https://admin.kalenel.nl/admin.html` shows Worker login, not admin HTML.
- Failed GitHub login is denied.
- Unapproved GitHub user is denied.
- Approved GitHub user reaches protected admin host.
- Expired Worker session is denied.
- Modified Worker session cookie is denied.
- OAuth state mismatch and replayed callback are denied.
- Logout clears Worker access.
- Direct protected asset requests require Worker session on admin host.
- Public apex admin paths no longer expose admin content.
- Invalid Supabase admin session is blocked by the inner lock after Worker login.
- Valid Supabase admin/TOTP session reaches protected admin pages.
- Important admin RPCs reject anonymous, normal-player, wrong-scope, and expired-admin calls; valid admin succeeds.
- Account remains on Workers Free; no payment method, paid subscription, or billable product was enabled.
- Live v761 gameplay routes remain unchanged.

## Current state before Worker deployment

- `admin.kalenel.nl` resolves through Cloudflare.
- `https://admin.kalenel.nl/` returns `404` until Worker Custom Domain deployment.
- `https://kalenel.nl/admin.html` still returns public admin HTML until public apex Worker routes deploy.
