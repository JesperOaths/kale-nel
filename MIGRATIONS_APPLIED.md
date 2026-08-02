# Migrations Applied

## Production observed/applied before this branch
- v756 SQL-only homepage-ladder compatibility hotfix reported applied before this continuation. It repaired homepage ladder public functions failing on 
.rating when production rows expose elo_rating.

## Applied 2026-07-26
- `GEJAST_v757_paardenrace_session_name_compat.sql` — applied through Supabase SQL Editor to production `jas-site`. Repairs `_gejast_name_for_session(text)` so canonical player sessions fall through to `get_jas_app_state` when earlier state RPCs return null names.
- `GEJAST_v757b_paardenrace_player_id_compat.sql` — applied through Supabase SQL Editor to production `jas-site`. Repairs `_paardenrace_player_id(text,text)` to prefer canonical v746 player sessions and fall back safely.
- Proof immediately after apply: `account_login_v687` Beta1 returned canonical session; `create_paardenrace_room_fast_v687` succeeded for `DESPINOZA 11`; cleanup via `disband_paardenrace_room_fast_v687` succeeded.

## Applied 2026-07-26 — v761 production completion
- `GEJAST_v755_toepen_backend.sql` — applied through Supabase SQL Editor to production `jas-site` on branch `main`. Additive Toepen-only backend lane: `toepen_games`, `toepen_game_participants`, `toepen_rounds`, `toepen_round_results`, plus `create_toepen_game`, `get_toepen_app_state`, `_v755_admin_session_ok`, and `get_toepen_vault_summary`. Post-apply proof: PostgREST schema cache exposes Toepen RPCs; invalid player save rejects with `Niet ingelogd.`; direct REST table reads for all four Toepen tables reject with `permission denied`; indexes include `toepen_games_client_match_id_key` and `toepen_participants_game_name_uidx`.
- `GEJAST_v755b_toepen_admin_session_guard.sql` — applied through Supabase SQL Editor to production `jas-site`. Forward-fix for admin helper: production `admin_check_session('invalid')` returns `{ ok:false }`, so `_v755_admin_session_ok` now requires `ok === true`. Post-fix proof: invalid `get_toepen_vault_summary` rejects with `Geen geldige adminsessie.`.
- `GEJAST_v755c_toepen_grant_hardening.sql` — applied through Supabase SQL Editor to production `jas-site`. Removed default `PUBLIC` execute grants from Toepen functions and revoked `_v755_admin_session_ok` from `anon/authenticated`; kept `create_toepen_game`, `get_toepen_app_state`, and `get_toepen_vault_summary` executable by `anon/authenticated`. Grant proof showed `_v755_admin_session_ok` only executable by `postgres` and `service_role`, while public Toepen RPCs are executable by `anon`, `authenticated`, `postgres`, and `service_role`.
- `GEJAST_v755d_toepen_creator_scope_guard.sql` — applied through Supabase SQL Editor to production `jas-site`. Narrow save-side Toepen hardening: `create_toepen_game` now requires the saving player's session scope to match `site_scope_input` and requires the saving player to be one of the game participants. Live negative proof: wrong-player save rejected with `Alleen een deelnemer mag dit Toepen-potje opslaan.` and friends-token/family-scope save rejected with `Verkeerde Toepen-scope voor deze speler.`
- `GEJAST_v755e_admin_reset_login_player_pin_compat.sql` — applied through Supabase SQL Editor to production `jas-site`. Restored missing `admin_reset_login_player_pin_v678(text,text,text,text)` compatibility target required by live v679/v680/v681 admin reset wrappers. Used to create temporary v761 Toepen beta accounts with generated one-time PINs retained only in memory.
- `GEJAST_v755f_login_session_bridge.sql` — applied through Supabase SQL Editor to production `jas-site`. Updated `_gejast_player_from_session(text)` to recognise canonical `login_player` sessions stored in `public.sessions.session_token_hash`, preserving existing fallbacks. This allowed Toepen's `_tier3_player_from_any_session_v740` to accept normal `login_player` sessions.
- `GEJAST_v755g_boerenbridge_admin_audit_guard.sql` — applied through Supabase SQL Editor to production `jas-site`. Replaced `admin_get_boerenbridge_shared_stats_audit_v643(text)` so it requires `admin_check_session(...).ok === true` before returning audit data. Live proof after the fix: valid admin audit returned five checks; invalid placeholder token rejected with `admin_session_invalid`; no cache rebuild/write action was run. See `BOERENBRIDGE_V761_VAULT_PROOF_2026-07-27.md`.

## Candidate migrations not yet applied in this session
- None currently staged for Toepen backend apply. Toepen live-save, idempotency, vault, invalid-token, wrong-player, cross-scope, and cleanup proof passed on 2026-07-27; see `TOEPEN_V761_LIVE_PROOF_2026-07-27.md`.

## Rule
SQL remains separate from frontend code. Record every future apply with timestamp, actor/tool, statements/file, function signatures, grants/RLS proof, PostgREST reload proof, controlled IDs, cleanup evidence, and rollback notes.
