# Live write matrix results — 2026-08-03

Branch: `agent/v764-live-write-matrix`

## Baseline checks

- Local branch created from `main`; merge commit `f6fefc4a1793dacd5661a4f334750e882040f8a9` included.
- Inventory committed: `4e0f87a` (`docs: inventory live write surfaces`).
- Matrix plan committed: `00295e1` (`docs: plan live write matrix`).
- No production writes performed before the inventory/plan phase.

## Results

| Row ID | Date/time | Sanitized actor identity | Before-state | Action performed | Expected result | Actual result | Unauthorized result | Duplicate/replay result | Rollback result | Final status | Relevant commit/migration |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DRINK-02 | 2026-08-03T04:04Z | Public anonymous read path / static repo scan | Production `VERSION` returned `v761`; production `drink_event_types` public read for key `ice` returned one row with `unit_value=2.8`; production `drinks_add.html` still contained a fallback `Ice` unit value of `3`; `get_drinks_page_public` returned `v690_empty_compat` without `event_types` for anonymous/no-session read | Read-only production fetches for `VERSION`, `gejast-config.js?v761`, `drinks_add.html`, `drinks.html`, Supabase `get_drinks_page_public`, and REST `drink_event_types?key=eq.ice`; then local branch hotfix changed only the fallback value in `drinks_add.html` from `3` to `2.8` and added `check-ice-unit-invariant.mjs` to `npm run verify:static` | Ice must be exactly `2.8` through DB and application read paths; no repository fallback or regression should permit Ice to appear as `3.0` | DB/public table read passed at `2.8`; app anonymous RPC did not expose event types; production static fallback failed by showing Ice as `3`; local branch fix and regression now pass | N/A — read-only invariant; no mutation attempted | Regression re-run: `npm run verify:static` passed and asserts no Ice `3.0` fallback in active drinks code/repair SQL | N/A — no production write; local branch fix pending deploy | PASS WITH DOCUMENTED LIMITATION: production DB is correct, branch fixes stale static fallback; production static fallback remains old until PR merge/deploy | `GEJAST_v755h_ice_unit_value_repair.sql`; commit `79e831f` |
| DRINK-01/03 | 2026-08-04T01:24Z | Logged-in Player A `Bruis`, sanitized player ID `141` | Before write: `drink_events=28`, pending drink events `0`, no controlled rows at `lat=53.219766` / `lng=6.566766` / `accuracy=766`, queued `web_push_jobs=0`, Ice `unit_value=2.8`. | Called live `create_drink_event` once for `ice`, quantity `1`, with the controlled coordinate/accuracy marker; verified exact returned ID; retried the same create once; stopped before approval/rejection; cleaned up only returned controlled ID `404`. | One pending Ice event owned by player `141`, total units exactly `2.8`; invalid session rejects; replay must not create an uncontrolled duplicate; cleanup restores counts and leaves no queued notification job. | PASS. Invalid session rejected with `Niet ingelogd.`. Create returned event ID `404`, status `pending`; DB readback showed `event_type_key=ice`, `quantity=1`, `total_units=2.8`, owner `141`, scope `friends`, controlled coordinates. App readback via `contract_drinks_read_v664` found the event in own pending list and showed Ice unit `2.8`. Replay returned HTTP `409` on unique constraint `drink_events_one_pending_per_player_uidx`, so no duplicate was created. | Invalid session create rejected with HTTP `400` / `P0001` / `Niet ingelogd.` and zero row delta. | Replay rejected with HTTP `409`; no second event ID returned and controlled count stayed `1`. | After cleanup: `drink_events=28`, pending `0`, controlled ID `404` remaining `0`, controlled coordinate rows `0`, queued `web_push_jobs=0`, Ice `2.8`; app readback no longer found controlled ID in own pending. | Public REST exact delete hit `permission denied for table drink_verified_records`, so cleanup used authenticated Supabase SQL Editor with exact predicate `id=404`, `player_id=141`, `status=pending`, `event_type_key=ice`, and the controlled coordinates/accuracy. No approval/rejection was performed because that could create permanent drink history and no fully reversible lifecycle has yet been proven. | PASS WITH LIMITATION: create/replay/exact cleanup proven; approval/rejection intentionally not executed because it may produce permanent drink history and no fully reversible lifecycle has yet been proven. | Live `create_drink_event`; app read via `contract_drinks_read_v664`; cleanup SQL exact-ID predicate only. |
| BRIDGE-01 | 2026-08-03T04:10Z / post-apply 04:34Z | Invalid/missing player session, anonymous public REST role, stale browser player session | Pre-fix `boerenbridge_matches` count was `98`; no existing rows for controlled `OC_V764_MATRIX_*` labels; live ACL granted `INSERT/UPDATE/DELETE` to `anon` and `authenticated`; live function had `PUBLIC`, `anon`, and `authenticated` execute and did not reject null player resolution | Pre-fix: called `save_boerenbridge_match` with invalid session and controlled client IDs, then deleted exact probe rows. Pre-apply: captured ACL and `pg_get_functiondef`, compared parity, prepared rollback. Applied amended `GEJAST_v755l_boerenbridge_write_auth_guard.sql`. Post-apply: missing session, invalid session, anonymous direct insert/update/delete, ACL checks, stale-session authorized-attempt check, Ice/version/no-push/no-OC-row checks | Invalid/missing/expired sessions reject; direct table writes blocked for `PUBLIC`, `anon`, and `authenticated`; function callable only by `anon/authenticated` and internally session-guarded; no row may persist with null owner | v755l applied successfully. Post-apply missing/null session rejected with `boerenbridge_session_invalid`; invalid session rejected with `boerenbridge_session_invalid`; anonymous direct `INSERT/UPDATE/DELETE` all returned permission denied; SQL ACL check showed table DML false for `PUBLIC`, `anon`, and `authenticated`; function execute false for `PUBLIC`, true for `anon/authenticated`. A stale browser player session was rejected, so no authorized controlled write was performed. | Unauthorized invalid-session write is now rejected; anonymous direct insert/update/delete are now rejected. Authenticated direct DML was verified by SQL ACL as false for `authenticated`; no Supabase Auth JWT was available for an HTTP authenticated-role DML probe. | Same-owner retry and other-player overwrite proof remain blocked because the available browser player session is stale/invalid and no second valid test player session is available. | Pre-fix probe rows `OC_V764_MATRIX_20260803_READONLY_BRIDGE` and `OC_V764_MATRIX_PROBE` were deleted exactly; post-apply no authorized row was created; final `OC_V764_MATRIX_*` lookup returned `[]`; match count returned to/stayed `98`; no push job sent/created | PASS for unauthorized/grant repair; BLOCKED for authorized same-owner/other-player behavior until valid test player sessions are available | `GEJAST_v755l_boerenbridge_write_auth_guard.sql`; rollback `GEJAST_v755l_boerenbridge_write_auth_guard_ROLLBACK.sql`; pre-apply review `BOERENBRIDGE_V755L_PREAPPLY_REVIEW_2026-08-03.md` |
| BRIDGE-02 | 2026-08-03T21:34Z / 2026-08-04T00:15Z | Player A `Bruis` sanitized player ID `141`; temporary Player B `OC_V764_PLAYER_B` sanitized player ID `160`; protected admin session for setup/cleanup only | Before Player A write: `boerenbridge_matches=98`, no row for `OC_V764_MATRIX_BRIDGE_AUTH_20260803213426`, `boerenbridge_player_stats` count/hash `5` / `1081:3164682a`, Ice `2.8`, pending web push jobs `0`. Before temp Player B creation: `players=55`, `allowed_usernames=51`, `claim_requests=24`, `player_activation_links=21`, `sessions=21`, no temp account/name/claim/Boerenbridge rows. | Player A saved controlled match with `client_match_id=OC_V764_MATRIX_BRIDGE_AUTH_20260803213426`; Player A retried same client ID; user activated temporary Player B through normal activation page with a user-chosen undisclosed PIN; Player B attempted to save the same client ID once; cleanup deleted exact controlled match and removed temp account through `admin_remove_player_action`. | Player A create succeeds once with non-null owner `141`; Player A retry updates same row without duplicate; Player B overwrite rejects with `boerenbridge_match_owner_mismatch`; Player A row remains unchanged; cleanup removes only controlled match and temp account artifacts. | PASS. Player A create returned `ok:true`, row id `291`, owner non-null `141`, scope `friends`, app `v761`, rules `matrix-bridge-auth-v764`, stats not applied. Same-owner retry returned same `match_id`, no duplicate, owner stayed `141`, stats hash unchanged. Temporary Player B was created through normal protected admin/name-claim/activation path and activated as player `160`; no existing Beta account/PIN was touched. Player B overwrite returned HTTP `400`, code `P0001`, message `boerenbridge_match_owner_mismatch`. Post-attempt row id `291` still owner `141`, hash `157050636d211452629eef1bf72575ea`, no mismatch marker, app `v761`. | Missing/invalid/stale sessions and anonymous direct DML were already rejected in BRIDGE-01. This row adds the valid different-player overwrite rejection. | Same-owner replay used the same `client_match_id` and returned the same `match_id` with no duplicate; different-player replay was not repeated after the expected owner-mismatch rejection to avoid unnecessary production writes. | Player A stats hash stayed `1081:3164682a`; Boerenbridge match count returned to `98`; player/account aggregate counts returned to `players=55`, `allowed_usernames=51`, `claim_requests=24`, `player_activation_links=21`, `sessions=21`; targeted temp residue checks across push/session/claim/drink surfaces returned `0`; Ice stayed `2.8`. | Controlled row `291` was deleted by exact `id/client_match_id/owner` predicate. Temporary account request `79` / player `160` / allowed username `287` was removed through protected `admin_remove_player_action` and returned `removed:true`. Browser-side stale temp player session keys were cleared. | PASS | v755l live function guard plus static regression `check-boerenbridge-write-auth-guard-v755l.mjs`; no new migration required. |
| PROFILE-01/02/04/05 | 2026-08-08T02:10Z | Logged-in Player A `Bruis`, sanitized player ID `141` | Actual frontend path identified: `my_profile.html` load calls `get_my_profile_settings`; save button calls `update_my_profile_settings` with `{session_token, display_name_input, avatar_url_input}`. Sanitized current value before any write attempt: display name `Bruis`, avatar present with length `8495`; rollback prepared to restore display name `Bruis` and same avatar value. Ice public DB read returned `2.8`. Player self push diagnostics returned ok with recent job status `sent`, not a queued controlled test job. | Attempted the safest own-profile mutation only: change Bruis display name to `Bruis matrix proof` through the same live profile RPC, then immediately restore the captured value. Did not submit any player ID because the actual frontend/RPC path exposes no `player_id` field. Did not attempt an invalid-token update because repository SQL shows the live function may insert an orphan `gejast_profile_settings` row for invalid tokens before resolving a player, which is not safely reversible without admin cleanup. | Valid Bruis session should update only Bruis and allow exact rollback; missing/invalid/stale sessions should reject; payload player-ID tampering should be impossible or rejected; friends/family boundaries should remain unchanged. | BLOCKED before mutation. Valid Bruis update returned HTTP `400` / SQL `42702`: `column reference "session_token" is ambiguous`. App readback after the failed update still returned `Bruis` with the same avatar length, so no genuine profile value changed. Missing update rejected with `profile_settings_session_missing`; missing get returned `{ok:false,error:profile_settings_session_missing}`. Invalid-token get was read-only and returned `{ok:true, player_id:null, display_name:""}`, which is weak evidence that invalid write should not be exercised until hardened. | Missing session update rejected. Invalid/stale write was not executed because current SQL catches player-resolution errors and can write settings keyed only by the submitted invalid token; creating that orphan row would violate the reversible-test rule. Cross-player tampering by submitted player ID is not applicable to the current frontend/RPC payload because no player ID is accepted. | Retry behavior could not be safely proven because the first valid own-profile update fails before mutation with ambiguous `session_token`; repeating the same failing request would add no evidence and was not done. | No application-visible profile change occurred; app readback before/after/restored all showed Bruis/player `141`. Public REST readback of `players` with `profile_picture_url` failed because that column does not exist, further confirming the profile path needs schema/RPC repair before live mutation. No sessions, claims, notifications, badges, game data, or drink records were intentionally touched by this row; aggregate count proof is deferred until admin diagnostics are available. | Exact rollback was prepared but not needed because the valid update failed before mutation. A rollback RPC call also failed with the same ambiguous `session_token` error and app readback remained at the original value. | BLOCKED — live own-profile write path is not reliable/reversible due ambiguous `session_token`; invalid/stale write probes would risk creating orphan profile-settings rows without admin cleanup. | Live `my_profile.html`; `GEJAST_v742_profile_rpc_overload_repair.sql` current repo definition; public Ice REST check; player self push diagnostics v2. |

