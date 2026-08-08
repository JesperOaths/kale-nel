# Live write matrix fast inventory - 2026-08-08

Branch: `agent/v764-live-write-matrix`
Mode: FAST MATRIX MODE

Purpose: batch the remaining unresolved production write surfaces before further live writes, using existing live evidence plus read-only/static inspection. No production mutation was run for this inventory.

## Current role/session state

| Role | Intended identity | State | Next action |
| --- | --- | --- | --- |
| MATRIX-A | Bruis | Valid enough for the completed host-only Paardenrace/Pikken proof paths. | Keep alive; verify before use. |
| MATRIX-B | `OC_V764_MATRIX_PLAYER_B` | Not created yet. Protected admin runtime currently required fresh admin login. | Create once after admin login; keep until final cleanup. |
| MATRIX-ADMIN | Approved admin session | Expired/missing on protected admin runtime (`session_required`). | Ask only when admin-gated work is next required. |

## Batched unresolved-surface classification

| Surface | Mutation RPC / path | Session guard | Ownership guard | Direct-table DML boundary | Idempotency | Reversible cleanup | Risk | Required live proof | Classification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Paardenrace lobby | `create_paardenrace_room_fast_v687`, `join_paardenrace_room_fast_v687`, `update_paardenrace_room_choice_safe`, `verify_paardenrace_wager_safe`, `set_paardenrace_ready_safe`, `leave_paardenrace_room_fast_v687`, `disband_paardenrace_room_fast_v687` | Proven for missing/invalid create; deployed helpers derive identity from session. | Host-only lifecycle proven; cross-player/host denial deferred. | No direct DML issue observed in completed proof. | Host choice retry deterministic; join replay not rerun with B. | Proven: host disband then exact room cleanup; final counts restored. | Low for host-only lobby; high if advanced to history/obligation paths. | Only smallest Player B cross-player probes later if still worth it. | PASS WITH LIMITATION |
| Pikken lobby | `pikken_create_lobby_fast_v722`/lobby fast path, config, ready/unready, destroy | Missing/invalid session rejected in completed proof. | Host-only destroy/config proven; second player unavailable. | No direct DML issue found in completed lobby proof. | Replay join kept membership `1`; config retry deterministic. | Proven exact cleanup. | Low for lobby-only; start/bid/vote/archive out of scope. | Only Player B cross-player probes later if still valuable. | PASS WITH LIMITATION |
| Toepen save | `create_toepen_game(text,jsonb,text)` | v755o proof: missing/invalid/stale/non-participant rejected. | Saver must be participant; inconsistent submitted totals now reject server-side. | Direct table access remains closed to public web roles. | Valid replay deterministic for controlled id. | Proven exact game cascade cleanup; final table counts and controlled residue `0`. | Low after v755o; revisit only if implementation changes. | No repeat proof required. | PASS |
| Klaverjas online room | `klaverjas_online_create/join/save_state/delete_room` | Invalid create/save rejected; participant room path proven. | Room-only host/participant paths partly proven. | Direct REST insert rejected by RLS. | Room save/retry/delete proven. | Room cleanup proven. | Room-only acceptable; full score/history path risky. | No repeat room proof needed; score/history only with transaction or approved aggregate restore. | PASS WITH LIMITATION |
| Klaverjas score/history | `create_jas_game(text,jsonb)`, `klaverjas_upsert_match_state_scoped(...)` | `create_jas_game` and scoped upsert need repair/transaction review. | `klaverjas_upsert_match_state_scoped` accepts `session_token` but appears not to validate it. | Score persistence touches historical/aggregate/rating surfaces. | No safe client-match idempotency proven. | Unsafe without exact aggregate/rating restore. | High: history/rating/aggregate side effects and candidate auth defect. | Do not live-write until repair or transaction-only proof. | REPAIR FIRST |
| Beerpong | `save_beerpong_match(text,text,jsonb)` | Live source uses `_tier3_player_from_any_session_v740(session_token)`, but missing/invalid token handling was fragile in the overriding definition. | No proven owner/session guard before existing `client_match_id` update. | Defensive DML revokes prepared; live direct-DML proof deferred until authorization/proof phase. | Existing client id overwrite risk unresolved until v755p. | Exact match cleanup plus canonical rating rebuild required. | High: owner overwrite, payload drift, rating/schema parity, direct-DML boundary. | v755p repair package prepared only; requires review/authorization before any production write. | REPAIR FIRST |
| Drinks create/replay | `create_drink_event`, pending unique constraint path | Valid/invalid session proof completed. | Own pending create only; approval/rejection intentionally untested. | Completed proof restored counts; direct bypass not current blocker. | Replay rejected by unique pending constraint. | Exact controlled cleanup proven. | Low for create/replay; approval/rejection can create permanent history. | No repeat create proof. Approval/rejection only if safe rollback approved. | PASS WITH LIMITATION |
| Boerenbridge | `save_boerenbridge_match` | v755l guard applied and proven for invalid/missing/stale sessions. | Owner mismatch rejected. | Public direct DML rejected in proof. | Same-owner retry works; other-owner overwrite rejected. | Exact controlled cleanup proven. | Low after v755l. | No repeat proof required. | PASS |
| Profile/account own-profile | `get_my_profile_settings`, `update_my_profile_settings` | v755m applied; invalid/missing/stale rejected. | Own profile update/retry/restore proven. | Direct public mutation not the active path. | Retry deterministic. | Restore proven; no orphan markers. | Low after v755m. | No repeat proof required unless Player B created. | PASS |
| Admin allowed username | v755n admin allowed-username functions | v755n requires `admin_check_session(...).ok=true`. | Admin-only path hardened. | Direct `allowed_usernames` DML revoked from PUBLIC/anon/authenticated. | Remove/permanent-delete status boundary preserved. | Controlled admin/profile residue zero after cleanup. | Low after v755n; admin session currently expired. | No new live proof until admin-gated work needed. | PASS |
| Badges | Derived badge display functions; no safe direct award RPC identified. | Read/display only in current safe scope. | Direct award not identified as safe path. | Direct award/delete should not be attempted live. | Duplicate award not safely testable without permanent achievement risk. | Badge cleanup may be immutable or admin-only. | Medium if direct award exists; otherwise display-only. | No live write needed unless a safe transaction/fixture path is identified. | NO LIVE WRITE NEEDED |
| Push | `web_push_jobs`, dispatcher/targeted test/admin push paths | Admin-targeted queue guard statically/live-proven earlier; dispatcher secrets unavailable. | Targeting proof limited; no real send approved. | SQL hardening/static checks pass; no new push job queued. | Queue/delivery click not fully proven. | Exact queued controlled jobs can be deleted; no real notification should be sent. | Medium: delivery/click proof blocked by dispatcher env/secrets and no real notification approval. | Queue-only proof if needed; no real send. | PASS WITH LIMITATION |
| Rad | Active public page appears local/read-focused; no active production write RPC found in targeted static grep. | Not applicable until write path identified. | Not applicable. | Not applicable. | Not applicable. | Not applicable. | Low/currently out of active production write scope. | No live write unless an active mutation path is confirmed. | NO LIVE WRITE NEEDED |
| Despimarkt / Beurs | Active admin probe found `admin_get_despimarkt_auto_market_audit_v646`; public pages need separate expansion if scope grows. | Admin-read path only in current targeted grep. | Economy/order ownership not currently proven. | Economy tables are sensitive if mutation scope expands. | Unknown for orders/wallet. | Economy rollback likely unsafe without exact fixture/ledger reverse. | Medium/high if expanded; otherwise out of current matrix. | Read-only/admin-read inventory only unless explicitly selected. | OUT OF SCOPE / LOCAL ONLY |
| Match control/corrections | `save_match_control_edit(text,text,jsonb,boolean,text,text)` / `_match_control_apply_edit_v262` | Admin/owner semantics need controlled target match. | Target/decoy proof requires existing controlled match. | Could affect ratings/rebuild. | Replay/correction history not fully classified. | Cleanup depends on controlled match source domain. | Medium/high; should follow repair/proof of the target domain. | Only after controlled match fixture exists. | PASSABLE LATER |

