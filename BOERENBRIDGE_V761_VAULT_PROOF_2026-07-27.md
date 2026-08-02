# Boerenbridge v761 authenticated vault proof — 2026-07-27

Production project: `jas-site`  
Frontend version: `v761`  
Branch: `agent/v761-production-completion`  
Secrets policy: no admin/session tokens recorded.

## Finding and fix

Initial read-only proof found that `admin_get_boerenbridge_shared_stats_audit_v643` accepted an invalid admin token. That meant the admin shared-stats audit RPC was not actually protected.

Applied SQL-only fix:

- `GEJAST_v755g_boerenbridge_admin_audit_guard.sql`
  - Replaced `admin_get_boerenbridge_shared_stats_audit_v643(text)`.
  - Requires `admin_check_session(admin_session_token).ok === true` before returning audit data.
  - Preserves valid-admin output shape.
  - No data writes or cache rebuilds.

## Authenticated vault proof

Live page: `https://kalenel.nl/boerenbridge_vault.html`

Browser/admin facts:

- Page title: `Boerenbridge kluis`.
- Admin gate object present: `true`.
- Admin token present in browser session: `true`.
- Token recorded: `false`.
- Page status: `Kluis geladen vanuit de actuele Boerenbridge-database.`
- Current visible scope: `friends`.

DOM/read proof:

- Friends vault DOM match cards: `10`.
- Friends vault DOM ladder cards: `0` with message `Nog geen ranglijstdata.`
- Friends vault DOM insight cards: `0` with message `Nog geen analytische kaartdata.`
- Public friends data RPC: `recent_match_count=10`, `ladder_count=0`.
- Public family data RPC: `recent_match_count=11`, `ladder_count=5`.

## Admin audit proof

Valid admin audit RPC:

- RPC: `admin_get_boerenbridge_shared_stats_audit_v643`
- Result: `ok`, array count `5`.
- Checks returned:
  - `cache_table`: `ok`, `0 cached players`
  - `match_facts`: `ok`, `0 match-player facts`
  - `source_boerenbridge_matches`: `present`, `boerenbridge_matches`
  - `source_game_match_summaries`: `present`, `game_match_summaries`
  - `rpc_version`: `ok`, `v643`

Invalid admin audit RPC:

- Input: invalid placeholder token.
- Result: rejected.
- Message: `admin_session_invalid`.

## Mutation policy

No Boerenbridge rebuild/cache-refresh/write action was run. The `admin_boerenbridge_shared_stats.html` page has a `Rebuild cache` button backed by `admin_refresh_boerenbridge_shared_stats_v643`, but it was intentionally not invoked during this read-only vault proof.

## Result

Authenticated Boerenbridge vault proof passed for the read-only/admin-gated surface after applying the audit guard. The remaining Boerenbridge write/stat-cache mutation proof, if desired, requires explicit approval because it mutates cache/state.
