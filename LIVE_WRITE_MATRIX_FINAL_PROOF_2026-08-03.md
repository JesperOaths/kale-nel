# Live write matrix final proof draft - 2026-08-03 / 2026-08-08

Branch: `agent/v764-live-write-matrix`

Draft PR: `#5` (`v764 live-write matrix security hardening`).

Status: FINAL-PROOF DRAFT. Repository-side review and draft-PR CI are complete. `v755o` Toepen is applied and its post-apply live catalog/ACL/residue verification passes; the remaining production blocker is application/proof of the reviewed `v755p` Beerpong repair.

## Safety model used

- No secrets, cookies, PINs, TOTP, admin-session tokens, player-session tokens, or protected browser storage values are recorded.
- Completed live writes used exact controlled `OC_V764_*` fixtures and exact cleanup only.
- Unsafe or side-effect-heavy paths were stopped rather than forced.
- No real Toepen/Klaverjas games were altered.
- No permanent badges were awarded.
- No real notification was sent during the remaining matrix phase.
- No broad cleanup RPCs were used as rollback primitives.
- Known security/correctness defects are never deliberately restored by rollback files; forward-fix fallbacks preserve the repaired boundary.

## Completed production repairs already applied and proven

| Repair | Status | Evidence summary |
| --- | --- | --- |
| `GEJAST_v755l_boerenbridge_write_auth_guard.sql` | APPLIED / PASS | Missing/invalid/stale sessions rejected, owner mismatch rejected, same-owner retry works, public direct DML rejected, exact cleanup verified. |
| `GEJAST_v755m_profile_rpc_session_token_repair.sql` | APPLIED / PASS | `get_my_profile_settings(text)` and `update_my_profile_settings(text,text,text)` preserved; ambiguous `session_token` defect fixed; invalid/missing/stale sessions rejected; Bruis update/retry/restore proven. |
| `GEJAST_v755n_admin_allowed_username_security_guard.sql` | APPLIED / PASS | Admin functions require `admin_check_session(...).ok=true`; direct `allowed_usernames` DML revoked from `PUBLIC`, `anon`, `authenticated`; remove/permanent-delete status boundary preserved. |
| `GEJAST_v755o_toepen_totals_consistency_guard.sql` | APPLIED / PASS | Applied once in Supabase on 2026-08-08. Read-only post-apply verification passed all 11 checks: function exists; live totals/session/participant guards compiled; PUBLIC execute revoked; anon/authenticated guarded RPC execute retained; PUBLIC/anon/authenticated direct DML revoked; controlled Toepen residue `0`; Ice `2.8`. Earlier controlled matrix proof already established the forged-total defect and reversible Toepen lifecycle. |

Latest confirmed invariants after v755o post-apply verification:

- controlled Toepen residue `0`
- Ice unit value `2.8`
- `create_toepen_game(text,jsonb,text)` exists
- PUBLIC cannot execute the Toepen save RPC
- `anon` and `authenticated` retain guarded RPC execution
- PUBLIC/anon/authenticated have no direct INSERT/UPDATE/DELETE grants on Toepen write tables

Other previously recorded matrix baselines remain documented and must be freshly re-read around `v755p` rather than assumed unchanged.

## Completed matrix proof status

