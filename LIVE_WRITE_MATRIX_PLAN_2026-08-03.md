# Live write matrix plan — 2026-08-03

Branch: `agent/v764-live-write-matrix`  
Baseline commit: `f6fefc4a1793dacd5661a4f334750e882040f8a9` included.  
Inventory: `LIVE_WRITE_SURFACE_INVENTORY_2026-08-03.md`.

## Fast matrix mode - 2026-08-08

The remainder of `agent/v764-live-write-matrix` runs in FAST MATRIX MODE. The goal is to finish the same security/correctness audit with fewer repeated login, temporary-account, verification and documentation cycles, without weakening safety.

Persistent roles:

- `MATRIX-A`: Bruis, kept logged in when already valid.
- `MATRIX-B`: one reusable temporary non-admin player, `OC_V764_MATRIX_PLAYER_B`, created only after protected admin login is available and kept until all remaining cross-player matrix testing is complete.
- `MATRIX-ADMIN`: approved protected admin session in a separate browser context.

Role/session rules:

- Never overwrite one role's browser storage with another role.
- Before asking for a new login, verify whether the required role already has a valid session.
- Never request, display, store, document or log the Player B PIN, admin cookies, TOTP, player/admin session tokens, browser storage values, or other secrets.
- Human interruption should be limited to genuinely expired admin login, the one Player B PIN/login, approval of consequential production SQL, or irreversible production actions.

Fast execution rules:

- Paardenrace is closed for now as `PASS WITH LIMITATION`; do not repeat the Player A lifecycle merely to add Player B coverage.
- Batch remaining read-only inventories into one concise status table before further live writes.
- Use risk-based proof: full two-player production lifecycle proof is reserved for meaningful uncertainty around ownership, participant authorization, cross-player mutation, direct table bypass, replay/idempotency, or privilege escalation.
- Do not weaken proof for Beerpong, Toepen, admin/security boundaries, account/profile boundaries, suspicious RPCs, public table DML, or existing-client-id overwrite risks.
- Use `scripts/matrix-harness.mjs` for reusable sanitized snapshots and reviewed exact-cleanup SQL templates; do not embed privileged credentials in local tooling.
- Reduce verification repetition: targeted regression plus `git diff --check`/encoding for documentation-only work; domain regression plus residue/baseline verification after reversible live proof; full relevant static/security verification after SQL/security/code changes; complete suite before PR.
- Reduce commit noise: roughly one coherent commit per domain or repair package from this point forward.

Production repair authorization:

- Continue automatically through reversible tests.
- Prepare fixes automatically when a defect is found.
- Stop for explicit production authorization when a migration changes existing rows, changes schema structure, deletes/transforms persisted data, changes scoring/business logic, has uncertain behavior parity, or cannot be safely forward-fixed.
- For pure security-boundary repairs that only strengthen validation/grants while preserving signatures and intended successful behavior, prepare migration, static regression and live-definition comparison together, then present one authorization point.

End-state cleanup:

- Keep `OC_V764_MATRIX_PLAYER_B` until the remaining matrix is complete.
- At the end, remove the temporary player through the protected account-removal flow, remove sessions/claims/activation artifacts, verify game/drink/push/badge residue `0`, and verify all controlled `OC_V764_*` residue `0`.

## Global test protocol

Every row uses the same proof sequence:

1. Preconditions: confirm branch, clean tree except active docs/harness, production frontend `v761`, Ice `2.8`, no leftover test record with the stable label, known sanitized actor, prepared rollback.
2. Sanitized before-state: record counts, IDs, numeric totals, statuses and derived totals without secrets/private payloads.
3. Authorized action: one production write through the same browser/API/RPC path used by the feature; no direct SQL substitute.
4. Immediate verification: exact affected row(s), field values, derived totals, no unrelated row changes, and browser/API readback.
5. Unauthorized action: anonymous, invalid session, wrong player/scope or normal player against admin RPC as appropriate.
6. Replay/duplicate test: retry same request or same idempotency key; prove reject/existing-result/single-row update, never accidental duplicate.
7. Rollback: remove/restore only the test record; verify totals and queues return to before-state.
8. Final status: `PASS`, `PASS WITH DOCUMENTED LIMITATION`, `FAIL — FIX REQUIRED`, `BLOCKED — HUMAN APPROVAL REQUIRED`, or `NOT APPLICABLE`.

## Test labels and cleanup

- All test-created records use prefix `OC_V764_MATRIX_20260803_` where schema permits (`client_match_id`, title, note, payload marker, room name/code label, location label).
- Rollback queries/scripts must target the exact created ID plus the prefix; never broad date/user cleanup.
- Any queued notification job produced by a write must be cancelled/deleted before dispatcher eligibility unless explicitly approved.
- Audit rows may be retained only if immutable and documented as sanitized evidence; otherwise use test markers and remove safely.

