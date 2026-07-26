# Public/admin deployment model — Kalenel

Updated: 2026-07-26.

## Current state

- Public host: `https://kalenel.nl`.
- `admin.kalenel.nl`: unresolved.
- Admin pages are static files on the public host and are protected only after load by frontend/backend session gates.

## Required model

1. Keep public routes on `kalenel.nl`.
2. Serve protected admin routes from `admin.kalenel.nl`.
3. Put Cloudflare Access/default-deny in front of `admin.kalenel.nl`.
4. Require approved identity plus MFA.
5. Keep Supabase admin session/TOTP as inner lock.
6. Ensure public old admin paths deny or redirect only after the protected admin hostname works.
7. Do not embed secrets in either static bundle.
8. Avoid broad service-worker control over protected admin routes.

## Implementation caution

A JavaScript redirect from public admin pages to `admin.kalenel.nl` is not a security perimeter by itself. It is only acceptable after DNS/TLS/Access are proven and direct protected asset requests are blocked before HTML is served.