## Beerpong v755p prepared-only repair package - 2026-08-08

Status: PREPARED ONLY / NOT APPLIED.

Files prepared:

- `GEJAST_v755p_beerpong_save_auth_guard.sql`
- `GEJAST_v755p_beerpong_save_auth_guard_ROLLBACK.sql`
- `check-beerpong-save-auth-guard-v755p.mjs`

Static correction after inventory: the first local draft used the older `player_id/rating` rating shape. Repo inspection confirmed the current Beerpong rating schema is player-name based (`beerpong_player_ratings.player_name`, `elo_rating`, `games_played`, and `beerpong_player_rating_history`). The v755p package was corrected before commit to use current-schema match columns and `rebuild_beerpong_ratings()` rather than older player-id rating updates.

Prepared v755p repair intent:

- Preserve `save_beerpong_match(text,text,jsonb)` signature.
- Reject missing/invalid player sessions with `Niet ingelogd.`.
- Reject null/different creator on existing `client_match_id` with `beerpong_match_owner_mismatch`.
- Normalize frontend `format` and backend `match_format`.
- Normalize cups aliases: `cups_left_team_a/b` and `team_a/b_cups_left`.
- Write current schema fields: `team_a_player_names`, `team_b_player_names`, `winner_team`, `team_a_cups_left`, `team_b_cups_left`.
- Revoke direct `insert/update/delete` on Beerpong match/rating/history tables from `PUBLIC`, `anon`, and `authenticated`, while preserving RPC execute for web roles.
- Preserve current deployed save-time rating behavior: no `rebuild_beerpong_ratings()`, no rating/history mutation, and `ratings_applied=false`.
- Provide a forward-fix rollback that also keeps the session/owner/DML hardening and rating behavior disabled.

Because this is a production authorization/security migration, it remains an application/proof gate even though rating behavior is intentionally unchanged.

## Fast-mode next actions

1. Do not repeat Paardenrace/Pikken host-only proofs.
2. Keep Beerpong as the next high-value repair-first surface.
3. Review/authorize v755p Beerpong before production application or live Beerpong write proof.
4. Toepen v755o is applied/proven; no repeat Toepen proof unless implementation changes.
5. Ask for admin login only when ready to create the one reusable `OC_V764_MATRIX_PLAYER_B` or to authorize/apply consequential SQL.
6. At final matrix completion, remove `OC_V764_MATRIX_PLAYER_B` and verify all controlled `OC_V764_*` residue zero.
