# Live write matrix final proof draft - 2026-08-03 / 2026-08-08

Branch: `agent/v764-live-write-matrix`

Draft PR: `#5` (`v764 live-write matrix security hardening`).

Status: FINAL-PROOF DRAFT. Repository-side review, prepared migration hardening, and draft-PR CI are complete. The remaining blocker is production application/proof of the already reviewed `v755o` and `v755p` SQL repairs. This file does not claim those two repairs are applied yet.

## Safety model used

- No secrets, cookies, PINs, TOTP, admin-session tokens, player-session tokens, or protected browser storage values are recorded.
- Completed live writes used exact controlled `OC_V764_*` fixtures and exact cleanup only.
- Unsafe or side-effect-heavy paths were stopped rather than forced.
- No real Toepen/Klaverjas games were altered.
- No permanent badges were awarded.
- No real notification was sent during the remaining matrix phase.
- No broad cleanup RPCs were used as rollback primitives.
- Prepared repair SQL is documented as prepared-only unless explicitly stated as applied.
- Known security/correctness defects are never deliberately restored by rollback files; forward-fix fallbacks preserve the repaired boundary.

## Completed production repairs already applied and proven

| Repair | Status | Evidence summary |
| --- | --- | --- |
| `GEJAST_v755l_boerenbridge_write_auth_guard.sql` | APPLIED / PASS | Missing/invalid/stale sessions rejected, owner mismatch rejected, same-owner retry works, public direct DML rejected, exact cleanup verified. |
| `GEJAST_v755m_profile_rpc_session_token_repair.sql` | APPLIED / PASS | `get_my_profile_settings(text)` and `update_my_profile_settings(text,text,text)` preserved; ambiguous `session_token` defect fixed; invalid/missing/stale sessions rejected; Bruis update/retry/restore proven. |
| `GEJAST_v755n_admin_allowed_username_security_guard.sql` | APPLIED / PASS | Admin functions require `admin_check_session(...).ok=true`; direct `allowed_usernames` DML revoked from `PUBLIC`, `anon`, `authenticated`; remove/permanent-delete status boundary preserved. |

Post-cleanup baseline after applied repairs and controlled proofs:

- `allowed_usernames=51`
- `drink_events=28`
- `boerenbridge_matches=98`
- controlled matrix residue `0`
- controlled queued push jobs `0`
- Ice unit value `2.8`

These are the latest recorded production baselines from the live matrix. They must be freshly re-read before and after applying `v755o`/`v755p`.

## Completed matrix proof status

