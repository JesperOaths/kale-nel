# Handoff — Kalenel v761 production completion

Status: in progress.

Current branch: `agent/v761-production-completion`.
Known-good production baseline: `v761` / `82476d8ae87fa9b41cd7a53e6aab42a3a32baaa2`.
Rollback tag: `pre-v761-production-completion-20260726`.

## Completed so far

- Reconfirmed live v761 representative hashes.
- Confirmed Toepen backend RPCs are absent in production schema cache.
- Created preservation branch and rollback tag.
- Reviewed Toepen and admin contracts.
- Hardened the pending Toepen SQL candidate with stronger server-side validation before production apply.
- Applied `GEJAST_v755_toepen_backend.sql`, `GEJAST_v755b_toepen_admin_session_guard.sql`, and `GEJAST_v755c_toepen_grant_hardening.sql` to production `jas-site` through Supabase SQL Editor.
- Verified invalid player/admin denial, direct Toepen table access denial, indexes, and tightened grants.
- Added `check-toepen-backend-contract.mjs` to the static verification gate; `npm run verify` passed.
- Added workplan, recovery, RPC, admin inventory, security, and public/admin deployment docs.

## Not complete yet

- Toepen controlled live proof and cleanup with valid beta player sessions.
- Boerenbridge authenticated vault proof.
- Admin DNS/Cloudflare Access perimeter.
- Real-device backend push proof.
- Controlled live-write matrix.
- Full final regression.

Do not mark production complete until all gates pass or are explicitly blocked by one concrete external action.