## Matrix rows

| ID | Area | Authorized actor | Test action | Before-state | Exact expected mutation | Unauthorized test | Duplicate/idempotency test | Derived-data checks | Rollback | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DRINK-01 | Drinks create event | Logged-in test player in current scope | Create one `Ice` drink event through `drinks_add.html`/`create_drink_event` with quantity 1 and test label/location if accepted | Count `drink_events` for test player/type; player totals; Ice type value; pending queue count; web push job count | Exactly one `drink_events` row owned by test player, correct type, unit value `2.8`, expected timestamp/scope/location fields; no second player rows | Anonymous/no session and invalid session call to same RPC reject safely | Repeat same browser/RPC request once; determine whether duplicate protection exists; if none, mark fail/defect and roll back both controlled rows | `get_drinks_page_public`, homepage drinks top5/summary, player total change exactly `+2.8`; no unrelated player total changes | Cancel/delete exact test event and any verification/job rows; totals return exactly | PASS - see results `DRINK-01/03`; approval/rejection not included |
| DRINK-02 | Ice invariant | Read-only public/app path plus DB verification | Verify Ice type/unit through production DB read and application read path; do not write | Ice type row and read-path output | No mutation; value exactly `2.8`, not `3.0` | N/A read-only; verify no public write RPC can change type metadata | Run current static regression; add coverage if missing | Drinks read totals calculate Ice at `2.8` | N/A | Planned |
| DRINK-03 | Drinks duplicate prevention | Logged-in test player | Controlled retry of a uniquely labelled test drink event or identical contract write payload | Test prefix count zero; totals baseline | At most one event for the idempotency key/label if supported; otherwise controlled duplicate is evidence of missing protection | Invalid session duplicate attempt rejects | Repeat exact payload/request once | Totals increase at most once; duplicate state explicitly documented | Remove exact controlled event(s), restore totals | PASS - same pending unique constraint rejected replay; see `DRINK-01/03` |
| DRINK-04 | Drinks pending verification | Two authorized test players or test player + authorized reviewer | Create pending event requiring verification; approve/reject through public verifier path | Pending queue count, verifier eligibility, jobs count, totals | One pending row/event, one final decision, status transition exact, totals update once, optional job created with correct target only | Wrong player/anonymous cannot decide; invalid session rejected | Second approve/reject attempt rejected or no-op without double totals | Pending queue empties; drink total changes exactly once; notification job count/target correct | Remove exact test event/verifications/jobs; totals restored | BLOCKED - stopped before approval/rejection because current path can create permanent drink history |
| DRINK-05 | Drinks correction/removal | Admin or authorized owner, depending current feature | Correct/cancel/remove only the controlled test drink event | Exact event row and totals | Only selected event status/fields change; audit preserved | Unauthorized correction/delete fails | Repeat correction/delete cannot double-apply | Totals recalc exact; no unrelated history changes | Restore/delete exact controlled event; verify audit consistency | Planned; may require admin auth |
| ADMIN-01 | Admin valid inner session | Approved GitHub account + Supabase/TOTP admin session | One safe test admin mutation, preferably reserve then remove a clearly fake allowed username | Admin session state; allowed username test-prefix absent; audit count | Exactly one test row created/changed; admin audit row includes sanitized actor/action | N/A here; covered by ADMIN-02 | Repeat same reserve/action handles duplicate safely | Public request/login lists reflect expected test state only | Remove exact test allowed username and verify absence | Planned; blocked until admin login/TOTP |
| ADMIN-02 | Admin invalid sessions | Anonymous/normal player/invalid admin token | Call each tested admin RPC with missing, invalid, expired and normal-player token | No test target mutation | All reject with safe auth error and zero rows changed | This is the row | Replay invalid attempts remain rejected | Audit should not log successful admin action | N/A | Planned |
| ADMIN-03 | Admin target isolation | Valid admin session | Admin action against one test record with adjacent decoy test record present | Two test records baseline | Only target record changes; decoy unchanged | Wrong/missing admin token cannot target either | Repeat action cannot alter decoy or other rows | Public sanitized lists only expected changes | Roll back target and decoy | Planned |
| ADMIN-04 | Admin replay/duplicate handling | Valid admin session | Repeat approve/reject/activate/replace on same controlled request | Controlled request pending state | First changes one row; second rejects/no-ops with already-decided state | Invalid token repeat rejects | Same as action repeat | Audit/state shows one final decision | Revert/delete controlled request if safe | Planned |
| ADMIN-05 | Protected data access | Public anon/normal player/admin | Probe sensitive vault/admin read RPCs/routes | Route/RPC access baseline | Public roles cannot read vault/admin sensitive data; admin can read sanitized necessary data | Public/normal player read attempts rejected | Repeated probes remain denied | Required public sanitized data still loads | N/A | Planned |
| PROFILE-01 | Own profile update | Logged-in test player | Update harmless reversible profile field, preferably avatar/profile setting or display nickname with test suffix | Exact old field values and profile settings row | One own row/settings object changed once; no player identity ownership change | Anonymous/invalid session rejects | Repeat same value no-ops or updates same row only | `my_profile.html`/public profile read shows change | Restore exact old value(s) | Planned |
| PROFILE-02 | Cross-player protection | Logged-in test player A vs player B | Attempt to update player B via profile RPC/payload manipulation if possible | Player B exact old values | Zero rows changed for B; safe rejection | This is the unauthorized test | Repeat remains rejected | Public profile B unchanged | N/A | Planned; requires two test identities or safe fixture |
| PROFILE-03 | Claimable-name flow | Public requester + admin if needed | Create/claim a test name, verify duplicate/stolen-name rejection | Test name absent; owned real names untouched | Test claim/request only; duplicate fails; already-owned name cannot be stolen | Anonymous/invalid activation fails where applicable | Reusing same token/request cannot activate twice | Login/name lists reflect only test row | Remove/return test name and delete test player if created | Planned; likely admin-gated |
| PROFILE-04 | Session lifecycle | Test player | Prove invalid/stale/cleared session cannot mutate; fresh login can | Session tokens sanitized; row counts | Invalid/stale cleared session zero writes; fresh session permits controlled safe write | This row includes invalid/stale | Repeat stale attempt remains rejected | No session leaks into public state | Roll back safe write | Planned; human login may be required |
| PROFILE-05 | Scope isolation | Test players in friends/family or scoped fixtures | Attempt cross-scope mutation/read via manipulated `site_scope_input` | Scope-specific counts/rows | Own-scope write succeeds; cross-scope mutation fails | Wrong scope token rejected | Repeat wrong-scope rejected | Public scoped lists unchanged across boundary | Roll back own-scope test record | Planned; blocked if no family-scope fixture |
| BADGE-01 | Legitimate badge award | Backend/admin or condition-driven safe test fixture | Trigger one intended badge award for test player only | Badge definitions and ownership count for test player | Exactly one badge ownership/event for intended badge/player | Direct anonymous/player self-award rejected | Re-run condition does not add duplicate | Profile badge count/readback exact | Remove test badge relation if safe; otherwise transaction/fixture only | Planned; may be blocked by immutability |
| BADGE-02 | Duplicate badge protection | Same as BADGE-01 | Repeat award condition | Ownership count after first award | No second relation/effect | Direct unauthorized duplicate rejected | This row is duplicate test | Profile badge count unchanged | Same as BADGE-01 | Planned |
| BADGE-03 | Unauthorized direct award | Anonymous/normal player | Attempt direct award RPC/table path if exposed | Badge ownership baseline | Zero rows changed; safe error | This row | Repeat rejected | Public badge display unchanged | N/A | Planned |
| BADGE-04 | Badge rollback | Admin/service test cleanup only | Remove only controlled test badge relation or prove immutable limitation | Controlled badge relation ID | Exact test relation removed; genuine achievements unchanged | Unauthorized delete rejected if path exists | Repeat delete safe no-op | Profile readback restored | Cleanup verification | Planned; may become PASS WITH LIMITATION |
| TOE-01 | Toepen save lifecycle | Logged-in test player | Save one minimal valid Toepen game with `client_match_id=OC_V764_MATRIX_...` through `toepen.html`/`create_toepen_game` | Toepen game/participant/round/result counts for client ID; player stats/read state | One game, participants, rounds, results; creator/scope exact | Invalid/non-participant session rejected; malformed payload rejected | Repeat same `client_match_id` returns `already_saved:true` and no duplicate | `get_toepen_app_state` and vault summary reflect controlled game only | Delete exact Toepen game cascade or approved cleanup; counts return | Planned |
| BRIDGE-01 | Boerenbridge save/vault | Logged-in test player | Save minimal controlled Boerenbridge match through `boerenbridge.html`/`save_boerenbridge_match` | Match/round/stat/rating counts for client ID/player | One match/round set, correct creator, exact scores/calculations | Unauth and different player cannot overwrite same client ID | Repeat client ID updates same row or idempotent, no duplicate | Public/vault/read stats exact; direct public table mutation blocked | Delete exact match/round/stat deltas or restore from before-state | PASS - see results `BRIDGE-01`/`BRIDGE-02`; no new migration required after v755l |
| KLAVER-01 | Klaverjas online/score write | Logged-in participant(s) | Create isolated online room and/or one reversible test score save only if cleanup is exact | Open-room and score counts; no active real room touched | Participant can create/save allowed state; outsider rejected; invalid team/player refs rejected | Outsider/invalid session/team tests reject | Duplicate room/result handled safely | Open room list/stats/totals exact; no historical result altered | Close/delete test room; if score saved, delete exact game/entries and rebuild/restore ratings | Planned; score portion blocked unless rollback proven |
| NOTIFY-01 | Write-triggered notification jobs | Test write that queues jobs but does not dispatch | Queue/job counts; active subscriptions sanitized counts only | Correct job kind/target for controlled request; no unrelated targets | Unauthorized caller cannot queue for others | Duplicate queue call dedupes or creates one eligible job only | Dispatcher eligibility correct; transport not run | Cancel/delete exact unsent job and attempts; verify no eligible test job remains | Planned; no real send without approval |
| BEER-01 | Beerpong secondary game | Logged-in test player | Save controlled match via `beerpong.html`/`save_beerpong_match` | Match/rating counts for client ID/players | One match and exact rating/history deltas | Invalid/nonparticipant rejected if enforced | Repeat client ID no duplicate | Public leaderboard/vault deltas exact | Delete exact match and restore ratings/history/rebuild | Planned; requires rollback prep |
| RAD-01 | Rad secondary game | Logged-in test player | Log controlled spin/target nomination via `rad.html` RPCs | Spin/target counts for test label/player | One event row with correct scope/player | Invalid/cross-scope rejected | Repeat behavior documented; no accidental duplicate if keyed | Rad stats exact | Delete exact test events if cleanup safe | Planned |
| PAARD-01 | Paardenrace secondary game | Logged-in test player(s) | Create controlled room, join/update wager/ready, then close/reset before finish | Open room counts; no matching test code | Host-only room/player state mutations exact; no archive/stats finish | Missing/invalid session create rejected; cross-player coverage deferred until reusable Player B exists | Repeated host choice/update deterministic; Player B replay not yet run | Open room/state exact; no history/obligations/push jobs; Ice unchanged | Host disband then exact guarded SQL cleanup; final counts returned to baseline | PASS WITH LIMITATION — host/session/replay/lifecycle/cleanup proven; second-player cross-host authorization deferred |
| PIKKEN-01 | Pikken secondary game | Logged-in test player(s) | Create controlled lobby, update config, join/leave/cleanup before final archive | Open lobby counts; no matching test code | Lobby/player state exact | Outsider/wrong session rejected for host/player actions | Repeated join/config no duplicate players/lobbies | Live lobby list exact; no archive stats | Close/cleanup exact lobby | Planned |
| DESPI-01 | Despimarkt/Beurs secondary game | Logged-in test player or admin depending feature | Classify active write path first, then execute one reversible isolated market/order/wallet action if possible | Market/wallet/order counts and balances for test actor | One scoped test mutation only; exact balance/order delta | Wrong user/scope rejected | Replay does not double-spend/double-create | Market stats/balances exact | Reverse exact market/order or mark blocked if economy rollback unsafe | Planned; likely blocked pending safe fixture |
| MATCH-01 | Match control/corrections | Valid admin or owning player | Apply correction to a controlled test match only | Controlled match + adjacent decoy baseline | Only target match payload/status changes; audit/change log preserved | Public/non-owner/admin-invalid rejected | Repeat correction cannot duplicate history/rebuild | Ratings/rebuild queue exact | Restore original payload or delete controlled match | Planned; after test match rows exist |

## Initial execution order

1. Read-only baseline: branch/HEAD, live version, Ice read path, no eligible leftover test notifications.
2. Auth/session availability check using browser/API without exposing tokens.
3. Clearly reversible isolated rows: `PROFILE-01`, `DRINK-01/03` only after rollback path is confirmed, `TOE-01` only if exact cascade cleanup is confirmed.
4. Admin-gated rows after one human login/TOTP action: `ADMIN-*`, `PROFILE-03`, `BADGE-*`, `MATCH-01`.
5. Secondary game rows after each rollback script is prepared and dry-reviewed.

## Stop conditions before execution

Stop and ask for exactly one human action if:

- A player login, admin login, password, or TOTP is required.
- A row has no exact rollback query/script.
- A test would alter real user history, account ownership, achievements, or send a real push.
- Production schema differs from repository assumptions in a way that could make rollback unsafe.