| Surface | Verdict | What was proven | Limitation / remaining risk |
| --- | --- | --- | --- |
| Boerenbridge | PASS | Auth/session/owner/replay/cleanup/direct-DML boundary. | No repeat proof needed unless implementation changes. |
| Drinks create/replay | PASS WITH LIMITATION | Valid session create, invalid session rejection, replay unique-pending rejection, exact cleanup, Ice restored to `2.8`. | Approval/rejection not tested because it can create permanent drink history. |
| Profile/account own-profile | PASS | Own profile get/update/retry/restore, no orphan markers. | Revisit only if Matrix Player B is created for cross-account proof. |
| Admin allowed username | PASS | Admin session required, public direct DML revoked, controlled cleanup verified. | Admin login is still required for future protected account setup if used. |
| Toepen save | REPAIR FIRST / AUTHORIZED TO APPLY | Missing/invalid/stale/non-participant rejected; malformed winner rejected; valid controlled save/replay/exact cleanup passed; direct REST rejected. | Correctness defect: valid participant could forge inconsistent `end_points`; reviewed `v755o` must be applied and positively re-proven before Toepen becomes PASS. |
| Klaverjas online room | PASS WITH LIMITATION | Invalid create/save rejected; controlled room create/save/retry/delete/cleanup passed; direct REST insert rejected by RLS. | Finished-score/history path is unsafe without transaction-only proof or approved aggregate/rating restore. `klaverjas_upsert_match_state_scoped(...)` remains a candidate auth defect. |
| Klaverjas score/history | REPAIR FIRST | Risk classified; no unsafe live write performed. | `create_jas_game(text,jsonb)` and scoped upsert need a separate repair/transaction plan; intentionally not expanded in v764. |
| Pikken lobby | PASS WITH LIMITATION | Host create/config retry/ready/unready/replay join/host destroy/exact cleanup; no archive/stat/push residue; Ice `2.8`. | No second valid player session available, so cross-player authorization deferred. Start/bid/vote/archive paths remain out of scope. |
| Paardenrace lobby | PASS WITH LIMITATION | Host create/choice retry/wager verify/ready/unready/disband/cleanup; final counts restored: rooms `26`, players `41`, obligations `2`, history `0`, controlled residue `0`, controlled push jobs `0`, Ice `2.8`. | No second valid player session available; no race advancement/draw/tick/nominations/finish/history/obligation-producing paths called. |
| Beerpong | REPAIR FIRST / AUTHORIZED AFTER LIVE PREFLIGHT | Static/read-only inventory identified active caller and risky existing overwrite/direct-DML behavior; `v755p` is now a narrow security/contract repair only. | No production Beerpong write until `v755p` is applied/proven. Rating rebuild/history mutation is explicitly excluded. |
| Badges | NO LIVE WRITE NEEDED | Badge surfaces treated as display/derived only in safe scope. | No permanent badge award attempted. |
| Push | PASS WITH LIMITATION | Static/admin-targeted queue guards and prior queue behavior proven; no new queued controlled push jobs after cleanup. | No additional real push is needed for v764. |
| Rad | NO LIVE WRITE NEEDED | No active production write path identified in targeted inventory. | Reclassify only if a mutation path is later confirmed. |
| Despimarkt/Beurs | OUT OF SCOPE / LOCAL ONLY | Admin-read inventory only. | Economy/ledger rollback would need a separate reviewed plan. |
| Match control/corrections | PASSABLE LATER | Classified as dependent on a controlled target match. | Can affect ratings/rebuild; should only run after target-domain proof/repair. |

## Prepared-only repair packages not yet applied

### Toepen v755o totals consistency guard

Files:

- `GEJAST_v755o_toepen_totals_consistency_guard.sql`
- `GEJAST_v755o_toepen_totals_consistency_guard_ROLLBACK.sql`
- `check-toepen-totals-guard-v755o.mjs`

Purpose:

- Reject inconsistent submitted Toepen participant totals so a valid participant cannot persist forged `end_points` that disagree with persisted round penalties.
- Preserve the existing `create_toepen_game(text,jsonb,text)` RPC signature, session/scope/participant checks, and intended browser-role RPC execution.
- Preserve the direct table write boundary without unnecessarily stripping legitimate read grants in the forward-fix fallback.

Repository review status:

- Static regression included in `npm run verify:static`.
- Forward-fix ACL fallback was tightened to revoke only `INSERT/UPDATE/DELETE` from `PUBLIC`, `anon`, and `authenticated`, rather than broad read privileges.
- Production application is authorized after a fresh live signature/ACL/residue/Ice preflight.
- Still not applied from this chat because no Supabase/database connector is available.

### Beerpong v755p save auth/contract guard

Files:

- `GEJAST_v755p_beerpong_save_auth_guard.sql`
- `GEJAST_v755p_beerpong_save_auth_guard_ROLLBACK.sql`
- `check-beerpong-save-auth-guard-v755p.mjs`

Purpose:

- Preserve `save_beerpong_match(text,text,jsonb)` signature.
- Require a valid player session.
- Require non-null creator and owner-only update/replay for existing `client_match_id`.
- Normalize frontend `format` and backend `match_format`.
- Normalize cups aliases.
- Validate 1v1/2v2 team shape, winner value, and cross-team duplicate player names.
- Use the current player-name Beerpong match schema.
- Defensively revoke direct Beerpong match/rating/history table DML from `PUBLIC`, `anon`, and `authenticated`.
- Preserve current save-time rating behavior: no rating rebuild, no rating/history mutation, and `ratings_applied=false`.
- Preserve dependencies on the existing RPC by using `CREATE OR REPLACE` without dropping the unchanged function signature.
- Provide a forward-fix fallback that keeps auth/owner/DML hardening and the no-rating-rebuild behavior.