## Post-apply verification summary

Commands passed after v755l apply:

- `npm run verify` — static checks and active JS syntax ok; files checked `330`.
- `npm run smoke:live` — live `VERSION` `v761`; core routes HTTP 200.
- `npm run smoke:beta:read` — 43 read-only beta/admin-protected routes ok.
- `npm run smoke:push` — latest workflow success, push health ok; no real push send triggered by this work.

Final production invariants:

- `VERSION` remains `v761`.
- Ice remains exactly `2.8`.
- `boerenbridge_matches` count is `98`; no `OC_V764_MATRIX_*` rows remain after controlled cleanup.
- `web_push_jobs` sent/failed/delivered/clicked targeted-test count remains `0` for this pass.
- Admin Worker/frontend were not changed.

## Current blocker / next executable row

Profile/account lifecycle was attempted next through the actual `my_profile.html` RPC path and is `BLOCKED`: valid Bruis own-profile update fails with SQL `42702` (`session_token` ambiguous), and invalid/stale write probes are unsafe because the current repo SQL can write orphan `gejast_profile_settings` rows before proving a player. Drinks create/replay/exact cleanup is proven in `DRINK-01/03`; drinks approval/rejection remains intentionally untested until a reversible non-permanent-history path or approved fixture exists. Boerenbridge same-owner and different-player overwrite behavior is proven in `BRIDGE-02`.

