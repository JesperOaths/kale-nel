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
- Applied follow-up SQL-only fixes `GEJAST_v755d_toepen_creator_scope_guard.sql`, `GEJAST_v755e_admin_reset_login_player_pin_compat.sql`, and `GEJAST_v755f_login_session_bridge.sql` after live proof found missing wrong-player/scope enforcement, a missing admin reset compatibility function, and a login-session recognition mismatch.
- Verified invalid player/admin denial, direct Toepen table access denial, indexes, tightened grants, wrong-player rejection, cross-scope rejection, canonical `login_player` sessions, idempotent duplicate-save behavior, history/vault/stat output, and cleanup.
- Added `check-toepen-backend-contract.mjs` to the static verification gate; `npm run verify` passed.
- Added workplan, recovery, RPC, admin inventory, security, and public/admin deployment docs.

## Not complete yet

- Toepen exit gate is complete. Evidence: `TOEPEN_V761_LIVE_PROOF_2026-07-27.md`.
- Boerenbridge authenticated vault proof.
- Admin DNS/Cloudflare Access perimeter.
- Real-device backend push proof.
- Controlled live-write matrix.
- Full final regression.

Do not mark production complete until all gates pass or are explicitly blocked by one concrete external action.