| Surface | Verdict | What was proven | Limitation / remaining risk |
| --- | --- | --- | --- |
| Boerenbridge | PASS | Auth/session/owner/replay/cleanup/direct-DML boundary. | No repeat proof needed unless implementation changes. |
| Drinks create/replay | PASS WITH LIMITATION | Valid session create, invalid session rejection, replay unique-pending rejection, exact cleanup, Ice restored to `2.8`. | Approval/rejection not tested because it can create permanent drink history. |
| Profile/account own-profile | PASS | Own profile get/update/retry/restore, no orphan markers. | Revisit only if Matrix Player B is created for cross-account proof. |
| Admin allowed username | PASS | Admin session required, public direct DML revoked, controlled cleanup verified. | Admin login is still required for future protected account setup if used. |
| Toepen save | PASS | Pre-repair controlled lifecycle/auth/replay/cleanup was proven; v755o was then applied once and the live compiled totals/session/participant guards plus RPC/table ACL boundary and zero controlled residue were independently re-verified read-only. | No further Toepen production mutation is needed for v764 unless implementation changes. |
| Klaverjas online room | PASS WITH LIMITATION | Invalid create/save rejected; controlled room create/save/retry/delete/cleanup passed; direct REST insert rejected by RLS. | Finished-score/history path remains intentionally out of scope. |
| Klaverjas score/history | REPAIR FIRST | Risk classified; no unsafe live write performed. | Separate repair/transaction plan required; intentionally not expanded in v764. |
| Pikken lobby | PASS WITH LIMITATION | Host create/config retry/ready/unready/replay join/host destroy/exact cleanup; no archive/stat/push residue; Ice `2.8`. | Cross-player authorization deferred; start/bid/vote/archive paths remain out of scope. |
| Paardenrace lobby | PASS WITH LIMITATION | Host create/choice retry/wager verify/ready/unready/disband/cleanup; counts restored and Ice `2.8`. | Cross-player authorization deferred; race advancement/history/obligation-producing paths remain out of scope. |
| Beerpong | REPAIR FIRST / AUTHORIZED AFTER LIVE PREFLIGHT | Static/read-only inventory identified existing overwrite/direct-DML risks; `v755p` is a narrow session/owner/DML/contract repair that preserves no-rating-rebuild behavior. | Run fresh read-only preflight, apply once only if all checks pass, then run post-apply verification. |
| Badges | NO LIVE WRITE NEEDED | Display/derived surfaces only in safe scope. | No permanent badge award attempted. |
| Push | PASS WITH LIMITATION | Prior targeted queue/delivery work and v764 no-residue checks documented. | No additional real push needed for v764. |
| Rad | NO LIVE WRITE NEEDED | No active production write path identified in targeted inventory. | Reclassify only if a mutation path is later confirmed. |
| Despimarkt/Beurs | OUT OF SCOPE / LOCAL ONLY | Admin-read inventory only. | Economy/ledger rollback needs separate reviewed plan. |

## Remaining repair: Beerpong v755p

Files:

- `GEJAST_v755p_beerpong_save_auth_guard.sql`
- `GEJAST_v755p_beerpong_save_auth_guard_ROLLBACK.sql`
- `check-beerpong-save-auth-guard-v755p.mjs`
- `LIVE_PREFLIGHT_V755P_VERIFY.sql`
- `LIVE_POSTAPPLY_V755P_VERIFY.sql`

Purpose and constraints:

- Preserve `save_beerpong_match(text,text,jsonb)` signature.
- Require valid player session and non-null creator ownership.
- Existing `client_match_id` may only be updated/replayed by its original creator.
- Normalize `format`/`match_format` and cups aliases.
- Validate 1v1/2v2 shape, winner, and cross-team duplicate players.
- Revoke direct Beerpong write grants from PUBLIC/anon/authenticated.
- Revoke PUBLIC function execute while preserving guarded anon/authenticated RPC execute.
- Preserve current rating behavior: no rating rebuild/history mutation; `ratings_applied=false`.
- Use `CREATE OR REPLACE` without dropping the unchanged signature.

Application rule:

1. Run `LIVE_PREFLIGHT_V755P_VERIFY.sql` read-only.
2. Apply `GEJAST_v755p_beerpong_save_auth_guard.sql` once only if every preflight row is PASS and the baseline counts are captured.
3. Run `LIVE_POSTAPPLY_V755P_VERIFY.sql` read-only and compare counts with preflight; rating/history counts must not change from migration application.
4. Keep PR #5 draft until Beerpong proof and final release/version checks are complete.

## Repository verification checkpoint

Draft PR `#5` remains open and unmerged. GitHub `GEJAST verification` has passed on the hardened branch checkpoints. Static regressions cover v755l/v755m/v755n/v755o/v755p plus matrix evidence/invariants.

## Remaining blockers before PR is truly final

1. Fresh production preflight and apply/post-verify Beerpong `v755p`.
2. Confirm Beerpong controlled residue `0`, rating/history counts unchanged by migration application, and Ice `2.8`.
3. Resolve release-version/cache-busting treatment for the real frontend `drinks_add.html` Ice fallback correction before merge.
4. Do not expand v764 into irreversible Klaverjas history, real push delivery, permanent badges, or other unrelated families.
5. Run final complete repository/live smoke gates before marking PR ready.

## Current conclusion

Toepen v755o is now applied and independently post-verified. The only planned production database repair left in v764 is the narrow Beerpong v755p security/contract guard. PR #5 stays draft and must not be merged until that checkpoint is complete.