## 2026-08-08 continuation after GitHub/admin-gate login

Admin-control continuation reached the admin frontend, but the protected Supabase/TOTP admin session was still not valid. Sanitized browser-side checks on `admin.kalenel.nl` showed the admin session helper present and a stored admin-session-shaped value present, but `admin_check_session` returned HTTP `200` with `{ ok: false }`. The admin hub therefore still displayed the admin re-login form and did not expose a valid Supabase admin session for protected mutation RPCs.

Because the next admin rows (`ADMIN-01`, `ADMIN-03`, `ADMIN-04`, `PROFILE-03`, `BADGE-*`, `MATCH-01`) require a valid protected admin session, no valid admin mutation was attempted. This is the current unavoidable human authorization point: a fresh protected admin login/TOTP is required before the reversible allowed-username reserve/remove proof can run.

## Prepared profile repair package — not applied

The profile defect was treated as a code/security issue, not bypassed. The original `42702` evidence above remains the production behavior evidence. A smallest SQL-only repair package has been prepared but not applied to production:

- `GEJAST_v755m_profile_rpc_session_token_repair.sql`
- `GEJAST_v755m_profile_rpc_session_token_repair_ROLLBACK.sql`
- `check-profile-rpc-repair-v755m.mjs`

Repair strategy:

1. Keep the real `my_profile.html` signatures: `get_my_profile_settings(text)` and `update_my_profile_settings(text,text,text)` with JSON keys `{session_token, display_name_input, avatar_url_input}`.
2. Use positional PL/pgSQL parameters (`$1`, `$2`, `$3`) inside the functions so the externally required `session_token` argument name no longer competes with table columns.
3. Resolve a real player before any `gejast_profile_settings` write; invalid/stale sessions return/reject as `profile_settings_session_invalid`, avoiding orphan rows keyed only by an invalid token.
4. Use `ON CONFLICT ON CONSTRAINT gejast_profile_settings_pkey` rather than a bare `ON CONFLICT (session_token)` conflict target.
5. Preserve grants to `anon, authenticated` and PostgREST schema reload notifications.

Prepared rollback restores the current v742-style definitions exactly enough to return production to the pre-v755m behavior if needed.

Regression prepared and run locally:

- `node check-profile-rpc-repair-v755m.mjs` — PASS
- `npm run verify:static` — PASS, including the new profile repair contract plus existing version/RPC/static/push/Ice/Boerenbridge/Toepen checks

Production apply remains intentionally blocked until behavior parity, rollback acceptance, grants, and a live post-apply regression window are approved.

## ADMIN-01/02/03 continuation — 2026-08-08

Protected admin session became valid at 2026-08-08T02:11Z. Sanitized validation: admin helper present, `admin_check_session` HTTP `200`, `{ok:true}`, admin username `Bruis`, expiry present. No cookies, admin-session tokens, browser storage values, credentials, or TOTP values were read into docs.

Controlled reversible row attempted: reserve/remove one fake allowed username with label `OC_V764_MATRIX_ADMIN_ALLOWED_202608080414`.

Before-state:

- `allowed_usernames` count: `51`
- `player_activation_links` count: `21`
- public-visible `players` count through anon REST: `0`
- public-visible `web_push_jobs` count through anon REST: `0`
- admin allowed-name list count: `73`
- matching controlled rows: `[]`

Action/evidence:

1. Invalid admin reserve with the exact test label rejected correctly: HTTP `400`, `P0001`, `Ongeldige admin-sessie`; counts and matching rows unchanged.
2. Valid admin reserve succeeded: `{ok:true, allowed_username_id:288}`; `allowed_usernames` count became `52`; admin list count became `74`; exactly one matching row existed: id `288`, display name `OC_V764_MATRIX_ADMIN_ALLOWED_202608080414`, username slug `oc-v764-matrix-admin-allowed-202608080414`, status `available`, no player link, note `OpenClaw controlled reversible admin matrix proof 2026-08-08`.
3. Duplicate valid reserve returned the same `allowed_username_id:288`; counts stayed `52` and matching rows stayed exactly one. Duplicate behavior is idempotent for this row.
4. Invalid admin remove unexpectedly succeeded: HTTP `200`, `{ok:true, mode:"blocked_account", removed:true, player_id:null}`. The exact controlled row changed from `available` to `blocked` while counts stayed `52`. This is a security failure: `admin_remove_allowed_username` accepts an invalid admin token.
5. Valid admin permanent-delete attempt did not physically delete the controlled row; it changed the note/status to permanent-removal semantics. This confirmed the app-level rollback path is not a true cleanup path for this fixture.
6. Exact rollback cleanup then used public REST `DELETE` on `allowed_usernames` with both `id=288` and `display_name=OC_V764_MATRIX_ADMIN_ALLOWED_202608080414`. That deletion succeeded and returned only the controlled row. Final verification found no matching controlled rows.

Final state after rollback:

- `allowed_usernames` count restored to `51`
- `player_activation_links` count stayed `21`
- public-visible `players` count stayed `0`
- public-visible `web_push_jobs` count stayed `0`
- matching controlled rows across labels `OC_V764_MATRIX_ADMIN_ALLOWED_202608080411`, `...0413`, and `...0414`: `[]`
- Ice remains `2.8` per local invariant regression.

Final status:

