# TEST REPORT — Kalenel v761 production completion

Started: 2026-07-26 Europe/Amsterdam.
Branch: `agent/v761-production-completion`.

## Preflight

Passed / confirmed:

- Local branch created from evidence state: `agent/v761-production-completion`.
- Rollback tag created: `pre-v761-production-completion-20260726` -> `82476d8ae87fa9b41cd7a53e6aab42a3a32baaa2`.
- Local `VERSION`: `v761`.
- `origin/main`: `82476d8ae87fa9b41cd7a53e6aab42a3a32baaa2`.
- Live representative hash checks still match the established v761 proof.
- `admin.kalenel.nl`: unresolved.
- Production Toepen RPC checks:
  - `get_toepen_app_state`: 404 function not found.
  - `get_toepen_vault_summary`: 404 function not found.
  - `create_toepen_game`: 404 function not found.
  - Result: Toepen backend migration remains unapplied; no write occurred.

## Toepen backend

Status: partially complete; live controlled save proof blocked on valid beta player sessions.

Completed:

- Contract review completed for `toepen.html`, `toepen_vault.html`, `GEJAST_v755_toepen_backend.sql`, `gejast-toepen-engine.js`, and Toepen checks.
- `GEJAST_v755_toepen_backend.sql` applied through Supabase SQL Editor to production `jas-site`.
- `GEJAST_v755b_toepen_admin_session_guard.sql` applied after proof that invalid admin tokens were initially accepted by the helper because production `admin_check_session` returns `{ ok:false }` rather than throwing.
- `GEJAST_v755c_toepen_grant_hardening.sql` applied to remove default `PUBLIC` execute and restrict helper execution.
- PostgREST schema cache now exposes `get_toepen_app_state`, `get_toepen_vault_summary`, and `create_toepen_game`.
- Invalid player save rejects with `Niet ingelogd.`.
- Invalid admin vault request rejects with `Geen geldige adminsessie.`.
- Direct REST table reads for all four Toepen tables reject with `permission denied`.
- Supabase SQL grant proof showed `_v755_admin_session_ok` only executable by `postgres` and `service_role`; public Toepen RPCs executable by `anon/authenticated`.
- Supabase SQL index proof showed idempotency key `toepen_games_client_match_id_key` and duplicate-name guard `toepen_participants_game_name_uidx`.
- Local `npm run verify` passed after adding `check-toepen-backend-contract.mjs` to the static gate.

Still pending:

- Friends/family controlled live save proof using valid beta player sessions.
- Duplicate-save proof with a real valid session.
- Vault display proof with a valid admin session.
- Controlled test cleanup evidence.

## Boerenbridge authenticated vault

Status: pending.

## Admin perimeter

Status: pending.

Known starting blocker: `admin.kalenel.nl` does not resolve.

## Real-device push

Status: pending.

Known starting blocker: needs a valid logged-in player subscription and real permissioned browser/device.

## Controlled live-write matrix

Status: pending.

## Regression

Status: pending.
