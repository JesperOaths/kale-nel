# Boerenbridge v755l pre-apply review — 2026-08-03

Branch: `agent/v764-live-write-matrix`  
Production frontend invariant: `v761`  
Ice invariant: `drink_event_types.key='ice'` remains `2.8`.

## Live ACL snapshot

Captured through authenticated Supabase SQL Editor on production `jas-site` before applying v755l. No keys, tokens, player data, or match payloads recorded.

### Tables

`boerenbridge_matches`:

- `relacl`: `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`
- `PUBLIC` direct `INSERT/UPDATE/DELETE`: false / false / false
- `anon` direct `INSERT/UPDATE/DELETE`: true / true / true
- `authenticated` direct `INSERT/UPDATE/DELETE`: true / true / true

`boerenbridge_player_stats`:

- `relacl`: `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`
- `PUBLIC` direct `INSERT/UPDATE/DELETE`: false / false / false
- `anon` direct `INSERT/UPDATE/DELETE`: true / true / true
- `authenticated` direct `INSERT/UPDATE/DELETE`: true / true / true

`boerenbridge_match_rounds`:

- `to_regclass('public.boerenbridge_match_rounds')` was absent from the live table ACL query result. v755l keeps a conditional explicit revoke for this historical companion table so the migration remains transaction-safe if the table exists in a later schema.

### Function EXECUTE grants

`save_boerenbridge_match(text,text,text,text,jsonb)` live ACL:

- `proacl`: `{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`
- `PUBLIC` execute: true
- `anon` execute: true
- `authenticated` execute: true
- security definer: true
- search path: `public`

### Role that authorized the public REST delete

The successful direct REST delete was sent with the public browser publishable key and no user JWT/session. That path maps to the `anon` database role. The ACL snapshot confirms `anon_DELETE=true` on `boerenbridge_matches`, which explains the successful public delete.

## Live function behavior before replacement

`pg_get_functiondef` showed the live function is already the simplified v740/v741-era implementation:

- resolves `p := public._tier3_player_from_any_session_v740(session_token)` but does **not** reject when `p.id` is null;
- inserts a new row into `boerenbridge_matches` by `client_match_id`;
- stores `match_name` from payload;
- sets `match_status='finished'`;
- stores `rules_version` and `app_version`;
- sets `created_by_player_id = p.id`;
- sets `started_at` and `finished_at` from payload with `now()` fallback;
- stores the full payload;
- on existing `client_match_id`, updates payload/status/finished_at/updated_at;
- returns `{ ok, match_id, client_match_id, stats_applied:false }`.

No live behavior was found for round-table persistence, score/stat calculation, audit/history insertion, or player-stat updates in the active function. The richer historical implementations exist in older SQL files, but the active production function definition no longer contains that behavior.

## Parity decision

The amended v755l migration preserves the active live behavior above and adds only the required hardening:

- missing/invalid/expired sessions reject because `_tier3_player_from_any_session_v740` must resolve to non-null `p.id`;
- new rows persist `created_by_player_id = p.id` and assert it before success;
- repeated save by the same owner preserves the current idempotent update shape;
- update by another player rejects with `boerenbridge_match_owner_mismatch`;
- no success path can return if persisted owner is null or not the authenticated player;
- direct table `INSERT/UPDATE/DELETE` is revoked from `PUBLIC`, `anon`, and `authenticated` where the target tables exist;
- function `EXECUTE` is revoked from `PUBLIC` and granted explicitly only to `anon, authenticated`, with internal player-session validation.

## Rollback

Rollback prepared at `GEJAST_v755l_boerenbridge_write_auth_guard_ROLLBACK.sql` using the exact prior `pg_get_functiondef` body.

Safety rule: rollback does **not** restore insecure direct table-write grants to `PUBLIC`, `anon`, or `authenticated`; those grants are the confirmed vulnerability and should stay removed even if the RPC body is reverted.

## Stop-condition review

- Behavior parity: proven against the live `pg_get_functiondef`; no unaccounted live behavior found.
- Rollback: prepared with exact prior function definition.
- Genuine matches: v755l changes grants/function only; it does not update/delete existing match rows.
- Transaction: migration is wrapped in `begin`/`commit`.
- Frontend/admin invariants: no frontend version change, no Ice change, no admin Worker change.