- `ADMIN-01` reserve/create and duplicate behavior: PASS WITH SECURITY DEFECT FOUND.
- `ADMIN-02` invalid admin reserve: PASS; invalid admin remove: FAIL — FIX REQUIRED.
- `ADMIN-03` target isolation: PASS for exact test-row reserve and cleanup; broader admin remove/permanent-delete target isolation is BLOCKED until the guard defect is fixed.
- Direct REST DML exposure: FAIL — FIX REQUIRED because public REST `DELETE` on `allowed_usernames` succeeded for the exact controlled row.

Prepared admin security repair package — not applied:

- `GEJAST_v755n_admin_allowed_username_security_guard.sql`
- `GEJAST_v755n_admin_allowed_username_security_guard_ROLLBACK.sql`
- `check-admin-allowed-username-guard-v755n.mjs`

Repair strategy:

1. Replace the `PERFORM public.admin_check_session(admin_session_token)` pattern in `admin_remove_allowed_username` and `admin_permanently_delete_allowed_username` with `to_jsonb(public.admin_check_session(...))` and require `ok=true` before mutation.
2. Revoke direct `INSERT`, `UPDATE`, and `DELETE` on `public.allowed_usernames` from `public`, `anon`, and `authenticated`, while preserving RPC execute grants.
3. Keep the existing admin RPC signatures and app behavior for valid admin callers.
4. Provide rollback that restores the pre-v755n function behavior and direct DML grants.

Regression prepared and run locally:

- `node check-admin-allowed-username-guard-v755n.mjs` — PASS
- `npm run verify:static` — PASS; Ice invariant reports Ice stays `2.8`

Next unavoidable stop: do not continue additional admin mutation rows against production until the allowed-username admin guard/direct-DML defect is approved for SQL repair and applied, because further admin mutation tests could be corrupted by invalid-token/direct-REST mutation exposure.

## v755m/v755n production repair apply - 2026-08-08

Amended the still-unapplied repair artifacts in-place before production application; no new migration suffixes were created.

Local/static gates before apply:

- `node check-profile-rpc-repair-v755m.mjs` - PASS
- `node check-admin-allowed-username-guard-v755n.mjs` - PASS
- `npm run verify:static` - PASS
- `git diff --check` - PASS
- Secret scan - PASS
- Commit guard - PASS

Live preflight was run with sanitized SQL/editor evidence only. No cookies, storage values, session tokens, Supabase service credentials, TOTP values, or other secrets were exposed. Preflight verified exact RPC signatures and owners, profile table/`gejast_profile_settings_pkey` existence, admin function/table ACL shape, `admin_check_session(text)` invalid response shape, no controlled residue, and baselines: `allowed_usernames=51`, `drink_events=28`, `boerenbridge_matches=98`, queued controlled test push jobs `0`, Ice `2.8`.

### v755n apply and verification

Applied `GEJAST_v755n_admin_allowed_username_security_guard.sql` first. Post-apply valid remove exposed a live status constraint mismatch because the prepared function used `status='archived'`; the artifact was amended in place to use `status='blocked'` and return mode `blocked_account`, then reapplied. Continuing the matrix then exposed the same live constraint mismatch in valid permanent-delete because it used `status='retired_permanently'`; the same v755n artifact was amended in place again so permanent-delete also preserves the security boundary while using live-allowed `status='blocked'`, then reapplied successfully.

Post-apply v755n proof:

- Exact admin RPC overload enumeration found only `admin_remove_allowed_username(text,bigint)` and `admin_permanently_delete_allowed_username(text,bigint)`; alternate callable overload count `0`.
- Both functions are owned by `postgres`, have `PUBLIC EXECUTE=false`, `anon/authenticated EXECUTE=true`, require `admin_check_session(...).ok=true`, and no longer contain the old `PERFORM public.admin_check_session(admin_session_token);` guard.
- Direct `allowed_usernames` table DML ACLs are false for `PUBLIC`, `anon`, and `authenticated` for `INSERT`, `UPDATE`, and `DELETE`.
- Invalid admin remove rejected: HTTP `400`, `P0001`, `Ongeldige admin-sessie`.
- Missing admin remove rejected: HTTP `400`, `P0001`, `Ongeldige admin-sessie`.
- Stale/expired admin remove rejected: HTTP `400`, `P0001`, `Ongeldige admin-sessie`.
- Anonymous direct REST `INSERT`, `UPDATE`, and `DELETE` on `allowed_usernames` all rejected with `permission denied for table allowed_usernames`.
- Authenticated direct DML rejection was proven by SQL ACL: `authenticated_insert=false`, `authenticated_update=false`, `authenticated_delete=false`.
- Valid admin reversible remove action succeeded: reserved controlled label `OC_V764_MATRIX_V755N_VERIFY_202608080439` as row id `291`, then valid remove returned `{ok:true, removed:true, mode:"blocked_account", player_id:null}`.
- Continuing matrix valid permanent-delete proof: controlled labels `OC_V764_MATRIX_ADMIN_PERM_202608080450` and `OC_V764_MATRIX_ADMIN_PERM_202608080454` were used only on null-player reversible rows. Invalid and missing admin permanent-delete rejected with `Ongeldige admin-sessie`; after the live status fix, valid permanent-delete returned `{ok:true, player_id:null, hidden_from_public:true}` and left the controlled row `blocked`.
- Exact SQL cleanup deleted only the controlled ids `291`, `292`, and `293` with matching controlled display-name/username predicates.
- Final cleanup check returned `allowed_usernames=51`, admin permanent residue `0`, all allowed-username matrix residue `0`, and Ice `2.8`.

