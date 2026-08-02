# Security model — Kalenel v761 production completion

Updated: 2026-07-29.

## Public site

`https://kalenel.nl` serves public gameplay, login, request, activation, profile/stat, and spectator/read-only pages. It may use the Supabase publishable key only. It must never contain service-role keys or secrets.

Public account activation and account-request pages must remain available on the public host.

## Admin site target

Target architecture:

- `https://admin.kalenel.nl` resolves separately.
- Cloudflare Workers Free protects `admin.kalenel.nl/*` before static HTML, JS, or assets load.
- Workers Static Assets serves the protected admin bundle.
- GitHub OAuth in the Worker is the outer gate.
- Only the exact approved GitHub account specified locally by Bruis during setup may enter.
- OAuth client secret, cookie-signing secret, and approved private identity values must be encrypted Worker secrets only.
- Existing Supabase admin session/TOTP checks remain required after the Worker gate.
- Direct public requests for admin-only HTML/JS/vault assets on `kalenel.nl` redirect to the protected host or return safe denial.
- JavaScript hiding or redirects are not perimeter security.
- Do not activate Cloudflare Zero Trust, request billing details, enter a payment method, enable paid subscriptions, authorize overages, or use R2/Queues/Workers AI/paid Workers features.

Current state is not final: `admin.kalenel.nl` resolves through Cloudflare but returns `404`, and admin HTML/JS is still reachable on the public host until Worker deployment.

Canonical admin perimeter implementation notes live in `cloudflare/admin-perimeter-v761.md` and `cloudflare/admin-worker-gate-v762.md`.

## Database security

- Sensitive writes must go through RPCs.
- Admin RPCs must validate `admin_check_session` or equivalent require helper.
- Player writes must validate canonical player sessions.
- Friends/family scope must be explicit and enforced server-side.
- Toepen uses separate tables and RPCs from Klaverjas.
- RLS should be enabled for direct table access; public direct grants should be revoked where RPCs own access.

## Push security

- Push subscription endpoint/key material must not be logged in public docs.
- Backend/user-targeted push proof requires a valid player session and permissioned device.
- Replay, expiry, stale subscription, and failed-send behaviour must be tested before completion.

## Data preservation

- Keep Ice exactly 2.8 units.
- Do not recalculate historical records.
- Clean only controlled test data identified by explicit IDs/prefixes.
