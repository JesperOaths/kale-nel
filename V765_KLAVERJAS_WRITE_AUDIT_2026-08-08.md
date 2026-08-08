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
- PUBLIC, `anon`, and `authenticated` had EXECUTE on both deployed target RPCs.
- Direct INSERT/UPDATE/DELETE grants existed for `anon` and `authenticated` on `jas_games`, `jas_game_entries`, `game_rating_rebuild_queue`, `klaverjas_online_games`, and `klaverjas_online_player_stats`.
- RLS was **disabled** on `jas_games`, `jas_game_entries`, and `game_rating_rebuild_queue`.
- Entry triggers: `trg_apply_klaverjas_elo` and `trg_apply_klaverjas_elo_scoped`.
- Baseline: `jas_games=15`, `jas_game_entries=60`, `game_rating_rebuild_queue=87`, `klaverjas_online_games=49`, `klaverjas_online_player_stats=4`; discovered Klaverjas rating/history tables were all `0` in this snapshot.
- Controlled `OC_V765` residue `0`; controlled push rows `0`; Ice `2.8`.

## Exact deployed-definition capture — 2026-08-08

`LIVE_CAPTURE_V765_KLAVERJAS_DEPLOYED_DEFINITIONS.sql` was run read-only in production.

### `klaverjas_upsert_match_state_scoped(...)`

The exact body materially strengthens the security finding:

- the function accepts `session_token text`, but **never validates, resolves, or otherwise uses it**;
- it is `SECURITY DEFINER`;
- if `match_id_input` is null, it directly inserts a `klaverjas_matches` row;
- if `match_id_input` is non-null, it performs `INSERT ... ON CONFLICT(id) DO UPDATE`, so caller-supplied numeric IDs can replace existing match state;
- no creator/owner comparison is performed before that update;
- it deletes and rewrites all matching `klaverjas_rounds` and `klaverjas_match_snapshots` child rows;
- it therefore cannot safely remain web-callable in its current form.

The current runtime can generate UUID `client_match_id` values, but this RPC accepts only `match_id_input bigint`; the runtime fallback can therefore fail before the RPC body for UUID-backed scorer saves.

### `create_jas_game(text,jsonb)`

The exact classic function is materially different from the legacy upsert:

- it resolves the caller via `_jas_session_player(session_token)` before persistence;
- it validates a 4-player/teams payload and registered player names;
- it creates `jas_games` + four `jas_game_entries` rows;
- entry inserts fire both deployed Klaverjas ELO triggers;
- it additionally enqueues `_enqueue_rating_rebuild('klaverjas', ...)` and calls `process_game_rating_rebuild_queue(10)`;
- it has no explicit client-match idempotency/ownership contract in the function body.

Therefore simply replacing the current fallback with `create_jas_game` would change persistence/rating behavior and would still not provide safe same-client replay ownership.

### v755q status

The earlier ACL-only `GEJAST_v755q_klaverjas_write_boundary_guard.sql` is now deliberately **SUPERSEDED / DO NOT APPLY STANDALONE**. Once the unsafe fallback body was captured, it became clear that revoking direct table DML while retaining web-role EXECUTE on that function would leave a write bypass. The file now intentionally aborts and its regression asserts that safety stop.

## Required combined repair shape

The replacement v765 repair must be atomic and must not rely on frontend-only validation. It must:

1. install a current `save_klaverjas_match_v687` contract that accepts text/UUID client IDs and validates a real player session before any write;
2. provide deterministic same-owner replay and reject cross-player reuse of the same client ID;
3. harden or remove web-role execution of the unsafe legacy upsert path;
4. revoke direct INSERT/UPDATE/DELETE from web roles on all affected persistence/queue tables while preserving required SELECT access;
5. preserve the intended current scoring/persistence/rating behavior rather than arbitrarily switching between the legacy and classic models;
6. be transaction-only proven before any persistent finished-game test.

## Final schema/read-contract capture still required

`LIVE_CAPTURE_V765_KLAVERJAS_LEGACY_SCHEMA.sql` captures the remaining exact information needed to implement the combined repair without guessing:

- `klaverjas_matches`, `klaverjas_rounds`, and `klaverjas_match_snapshots` columns/constraints/indexes/RLS/direct grants;
- `_jas_session_player` and `_klaverjas_safe_scope` definitions;
- deployed v687 runtime bundle/leaderboard read functions, if present;
- legacy public live-match read function;
- legacy row counts, controlled push residue and Ice invariant.

## Existing v764 evidence to preserve

- Reversible Klaverjas online-room create/save/read/delete/cleanup already passed.
- Invalid online-room sessions reject.
- Direct anonymous REST insert to `klaverjas_online_games` was rejected by RLS.
- Finished score/history was deliberately not written in production because rating/stat rollback was not proven safe.

## Safety rule

No irreversible finished-game production write is needed to diagnose the current bug. After the combined repair is prepared, behavioral proof must run inside an explicit transaction and roll back all match/round/snapshot/game/entry/rating/queue/stat effects atomically.