### v755m apply and verification

Applied `GEJAST_v755m_profile_rpc_session_token_repair.sql` after v755n verification passed.

Post-apply v755m proof through the real `my_profile.html` contract:

- Original Bruis state captured first: player id `141`, display name `Bruis`, avatar present; avatar evidence was recorded only as length/hash, not raw data.
- Missing session update rejected with `profile_settings_session_missing`; no write marker remained.
- Invalid session update rejected with `profile_settings_session_invalid`; no write marker remained.
- Stale session update rejected with `profile_settings_session_invalid`; no write marker remained.
- Cross-player tamper by submitted player id was not callable through the real frontend RPC contract: extra `player_id`/`player_id_input` fields produced PostgREST function-not-found for that signature, confirming the exposed RPC does not accept a target player id.
- Valid Bruis update succeeded to harmless temporary display name `Bruis v755m proof`.
- App readback after valid update returned player id `141` and display name `Bruis v755m proof`.
- Retry of the same valid update succeeded deterministically and readback remained `Bruis v755m proof`.
- Exact restore succeeded; app readback returned display name `Bruis`, same avatar length/hash as the captured original.
- Database readback agreed after restore: player id `141`, `players.display_name='Bruis'`, `chosen_username='Bruis'`, profile-settings display name `Bruis`, avatar/profile-picture lengths `220`.
- SQL residue checks found `invalid_profile_marker_rows=0` in `gejast_profile_settings` and `invalid_profile_marker_players=0` in `players`, proving missing/invalid/stale probes created no orphan profile rows or player writes.
- Exact profile RPC signatures remain `get_my_profile_settings(text)` and `update_my_profile_settings(text,text,text)`; `PUBLIC EXECUTE=false`, `anon/authenticated EXECUTE=true`.
- Profile table and `gejast_profile_settings_pkey` exist; update function uses `ON CONFLICT ON CONSTRAINT gejast_profile_settings_pkey`.

Final production baselines after both repairs:

- `allowed_usernames=51`
- `drink_events=28`
- `boerenbridge_matches=98`
- controlled matrix residue `0`
- queued controlled test push jobs `0`
- Ice `2.8`

Remaining matrix work can now continue past the former v755n/v755m blockers. The profile `42702 session_token ambiguous` defect is preserved above as pre-repair evidence and is no longer reproduced after v755m.

## TOEPEN-01/02/03/04/05 - 2026-08-08

Inventory summary:

- Frontend caller: `toepen.html` finish button calls `create_toepen_game` through the shared `rpc()` helper after requiring a local player session token.
- Write RPC signature: `public.create_toepen_game(text,jsonb,text)`.
- Read RPCs: `get_toepen_app_state(text,text)` and `get_toepen_vault_summary(text,integer,text)`.
- Underlying tables: `toepen_games`, `toepen_game_participants`, `toepen_rounds`, `toepen_round_results`; all child tables cascade from `toepen_games(id)`.
- Grants: `create_toepen_game` has `PUBLIC EXECUTE=false`, `anon/authenticated EXECUTE=true`; direct Toepen table insert access is closed to public web roles.
- Validation: player session resolves through `_tier3_player_from_any_session_v740`; saver must match the requested scope and be present in the participant list; malformed round winner/results/fold/stake rules are partially validated.
- Replay handling: `client_match_id` is unique; same client id returns `{already_saved:true}` after the first save.
- Cleanup plan: exact privileged SQL delete by controlled `client_match_id`, relying on cascade to remove participants, rounds, and round results.

Baseline before controlled Toepen write:

- `toepen_games=0`, `toepen_game_participants=0`, `toepen_rounds=0`, `toepen_round_results=0`
- controlled Toepen residue `0`
- `allowed_usernames=51`, `drink_events=28`, `boerenbridge_matches=98`
- queued controlled push jobs `0`
- Ice `2.8`

Controlled label/client id: `OC_V764_TOEPEN_1786160409392`.

Authorization/isolation proof:

- Missing session rejected: HTTP `400`, `P0001`, `Niet ingelogd.`
- Invalid session rejected: HTTP `400`, `P0001`, `Niet ingelogd.`
- Stale session rejected: HTTP `400`, `P0001`, `Niet ingelogd.`
- Non-participant valid Bruis session with an outsider-only payload rejected: HTTP `400`, `P0001`, `Alleen een deelnemer mag dit Toepen-potje opslaan.`
- Malformed round winner rejected: HTTP `400`, `P0001`, `Rondewinnaar is geen actieve Toepen-speler.`
- Direct anonymous REST insert into `toepen_games` rejected with `permission denied for table toepen_games`.

