# RPC contracts — Kalenel production completion

Updated: 2026-07-26.

## Toepen backend lane

The Toepen backend is intentionally separate from Klaverjas persistence. It must not write to `jas_games`, `jas_game_entries`, or call `create_jas_game`.

### Tables

- `public.toepen_games`
  - `client_match_id text not null unique` is the idempotency key.
  - `site_scope` is constrained to `friends` or `family`.
  - Stores creator, played timestamp, target points, ruleset, raw payload, winners, and status.
- `public.toepen_game_participants`
  - One row per seat/player.
  - `unique(game_id, seat_no)` and `toepen_participants_game_name_uidx` prevent duplicate seats/names per game.
- `public.toepen_rounds`
  - One row per round with dealer, winner, stake, tags, raw round, and `unique(game_id, round_no)`.
- `public.toepen_round_results`
  - One row per active player result per round with action/penalty/fold data and `unique(round_id, seat_no)`.

All four tables have RLS enabled and direct table grants revoked from `anon, authenticated`. Access is through SECURITY DEFINER RPCs only.

### `create_toepen_game(session_token text, game_payload jsonb, site_scope_input text default 'friends') returns jsonb`

Purpose: player-authenticated Toepen save.

Auth/session:

- Resolves player via `public._tier3_player_from_any_session_v740(session_token)`.
- Throws if no player is resolved.

Validation:

- Payload must be an object.
- `game_type` must be `toepen`.
- `client_match_id` is required.
- Participants: 2–8, valid seat numbers, non-empty unique names.
- Rounds: at least one.
- Stake: 1–10.
- Round winner must be active for the round.
- Each round must contain exactly all active players.
- Only the winner may have `action='win'`.
- Fold requires `stake_final > 1` and `1 <= folded_at_stake < stake_final`.
- Penalties must match engine semantics: winner 0, stay = final stake, fold = folded stake.

Response:

```json
{ "ok": true, "game_id": 123, "already_saved": false }
```

Duplicate `client_match_id` response:

```json
{ "ok": true, "game_id": 123, "already_saved": true }
```

### `get_toepen_app_state(session_token text default null, site_scope_input text default 'friends') returns jsonb`

Purpose: scorer-side recent-game read.

Response fields:

- `ok`
- `my_name`
- `recent_games`
- `all_names` currently empty array

If a player session resolves, recent games are filtered to games containing that player name. If no session resolves, current SQL returns recent finished games for the requested scope; this is public read behaviour and should be revisited if Toepen history is considered private.

### `_v755_admin_session_ok(admin_session_token text) returns boolean`

Internal helper. It calls existing `admin_check_session(text)` when available and otherwise falls back to `admin_sessions` token-column detection. Execute is revoked from public.

### `get_toepen_vault_summary(admin_session_token text, limit_count integer default 100, site_scope_input text default 'friends') returns jsonb`

Purpose: admin-authenticated Toepen vault/analytics.

Auth:

- Requires `_v755_admin_session_ok(admin_session_token)`.

Response fields:

- `ok`
- `site_scope`
- `recent_games`
- `player_stats`

Limit is clamped to 1–500.

## Post-apply verification required

- Tables exist.
- RLS enabled.
- Direct table access revoked from `anon, authenticated`.
- Function signatures are in PostgREST schema cache.
- Grants match the SQL.
- Invalid player token rejects write.
- Invalid admin token rejects vault.
- Duplicate `client_match_id` returns `already_saved:true`.
- Friends/family scope remains isolated.
