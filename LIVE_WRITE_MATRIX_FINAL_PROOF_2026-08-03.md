# v764 live-write matrix — final proof

Date finalized: 2026-08-08
Branch: `agent/v764-live-write-matrix`
Pull request: `#5` (`v764 live-write matrix security hardening`)
Merge status: **MERGED**
Merge commit: `075891fefc66d5129619b1eb3e6e9618d5359577`

## Final verdict

**MATRIX FINISHED.** All v764 critical security/correctness rows are resolved, all controlled production fixtures have been removed, no controlled push jobs remain, Ice is exactly `2.8`, the frontend release/cache-buster is synchronized to `v764`, and the complete final repository/live smoke suite passed.

## Applied production repairs

| Repair | Final status | Production proof |
| --- | --- | --- |
| `GEJAST_v755l_boerenbridge_write_auth_guard.sql` | APPLIED / PASS | Session/auth/owner/replay boundary proven; different-player overwrite rejected; direct write ACL hardened; exact fixture cleanup. |
| `GEJAST_v755m_profile_rpc_session_token_repair.sql` | APPLIED / PASS | Ambiguous `session_token` defect fixed; own-profile update/retry/restore proven; invalid/missing/stale sessions reject before write. |
| `GEJAST_v755n_admin_allowed_username_security_guard.sql` | APPLIED / PASS | Protected admin session required; public/web-role direct DML revoked; controlled lifecycle cleanup restored baseline. |
| `GEJAST_v755o_toepen_totals_consistency_guard.sql` | APPLIED / PASS | Forged participant totals rejected; invalid/missing/stale/nonparticipant/malformed saves rejected; same-owner replay deterministic; child rows correct; direct DML revoked; exact cleanup. |
| `GEJAST_v755p_beerpong_save_auth_guard.sql` | APPLIED / PASS | Session/creator/owner guard proven; cross-player overwrite rejected; replay idempotent; aliases preserved; direct DML revoked; rating/history behavior unchanged. |

## Final Toepen controlled proof

`LIVE_V755O_CONTROLLED_PROOF.sql` returned PASS for every row:

- valid save
- correct participant/round/result child rows
- same-owner replay
- forged total rejection
- malformed result rejection
- nonparticipant rejection
- missing/invalid/stale session rejection
- direct DML boundary
- exact cleanup
- controlled push residue `0`
- Ice `2.8`
- baseline restored: games `0 -> 0`, participants `0 -> 0`, rounds `0 -> 0`, results `0 -> 0`

## Final Beerpong controlled proof

`LIVE_V755P_CONTROLLED_PROOF.sql` returned PASS for every row:

- valid save
- non-null correct creator ownership
- same-owner replay with one row only
- different valid player rejected with `beerpong_match_owner_mismatch`
- missing/invalid/stale sessions rejected
- `format` / `match_format` alias preserved
- cups aliases preserved
- public/anon/authenticated direct DML blocked
- rating rows unchanged at `0`
- rating history unchanged at `0`
- controlled push residue `0`
- exact controlled match cleanup
- Ice `2.8`

A final global residue scan found one historical matrix probe already present from the early read-only inventory phase:

- `beerpong_matches.id = 61`
- `client_match_id = OC_V764_MATRIX_20260803_READONLY_BEER`
- `created_by_player_id = null`
- marker present in `client_match_id` and `payload`

It was confirmed to be a controlled matrix artifact and removed using `LIVE_V764_BEERPONG_MARKER_CLEANUP.sql`, which required the exact ID/client ID/null creator marker before deletion.

After that exact cleanup:

- Beerpong matches: `18`
- Beerpong ratings: `0`
- Beerpong rating history: `0`
- global `OC_V764` production residue: `0`
- controlled push jobs: `0`
- Ice: `2.8`

The earlier apparent Beerpong baseline of `19` included this controlled probe row; therefore the cleaned genuine production baseline is `18`.

## Final production invariants

Confirmed production state after all controlled cleanup:

- global `OC_V764` rows across public tables: **0**
- controlled push jobs: **0**
- Ice unit value: **2.8**
- Toepen games / participants / rounds / results: **0 / 0 / 0 / 0**
- Beerpong matches / ratings / rating history: **18 / 0 / 0**
- Boerenbridge matches: **98**
- drink events: **28**
- allowed usernames: **51**

No real push notification was sent during v764 final matrix work.

## Other matrix surfaces

| Surface | Final classification |
| --- | --- |
| Drinks create/replay | PASS WITH LIMITATION — safe create/replay/cleanup proven; approval/rejection intentionally excluded because it can create permanent drink history. |
| Klaverjas online room | PASS WITH LIMITATION — reversible online-room lifecycle proven; finished score/history intentionally excluded from v764. |
| Pikken lobby | PASS WITH LIMITATION — reversible lobby lifecycle proven; irreversible/archive/game-completion paths excluded. |
| Paardenrace lobby | PASS WITH LIMITATION — reversible lobby lifecycle proven; race/history/obligation-producing paths excluded. |
| Badges | NO LIVE WRITE NEEDED — display/derived scope only; no permanent badge awarded. |
| Push | PASS WITH LIMITATION — prior targeted delivery proof exists; v764 required only queue/dedupe/no-residue verification and sent no new real push. |
| Rad | NO LIVE WRITE NEEDED — no active production mutation identified in the targeted inventory. |
| Despimarkt / Beurs | OUT OF SCOPE — economy/ledger mutation paths require their own dedicated reversible plan. |

These limitations are deliberate safety boundaries, not unresolved v764 blockers.

## Frontend release/version state

`drinks_add.html` contains the real Ice correction from fallback `3` to `2.8`.

The release marker/cache-buster convention was resolved by synchronizing active frontend markers from `v761` to root `VERSION = v764` using the repository's existing `fix-version-drift.mjs`. The temporary automation used for that mechanical sync was removed afterward.

## Final verification

On commit `94279055b6b66a2bccac1cab2c9987025d67010d`, both pull-request workflows completed successfully:

- `GEJAST verification` run `#133` / run id `31248844531`: **SUCCESS**
- `v764 final smoke` run `#5` / run id `31248844533`: **SUCCESS**

The final smoke included:

- `npm run verify` — PASS
- `npm run smoke:live` — PASS
- `npm run smoke:beta:read` — PASS
- `npm run smoke:push` — PASS, no real send

The temporary `v764 final smoke` workflow was removed after this successful proof. Only evidence/documentation cleanup followed; no application/security behavior was weakened or reverted.

## Merge completion

PR #5 was merged into `main` on 2026-08-08 with merge commit `075891fefc66d5129619b1eb3e6e9618d5359577` after the matrix and final verification gates passed.
