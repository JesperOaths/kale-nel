# Security model — Kalenel v761 production completion

Updated: 2026-07-26.

## Public site

`https://kalenel.nl` serves public gameplay, login, request, activation, profile/stat, and spectator/read-only pages. It may use the Supabase publishable key only. It must never contain service-role keys or secrets.

## Admin site target

Target architecture:

- `https://admin.kalenel.nl` resolves separately.
- Cloudflare Access default-deny protects the hostname before static HTML loads.
- Approved identities and MFA are required.
- Existing Supabase admin session/TOTP checks remain required after Access.

Current state is not final: admin HTML is still reachable on the public host and relies on frontend/backend gates.

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
