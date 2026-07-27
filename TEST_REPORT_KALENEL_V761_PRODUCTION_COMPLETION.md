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

Status: complete for Toepen exit gate.

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
- `GEJAST_v755d_toepen_creator_scope_guard.sql` applied after review found Toepen needed explicit wrong-player and save-side cross-scope rejection.
- `GEJAST_v755e_admin_reset_login_player_pin_compat.sql` applied after live admin reset wrappers were found to delegate to missing `admin_reset_login_player_pin_v678`.
- `GEJAST_v755f_login_session_bridge.sql` applied after `login_player` canonical sessions were found to use `public.sessions.session_token_hash` while `_gejast_player_from_session` did not read that table.
- Temporary players were created through authenticated admin reset, then logged in through normal `login_player`; PINs/tokens were not recorded.
- Friends controlled game saved as `game_id=1`, `client_match_id=v761-toepen-friends-202607270115-w2i5h8`; retry returned `already_saved=true` with same game ID.
- Family controlled game saved as `game_id=2`, `client_match_id=v761-toepen-family-202607270115-zspece`; retry returned `already_saved=true` with same game ID.
- Both controlled games included a toep/fold round and a finishing round.
- History and authenticated admin vault showed both controlled games in the correct scope.
- Vault stats showed winner/loser rows with expected games won, folds, stay losses, and rounds won.
- Invalid token rejected with `Niet ingelogd.`.
- Wrong-player save rejected with `Alleen een deelnemer mag dit Toepen-potje opslaan.`.
- Cross-scope save rejected with `Verkeerde Toepen-scope voor deze speler.`.
- Cross-scope reads returned zero controlled games.
- Cleanup deleted the two controlled Toepen games, deleted temp public sessions, and deactivated/cleared temp player IDs `151–158`.
- Post-cleanup evidence: controlled Toepen games remaining `0`, controlled participants remaining `0`, temp sessions remaining `0`, temp players still active/approved/with PIN/session material `0`.
- Local `npm run verify` passed after adding `check-toepen-backend-contract.mjs` to the static gate.

Evidence:

- `TOEPEN_V761_LIVE_PROOF_2026-07-27.md`

Still pending outside Toepen:

- Authenticated Boerenbridge vault proof.
- Admin subdomain / Cloudflare Access perimeter.
- Real-device backend push proof.
- Remaining controlled live-write matrix.

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
