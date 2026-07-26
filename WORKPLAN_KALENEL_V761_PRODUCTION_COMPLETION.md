# WORKPLAN — Kalenel v761 production completion

Started: 2026-07-26 Europe/Amsterdam.
Branch: `agent/v761-production-completion`.
Rollback tag: `pre-v761-production-completion-20260726` -> `82476d8ae87fa9b41cd7a53e6aab42a3a32baaa2`.

## Starting state

- Current proven production frontend: `v761`.
- Current proven production SHA: `82476d8ae87fa9b41cd7a53e6aab42a3a32baaa2` on `main`.
- Live representative hashes rechecked before work and still match the previous v761 proof for `/VERSION`, `/index.html`, `/toepen.html`, `/boerenbridge_vault.html`, `/gejast-config.js?v761`, `/admin-session-sync.js?v761`, and `/admin-gate-v105.js?v761`.
- `admin.kalenel.nl` still does not resolve.
- Toepen frontend is live, but production PostgREST returns 404 for `create_toepen_game`, `get_toepen_app_state`, and `get_toepen_vault_summary`; `GEJAST_v755_toepen_backend.sql` is not applied.

## Order of work

1. Safe preflight and preservation.
2. Toepen backend review, backups, migration apply, and live proof.
3. Boerenbridge authenticated vault proof.
4. Admin subdomain / Cloudflare Access security perimeter.
5. Real-device backend push proof.
6. Controlled live-write matrix.
7. Full regression.
8. Documentation and final release gate.

## Safety rules

- Do not redesign the site.
- Do not change v761 frontend files unless a proven defect requires the next monotonic frontend version.
- Keep Toepen separate from Klaverjas tables/RPCs.
- Preserve production data; controlled test data only.
- Keep Ice exactly 2.8.
- Keep friends/family data isolated.
- Do not expose secrets or service-role keys.
- Do not claim success from HTTP 200 alone.
- Do not force-push main.

## Current blockers anticipated

- Production SQL apply requires a valid Supabase SQL Editor/session or equivalent credentialed path.
- Cloudflare Access/DNS configuration requires Cloudflare account access.
- Real-device push requires a permissioned, logged-in subscribed player device.
- Authenticated admin vault proof requires a valid admin session.

## Progress log

- Preflight: branch/tag created, live v761 facts rechecked, Toepen production RPCs confirmed absent by 404 responses with no writes.
- Toepen SQL apply: `GEJAST_v755_toepen_backend.sql`, `GEJAST_v755b_toepen_admin_session_guard.sql`, and `GEJAST_v755c_toepen_grant_hardening.sql` applied through Supabase SQL Editor. Invalid admin/player tokens deny correctly; direct table reads deny; grants/indexes verified. Controlled live save proof is blocked until valid beta player sessions are available.