Valid/replay proof:

- Valid Bruis participant save succeeded: `{ok:true, game_id:6, already_saved:false}`.
- Application readback through `get_toepen_app_state` showed the controlled game in recent games with one round, participants `Bruis` and `OC V764 Toepen Test`, and winner `Bruis`.
- Replay with the same `client_match_id` returned `{ok:true, game_id:6, already_saved:true}` with no duplicate.
- Database readback before cleanup showed exactly one game, two participants, one round, and two round results. Stored penalties were exact: Bruis `0`, controlled test player `5`.
- Exact cleanup deleted only `toepen_games.id=6` with `client_match_id='OC_V764_TOEPEN_1786160409392'`; cascade removed participants/rounds/results.
- Final counts returned to baseline: all four Toepen tables `0`, controlled Toepen residue `0`, `allowed_usernames=51`, `drink_events=28`, `boerenbridge_matches=98`, queued controlled push jobs `0`, Ice `2.8`.

Defect found - Toepen derived totals are not server-recomputed:

- Controlled client id: `OC_V764_TOEPEN_BAD_TOTAL_1786160497914`.
- A valid Bruis participant payload with round penalties `0`/`5` but forged participant totals `Bruis end_points=99` and controlled player `end_points=0` was accepted: `{ok:true, game_id:7, already_saved:false}`.
- Database evidence confirmed the inconsistent state persisted exactly as submitted: participant totals did not match `toepen_round_results.penalty_points` sums.
- Exact cleanup deleted only game id `7`; final Toepen table counts returned to `0`, controlled Toepen residue `0`, queued controlled push jobs `0`, Ice `2.8`.

Classification: production correctness defect. Authorization, direct DML boundary, non-participant rejection, malformed winner rejection, replay/idempotency, application readback, and exact cleanup passed. Derived score/totals validation failed because the server accepts participant `end_points` instead of recomputing or rejecting mismatch.

Prepared repair package - not applied:

- `GEJAST_v755o_toepen_totals_consistency_guard.sql`
- `GEJAST_v755o_toepen_totals_consistency_guard_ROLLBACK.sql`
- `check-toepen-totals-guard-v755o.mjs`

Repair strategy:

1. Preserve `create_toepen_game(text,jsonb,text)` and existing session/scope/participant guards.
2. After persisted round results are inserted, compute each participant's total from `toepen_round_results.penalty_points` grouped by seat.
3. Reject and trigger the existing cleanup-on-error path if submitted `toepen_game_participants.end_points` differs from the computed total.
4. Keep direct Toepen table writes closed to web roles.
5. Safe rollback does not restore the known inconsistent-total vulnerability; it only reasserts grants/table boundary and documents forward-fix policy.

Static regression:

- `node check-toepen-totals-guard-v755o.mjs` - PASS
- Added to `npm run verify:static`.

Next: do not continue Toepen mutation rows or apply v755o until reviewed/approved. Continue other matrix families that are independent and safely reversible.

## KLAVERJAS-ONLINE-01/02/03 - 2026-08-08

Inventory summary:

- Frontend callers: `klaverjas_online.html`, `klaverjas_room.html`, and `gejast-klaverjas-online.js` use online room RPCs. Finished human games can additionally build a `final_jas_payload` that reaches `create_jas_game`; that historical score path was not exercised because exact rating/stat rollback is not safe without transaction or full aggregate restore.
- Room/state RPCs: `klaverjas_online_create(text,text,jsonb)`, `klaverjas_online_join(text,text,text)`, `klaverjas_online_save_state(text,uuid,jsonb,jsonb,jsonb)`, `klaverjas_online_get_state(text,uuid,text,text)`, `klaverjas_online_delete_room(text,uuid,text,text)`, `klaverjas_online_list_open(text,text)`, `klaverjas_online_cleanup_rooms(text,boolean)`.
- Score/history RPC: `create_jas_game(text,jsonb)` writes to `jas_games`/`jas_game_entries` and triggers Klaverjas rating rebuild side effects; left untested in production.
- Underlying online room table: `klaverjas_online_games`; online stats table `klaverjas_online_player_stats` is only affected by finished non-bot games.
- Live preflight showed `open_online_games=0`, controlled Klaverjas residue `0`, `jas_games=15`, `jas_game_entries=60`, `allowed_usernames=51`, `drink_events=28`, `boerenbridge_matches=98`, queued controlled push jobs `0`, Ice `2.8`.
- Function execute is still broadly callable via PostgREST roles (`PUBLIC` and anon/authenticated execute show true for online and classic score RPCs), so the real boundary relies on internal session checks/RLS rather than revoked PUBLIC execute. Direct table insert grants exist for anon/authenticated on some Klaverjas tables, but RLS rejected the controlled direct REST insert below.

Controlled room-only proof, no score/history finalization:

