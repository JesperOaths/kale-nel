# Live write matrix final proof draft - 2026-08-03 / 2026-08-08

Branch: `agent/v764-live-write-matrix`

Status: FINAL-PROOF DRAFT. This file consolidates completed reversible evidence and explicitly marks remaining authorization/login blockers. It does not claim that repair-first mutation families are production-approved.

## Safety model used

- No secrets, cookies, PINs, TOTP, admin-session tokens, player-session tokens, or protected browser storage values are recorded.
- Completed live writes used exact controlled `OC_V764_*` fixtures and exact cleanup only.
- Unsafe or side-effect-heavy paths were stopped rather than forced.
- No real Toepen/Klaverjas games were altered.
- No permanent badges were awarded.
- No real notification was sent during the remaining matrix phase.
- No broad cleanup RPCs were used as rollback primitives.
- Prepared repair SQL is documented as prepared-only unless explicitly stated as applied.

## Completed production repairs already applied and proven

| Repair | Status | Evidence summary |
| --- | --- | --- |
| `GEJAST_v755l_boerenbridge_write_auth_guard.sql` | APPLIED / PASS | Missing/invalid/stale sessions rejected, owner mismatch rejected, same-owner retry works, public direct DML rejected, exact cleanup verified. |
| `GEJAST_v755m_profile_rpc_session_token_repair.sql` | APPLIED / PASS | `get_my_profile_settings(text)` and `update_my_profile_settings(text,text,text)` preserved; ambiguous `session_token` defect fixed; invalid/missing/stale sessions rejected; Bruis update/retry/restore proven. |
| `GEJAST_v755n_admin_allowed_username_security_guard.sql` | APPLIED / PASS | Admin functions require `admin_check_session(...).ok=true`; direct `allowed_usernames` DML revoked from `PUBLIC`, `anon`, `authenticated`; remove/permanent-delete status boundary preserved. |

Post-cleanup baseline after applied repairs:

- `allowed_usernames=51`
- `drink_events=28`
- `boerenbridge_matches=98`
- controlled matrix residue `0`
- controlled queued push jobs `0`
- Ice unit value `2.8`

## Completed matrix proof status

| Surface | Verdict | What was proven | Limitation / remaining risk |
| --- | --- | --- | --- |
| Boerenbridge | PASS | Auth/session/owner/replay/cleanup/direct-DML boundary. | No repeat proof needed unless implementation changes. |
| Drinks create/replay | PASS WITH LIMITATION | Valid session create, invalid session rejection, replay unique-pending rejection, exact cleanup, Ice restored to `2.8`. | Approval/rejection not tested because it can create permanent drink history. |
| Profile/account own-profile | PASS | Own profile get/update/retry/restore, no orphan markers. | Revisit only if Matrix Player B is created for cross-account proof. |
| Admin allowed username | PASS | Admin session required, public direct DML revoked, controlled cleanup verified. | Admin session currently requires login for future admin-gated tasks. |
| Toepen save | REPAIR FIRST | Missing/invalid/stale/non-participant rejected; malformed winner rejected; valid controlled save/replay/exact cleanup passed; direct REST rejected. | Correctness defect: valid participant could forge inconsistent `end_points`; v755o prepared-only totals guard must be reviewed/applied before further Toepen mutation proof. |
| Klaverjas online room | PASS WITH LIMITATION | Invalid create/save rejected; controlled room create/save/retry/delete/cleanup passed; direct REST insert rejected by RLS. | Finished-score/history path is unsafe without transaction-only proof or approved aggregate/rating restore. `klaverjas_upsert_match_state_scoped(...)` remains a candidate auth defect. |
| Klaverjas score/history | REPAIR FIRST | Risk classified; no unsafe live write performed. | `create_jas_game(text,jsonb)` and scoped upsert need repair/transaction plan before production mutation. |
| Pikken lobby | PASS WITH LIMITATION | Host create/config retry/ready/unready/replay join/host destroy/exact cleanup; no archive/stat/push residue; Ice `2.8`. | No second valid player session available, so cross-player authorization deferred. Start/bid/vote/archive paths remain out of scope. |
| Paardenrace lobby | PASS WITH LIMITATION | Host create/choice retry/wager verify/ready/unready/disband/cleanup; final counts restored: rooms `26`, players `41`, obligations `2`, history `0`, controlled residue `0`, controlled push jobs `0`, Ice `2.8`. | No second valid player session available; no race advancement/draw/tick/nominations/finish/history/obligation-producing paths called. |
| Beerpong | REPAIR FIRST | Static/read-only inventory identified active caller and effective risky overriding implementation; prepared v755p package only. | No production Beerpong write until v755p or equivalent is reviewed/applied/proven. |
| Badges | NO LIVE WRITE NEEDED | Badge surfaces treated as display/derived only in safe scope. | No permanent badge award attempted. |
| Push | PASS WITH LIMITATION | Static/admin-targeted queue guards and prior queue behavior proven; no new queued controlled push jobs after cleanup. | Dispatcher delivery/click proof blocked by missing dispatcher env/secrets and no approval to send a real notification. |
| Rad | NO LIVE WRITE NEEDED | No active production write path identified in targeted inventory. | Reclassify only if a mutation path is later confirmed. |
| Despimarkt/Beurs | OUT OF SCOPE / LOCAL ONLY | Admin-read inventory only. | Economy/ledger rollback would need a separate reviewed plan. |
| Match control/corrections | PASSABLE LATER | Classified as dependent on a controlled target match. | Can affect ratings/rebuild; should only run after target-domain proof/repair. |

