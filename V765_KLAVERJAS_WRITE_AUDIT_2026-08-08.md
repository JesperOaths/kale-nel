# v765 Klaverjas write-path audit — 2026-08-08

Branch: `agent/v765-klaverjas-write-hardening`
Mode: narrow security/correctness follow-up after v764. No finished production Klaverjas game has been written by v765.

## Current frontend path

The current root `score.html` redirects to `klaverjas_scorer_v596_repo_ready.html`.

That scorer uses `GEJAST_KLAVERJAS_RUNTIME.saveMatch(...)` rather than calling a database RPC directly.

Current `gejast-klaverjas-runtime.js` behavior:

1. Normalize the 2v2 player list, final scores, roem, notes and a generated UUID `client_match_id`.
2. Primary save RPC: `save_klaverjas_match_v687` with both session-token keys, `client_match_id_input`, `match_payload`, and `site_scope_input`.
3. Compatibility fallback only when the primary RPC is missing: `klaverjas_upsert_match_state_scoped(..., status='finished')`.
4. The legacy fallback signature uses `match_id_input bigint`, while the current runtime can carry a generated UUID client ID. This is a correctness mismatch that must be resolved from the exact deployed definition rather than guessed around.

Important correction to the v764 inventory: `create_jas_game(text,jsonb)` remains a deployed historical/classic persistence/rating surface, but it is not the direct primary call in the current scorer runtime.

## Production preflight result — 2026-08-08

`LIVE_PREFLIGHT_V765_KLAVERJAS_WRITE_SURFACE.sql` was run read-only in production.

Confirmed:

- `save_klaverjas_match_v687`: **not deployed**.
- `finish_klaverjas_live_match_v687`: **not deployed**.
- `start_klaverjas_live_match_v687`: **not deployed**.
- `klaverjas_upsert_match_state_scoped(...)`: deployed, `SECURITY DEFINER`.
- `create_jas_game(text,jsonb)`: deployed, `SECURITY DEFINER`.
- Production therefore does **not** have the current v687 primary save RPC and necessarily relies on compatibility behavior when the scorer attempts a finished save.
- `create_jas_game` references session/owner, `jas_games`, entries, ratings and rebuild behavior.
- `klaverjas_upsert_match_state_scoped` references a session but the coarse fingerprint did not find an owner marker, `client_match_id`, classic `jas_games`, entries, rating or rebuild references.
- PUBLIC, `anon`, and `authenticated` all had EXECUTE on both deployed target RPCs.
- Direct INSERT/UPDATE/DELETE grants existed for `anon` and `authenticated` on:
  - `jas_games`
  - `jas_game_entries`
  - `game_rating_rebuild_queue`
  - `klaverjas_online_games`
  - `klaverjas_online_player_stats`
- RLS was **disabled** on `jas_games`, `jas_game_entries`, and `game_rating_rebuild_queue`.
- RLS was enabled on the two online tables.
- Entry triggers: `trg_apply_klaverjas_elo` and `trg_apply_klaverjas_elo_scoped`.
- Baseline: `jas_games=15`, `jas_game_entries=60`, `game_rating_rebuild_queue=87`, `klaverjas_online_games=49`, `klaverjas_online_player_stats=4`; discovered Klaverjas rating/history tables were all `0` in this snapshot.
- Controlled `OC_V765` residue `0`.
- Controlled `OC_V765` push rows `0`.
- Ice remains `2.8`.

## Defects / risks now separated

### A. Direct-write authorization boundary — confirmed defect

Web roles have direct table mutation grants. On the classic persistence/queue tables this is especially serious because RLS is disabled. The active frontend is RPC-backed, so these broad direct DML grants are not needed for the normal scorer contract.

Prepared narrow repair:

- `GEJAST_v755q_klaverjas_write_boundary_guard.sql`
- `GEJAST_v755q_klaverjas_write_boundary_guard_ROLLBACK.sql`
- `check-klaverjas-write-boundary-v755q.mjs`
- `LIVE_POSTAPPLY_V755Q_VERIFY.sql`

v755q is ACL-only:

- revoke INSERT/UPDATE/DELETE from PUBLIC/anon/authenticated on the five inventoried Klaverjas write tables;
- revoke PUBLIC EXECUTE on the two deployed save RPCs;
- retain guarded RPC EXECUTE for `anon` and `authenticated`;
- do **not** alter function bodies, RLS, scoring, ratings, triggers, payloads or frontend behavior.

### B. Current scorer save-contract mismatch — confirmed architecture gap, repair pending exact definition

The current runtime prefers `save_klaverjas_match_v687`, but production does not have that function. Its compatibility fallback targets `klaverjas_upsert_match_state_scoped(... match_id_input bigint ...)` while current scorer IDs are UUID-capable/generated UUIDs.

Do not patch this by simply discarding the UUID or switching blindly to `create_jas_game`: either choice could weaken idempotency or change ratings/history behavior.

`LIVE_CAPTURE_V765_KLAVERJAS_DEPLOYED_DEFINITIONS.sql` captures the exact deployed definitions, columns, constraints and trigger definitions required to design the narrow correctness fix without guessing.

## Existing v764 evidence to preserve

- Reversible Klaverjas online-room create/save/read/delete/cleanup already passed.
- Invalid online-room sessions reject.
- Direct anonymous REST insert to `klaverjas_online_games` was rejected by RLS.
- Finished score/history was deliberately not written in production because rating/stat rollback was not proven safe.

## Safety rule

No irreversible finished-game production write is needed to diagnose the current bug. After the deployed definitions are captured and any repair is prepared, the behavioral proof should be transaction-only so all game/entry/rating/queue/stat side effects roll back atomically.