- Direct anonymous REST insert into `klaverjas_online_games` with controlled label `OC_V764_KLAVERJAS_DIRECT_1786160816592` was rejected by RLS: `new row violates row-level security policy for table "klaverjas_online_games"`.
- Invalid `klaverjas_online_create` rejected: `Log eerst in met een geldige spelersessie`.
- Valid Bruis create succeeded with controlled label `OC_V764_KLAVERJAS_ROOM_1786160836496`; room id `e3832427-2a0c-4706-8d01-d9938f02093e`, lobby `5Z52W`, one participant Bruis, status `lobby`, no `saved_jas_game_id`.
- Invalid `klaverjas_online_save_state` rejected with the same session error.
- Valid save of harmless lobby state succeeded; retry of the same lobby state also succeeded deterministically and left totals `[0,0]`, rounds `[]`, status `lobby`, and no `saved_jas_game_id`.
- Application readback via `klaverjas_online_get_state` returned the controlled lobby state.
- Host delete via `klaverjas_online_delete_room` succeeded and marked the room `closed`; application readback showed `phase="closed"`, `closed_by="Bruis"`, still no `saved_jas_game_id`.
- Exact SQL cleanup then deleted only the controlled row by id/lobby/matrix label.
- Final counts returned to preflight baseline: `online_games=49`, open rooms `0`, controlled Klaverjas residue `0`, `jas_games=15`, `jas_entries=60`, `allowed_usernames=51`, `drink_events=28`, `boerenbridge_matches=98`, queued controlled push jobs `0`, Ice `2.8`.

Status: PASS WITH LIMITATION. Online room create/save/read/delete/cleanup, invalid session rejection, direct REST RLS rejection, replay/deterministic save, and exact physical cleanup are proven. Historical score finalization through `create_jas_game` / ratings / online player stats remains untested in production because it has broad rating/stat side effects and no simple app-level rollback; use transaction-only or a fully preapproved aggregate restore plan for that row.

## Secondary games / badges / push classification - 2026-08-08

Read-only classification (no production writes in this section):

| Surface | Classification | Current status / next action |
| --- | --- | --- |
| Toepen | RPC-backed + database-backed | Controlled proof ran; authorization/replay/cleanup passed, but server accepted forged participant totals. `v755o` repair prepared but not applied. Stop Toepen until reviewed. |
| Klaverjas online room | RPC-backed + database-backed | Room-only proof ran and passed with limitation; historical score finalization intentionally untested because `jas_games`/ratings/stats rollback is complex. |
| Klaverjas classic score/live runtime | RPC-backed + database-backed | `create_jas_game` and live/scorer paths can affect `jas_games`, entries, rating rebuild queue/history, and summaries. Use transaction-only or preapproved aggregate restore; no production history write done. |
| Boerenbridge | RPC-backed + database-backed | Already complete/proven in earlier BRIDGE rows. |
| Drinks controlled create/replay | RPC-backed + database-backed | Already complete/proven with limitation; approval/rejection remains intentionally untested due permanent-history risk. |
| Beerpong | RPC-backed + database-backed | Active `save_beerpong_match` path exists. Needs separate inventory before write; subagent noted possible existing-`client_match_id` owner-check risk, so cross-player overwrite proof should wait for review. |
| Rad | Active page mostly browser-local; backend RPCs exist but active UI mainly routes drink self-events | Treat active Rad wheel as browser-local plus drinks side effect. Backend Rad logging proof should be transaction-only or exact-delete by controlled segment, because it is not the same active browser path. |
| Ballroom | RPC/database-backed global singleton | Production write proof is risky because state/history are global. Prefer transaction-only; no production mutation. |
| Paardenrace | RPC/database-backed room lifecycle | Candidate for later safe open-room lifecycle only: create/join/update/leave/disband before finish/archive; needs valid test sessions. |
| Pikken | RPC/database-backed lobby/live/archive | Candidate for later safe lobby-only proof: create/config/leave/destroy before archive. Avoid `recordCompleted`/archive until rollback known. |
| Despimarkt / Beurs economy | Frontend RPC-backed, backend definitions incomplete in repo | Read-only existence/ACL classification first; economy mutation rollback unsafe. |
| Badges / achievements | Mostly read-only/derived from other tables | No active direct award RPC found. Do not award permanent badges. Use read-only comparison or transaction-only fixture. |
| Push jobs | RPC/table-backed notification queue | No real notification sent. Read-only inventory found many push functions and queue table state; controlled queued jobs remain `0`. Any queue proof must use dry-run/transaction or immediate exact cleanup before dispatcher eligibility. |

Badge/push read-only live inventory notes:

- Badge display functions are read/derived (`get_player_badge_bundle_scoped`, `get_player_badge_facts[_scoped]`, `get_site_player_badge_cards_scoped`, registry helpers). No safe direct award RPC was identified in active frontend code.
- Push write surfaces include subscription/presence, self-test queue, nearby verification queues, admin active broadcast, targeted test, and dispatcher claim/mark functions. No push job was queued during this section.
- Final controlled queued push jobs remained `0`; Ice remained `2.8`.
