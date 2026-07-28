# Public/admin deployment model — Kalenel

Updated: 2026-07-29.

## Current state

- Public host: `https://kalenel.nl`.
- Live frontend version: `v761`.
- Public host is still the only resolving custom hostname.
- `admin.kalenel.nl` is still unresolved until Cloudflare/DNS is configured.
- `https://kalenel.nl/admin.html` still returns `200` static admin HTML, so the perimeter is not complete.
- Admin pages have Supabase admin-session/TOTP gates, but those run after static files load and are not a network perimeter.

## Required model

1. Keep public routes on `kalenel.nl`.
2. Serve protected admin routes from `admin.kalenel.nl`.
3. Put Cloudflare Access/default-deny in front of `admin.kalenel.nl/*`.
4. Require only explicitly approved identities and MFA.
5. Keep Supabase admin session/TOTP as the inner lock.
6. Ensure old public admin paths deny or redirect only after the protected admin hostname works.
7. Do not embed secrets in either static bundle.
8. Avoid broad service-worker control over protected admin routes.
9. Enforce no-store/noindex-style behavior at Cloudflare for admin paths if GitHub Pages remains the origin.

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

A JavaScript redirect from public admin pages to `admin.kalenel.nl` is not a security perimeter by itself. It is only acceptable after DNS/TLS/Access are proven and direct protected asset requests are blocked before HTML is served.

## Probe

Run this after Cloudflare/DNS changes:

```powershell
.\scripts\probe-admin-perimeter-v761.ps1
```

Passing shape:

- `admin.kalenel.nl` resolves and has valid HTTPS.
- anonymous `admin.kalenel.nl/admin.html` returns Cloudflare Access denial/login, not admin HTML.
- public `kalenel.nl/admin.html` returns redirect/denial, not `200` HTML.
- public activation/request/login/game pages still return `200`.