## Prepared-only repair packages not applied

### Toepen v755o totals consistency guard

Files:

- `GEJAST_v755o_toepen_totals_consistency_guard.sql`
- `GEJAST_v755o_toepen_totals_consistency_guard_ROLLBACK.sql`
- `check-toepen-totals-guard-v755o.mjs`

Purpose:

- Reject or recompute inconsistent submitted Toepen participant totals so a valid participant cannot persist forged `end_points` that disagree with round results.

Status:

- Static regression included in `npm run verify:static`.
- Production mutation family remains blocked until reviewed/applied/proven.

### Beerpong v755p save auth guard

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
- Use current player-name Beerpong match schema.
- Defensively revoke direct Beerpong match/rating/history table DML from `PUBLIC`, `anon`, and `authenticated`.
- Preserve current save-time rating behavior: no rating rebuild, no rating/history mutation, and `ratings_applied=false`.
- Provide a forward-fix rollback that keeps auth/owner/DML hardening and the no-rating-rebuild behavior.

Status:

- Static regression included in `npm run verify:static` and fails if the main migration invokes `rebuild_beerpong_ratings()` or mutates rating/history tables.
- Not applied yet; authorized after parity/schema/ACL/static preflight passes.

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

`./scripts/matrix-harness.mjs` now supports repository-safe:

- sanitized SQL snapshot generation;
- per-domain public count snapshots;
- controlled queued push job checks;
- Ice unit value checks;
- table DML ACL snapshots;
- function execute ACL snapshots;
- reviewed exact cleanup helper generation for domains where cleanup predicates are known safe.

The harness does not store tokens, cookies, PINs, service-role keys, or session values.

## Gates run for latest Beerpong-prep checkpoint

- `node check-beerpong-save-auth-guard-v755p.mjs` PASS.
- `npm run verify:static` PASS.
- `npm run verify:js` PASS.
- `git diff --check` PASS, with expected Windows LF-to-CRLF warnings only.
- Secret scan PASS.
- Commit guard PASS for `fix: prepare beerpong save auth guard`.

## Remaining blockers before PR is truly final

1. Review/authorize/apply/prove Toepen v755o, or keep Toepen explicitly blocked.
2. Review/authorize/apply/prove Beerpong v755p, or keep Beerpong explicitly blocked.
3. If cross-player coverage is still required, create one reusable `OC_V764_MATRIX_PLAYER_B` after protected admin login and use it only for the smallest missing probes.
4. Do not run Klaverjas score/history proof until a transaction-only or exact aggregate/rating restore plan is approved.
5. Do not send a real push notification without explicit approval.
6. Before opening PR, run the complete final gate suite:
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

The matrix has strong evidence for the already-repaired core account/admin/profile/Boerenbridge surfaces and limited but clean evidence for reversible lobby/create surfaces. The remaining high-risk families are correctly stopped at repair/authorization boundaries rather than being forced through unsafe live writes.