Repository review status:

- Static regression included in `npm run verify:static` and fails if the migration invokes `rebuild_beerpong_ratings()` or mutates rating/history tables.
- Regression also fails if the migration/forward-fix drops the unchanged `save_beerpong_match(text,text,jsonb)` signature.
- Production application is authorized after fresh deployed-function parity/schema/ACL/residue/Ice preflight.
- Still not applied from this chat because no Supabase/database connector is available.

## Controlled fixture cleanup evidence highlights

Completed exact cleanup proofs reported zero controlled residue for:

- Toepen valid fixture `OC_V764_TOEPEN_1786160409392` and defect fixture `OC_V764_TOEPEN_BAD_TOTAL_1786160497914`.
- Klaverjas room fixture `OC_V764_KLAVERJAS_ROOM_1786160836496` / room `e3832427-2a0c-4706-8d01-d9938f02093e` / lobby `5Z52W`.
- Pikken fixture `OC_V764_PIKKEN_1786162000362` / game `8ed4b632-8243-4c9a-98e7-e07c1b43de00`.
- Paardenrace fixture `OC_V764_PAARDENRACE_1786163249094` / room `205`.
- Drinks controlled fixture rows from the create/replay proof.
- Boerenbridge controlled fixture rows from v755l proof.
- Profile/admin controlled markers from v755m/v755n proof.

## Reusable FAST MATRIX MODE harness

`./scripts/matrix-harness.mjs` supports repository-safe:

- sanitized SQL snapshot generation;
- per-domain public count snapshots;
- controlled queued push job checks;
- Ice unit value checks;
- table DML ACL snapshots;
- function execute ACL snapshots;
- reviewed exact cleanup helper generation for domains where cleanup predicates are known safe.

The harness does not store tokens, cookies, PINs, service-role keys, or session values.

## Repository verification checkpoint

Draft PR `#5` was opened from `agent/v764-live-write-matrix` to `main` as a draft only; it must not be merged until the remaining production proofs are complete.

Current reviewed head at this checkpoint:

- `7852ec4b57f930af1ad1b39f37b2ca174ccc2c6d`

GitHub Actions:

- Workflow: `GEJAST verification`
- Run: `#90`
- Job: `verify`
- Conclusion: `success`
- Passed steps include JavaScript syntax, RPC coverage, local reference integrity, Klaverjas static regression, Toepen static regression, homepage root-fix regression, and version drift gate.

Additional repository gates previously reported by the matrix work include:

- `node check-beerpong-save-auth-guard-v755p.mjs` PASS before the dependency-preservation tightening; the updated PR CI also passed at current head.
- `npm run verify:static` PASS at the latest OpenClaw checkpoint before this chat-side hardening.
- `npm run verify:js` PASS at that checkpoint.
- `git diff --check` PASS.
- Secret scan PASS.
- Commit guard PASS.

## Remaining blockers before PR is truly final

1. Fresh production preflight and apply/prove Toepen `v755o`.
2. Fresh production preflight and apply/prove Beerpong `v755p` only after `v755o` passes.
3. Re-read and restore all production baselines after each proof; controlled residue and controlled push jobs must end at `0`, Ice at `2.8`.
4. Do not expand v764 into Klaverjas finished-score/history, real push delivery, permanent badge awards, Paardenrace finish/history, or other irreversible families.
5. Before marking the PR ready/final, run the complete final gate suite:
   - `npm run verify`
   - `npm run smoke:live`
   - `npm run smoke:beta:read`
   - `npm run smoke:push`
   - all migration regressions
   - encoding check
   - secret scan
   - ACL/grant checks
   - `git diff --check`
   - changed-file review
   - commit guard

## Current conclusion

Repository-side v764 work is ready for the remaining production database checkpoint. The two unresolved high-value families are intentionally reduced to narrow repairs: Toepen enforces totals consistency, and Beerpong enforces session/owner/DML/contract safety without changing rating behavior. PR `#5` remains draft and unmerged until those production applies and proofs are complete.
