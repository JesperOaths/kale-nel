# Kalenel admin perimeter — v761 Cloudflare implementation plan

Status: **not complete until Cloudflare/DNS evidence is captured**.

This is the operator-facing perimeter configuration for the existing v761 frontend. It intentionally does not contain credentials, tokens, API keys, service-role keys, or identity values.

## Hosting architecture

- Public site remains on `https://kalenel.nl`.
- Protected admin site is `https://admin.kalenel.nl`.
- `admin.kalenel.nl` must be Cloudflare-proxied and covered by a valid Cloudflare TLS certificate.
- Cloudflare Access protects `admin.kalenel.nl/*` **before** any static HTML, JS, or assets are served.
- The existing Supabase admin session + TOTP validation remains the inner lock after Cloudflare Access.
- If GitHub Pages remains the public origin, do not rely on repo `_headers`/static files for enforcement; enforce the perimeter at Cloudflare.
- Preferred long-term shape: a filtered admin bundle or separate Cloudflare Pages project for `admin.kalenel.nl`, plus public apex rules denying admin-only paths.

## DNS

Create a proxied DNS record for `admin.kalenel.nl` that points at the admin static deployment/origin.

Acceptable origin choices:

1. **Preferred:** Cloudflare Pages deployment from the repo, ideally filtered to admin-only files.
2. **Temporary:** same static bundle as public origin, but only if Cloudflare Access gates the whole `admin.kalenel.nl/*` hostname and public apex rules block admin-only source paths.

Do not mark admin complete while `admin.kalenel.nl` is NXDOMAIN or while `https://kalenel.nl/admin.html` returns `200` HTML.

## Cloudflare Access application

Application:

- Type: Self-hosted/public hostname.
- Hostname: `admin.kalenel.nl`.
- Path: `/*`.
- Session duration: short enough for admin risk; remembered Supabase devices are still controlled by the inner lock.
- Policy posture: default-deny. Cloudflare Access already denies users who do not match an allow policy.
- Allow policy: only explicitly approved identities/groups.
- MFA: required by the identity provider / Access posture configuration.

Evidence to record, without secret values:

- Application ID or name.
- Hostname.
- Policy names.
- Approved identity/group labels only if non-sensitive.
- MFA requirement state.
- Test timestamp and result.

## Public apex edge rules

Once the admin hostname works, configure the public apex so admin source is no longer served from `kalenel.nl`.

Admin-only paths to redirect to `https://admin.kalenel.nl/<same path>` or deny safely:

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

Sensitive repo artifacts that should not be publicly served:

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
/drinks*.html
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

## Required proof matrix

Do not treat JavaScript redirects or hidden DOM as perimeter proof. Required perimeter evidence:

- `admin.kalenel.nl` resolves.
- TLS certificate validates for `admin.kalenel.nl`.
- Anonymous `https://admin.kalenel.nl/admin.html` is blocked by Cloudflare Access before static HTML loads.
- Denied Cloudflare identity cannot enter.
- Approved Cloudflare identity with MFA can reach admin host.
- Invalid Supabase admin session is blocked by the inner lock after Access.
- Expired Supabase admin session is blocked or renewed only through remembered-device rules.
- Valid Supabase admin session reaches protected admin pages.
- Remembered device path still validates server-side.
- Logout and revocation clear/deny access.
- Malicious `return_to` values do not create open redirects.
- Direct protected asset requests are blocked/redirected from public apex and Access-gated on admin host.
- Important admin RPCs reject anonymous, normal-player, wrong-scope, and expired-admin calls; valid admin succeeds.

## Current v761 blocker

As of the v761 production-completion branch, live checks still show:

- `admin.kalenel.nl`: NXDOMAIN / does not resolve.
- `https://kalenel.nl/admin.html`: `200` public static HTML.

So the admin perimeter is still externally blocked on Cloudflare/DNS configuration.
