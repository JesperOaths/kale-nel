# v766 Klaverjas live-alias final proof — 2026-08-08

Branch: `agent/v766-klaverjas-live-aliases`
PR: #8
Production migration: `GEJAST_v755s_klaverjas_live_alias_contract.sql`
Production execution artifact: `LIVE_APPLY_AND_VERIFY_V755S_KLAVERJAS_LIVE_ALIASES.sql`

## Defect proven before repair

Production lacked all four current runtime live RPCs:

- `start_klaverjas_live_match_v687(text,text,jsonb,text)`;
- `update_klaverjas_live_match_v687(text,text,jsonb,text)`;
- `finish_klaverjas_live_match_v687(text,text,jsonb,text)`;
- `get_klaverjas_live_state_public_v687(text,text)`.

The frontend runtime generates text/UUID `client_match_id` values, while the legacy fallback uses bigint-based live APIs. That made UUID-backed start/update/finish/get unreliable even after the v765 finished-score save repair.

## Repair deployed

v755s:

- installs the exact four runtime v687 live aliases;
- supports text/UUID client IDs;
- authenticates every write through `_jas_session_player`;
- scopes update/finish to `created_by_player_id` and site scope;
- makes same-owner start and finish replays idempotent;
- leaves public live-state reads scope-filtered and read-only;
- preserves the v765 direct-DML boundary;
- does not write classic `jas_games`, `jas_game_entries`, or the rating rebuild queue.

## Transaction-gated production proof

`LIVE_APPLY_AND_VERIFY_V755S_KLAVERJAS_LIVE_ALIASES.sql` completed successfully and committed the repair only after every assertion below passed:

| Check | Result | Evidence |
| --- | --- | --- |
| baseline_restored | PASS | controlled live match/round/snapshot fixture removed exactly |
| controlled_push_jobs | PASS | OC_V766 push rows=0 |
| controlled_residue | PASS | no controlled v766 Klaverjas match/session rows remain |
| cross_player_owner_guard | PASS | different valid player rejected on live update |
| direct_dml_boundary | PASS | PUBLIC/anon/authenticated INSERT/UPDATE/DELETE grants=0 on target tables |
| ice_invariant | PASS | Ice=2.8 |
| owner_live_finish | PASS | owner finish persisted 120-90, round_no=8 and finished state |
| owner_live_update | PASS | owner update persisted 40-20 and public round_no=3 |
| public_uuid_get | PASS | public scope-filtered getter resolves UUID/text client id |
| rating_history_isolation | PASS | jas_games/entries/rebuild queue unchanged by live proof |
| rpc_execute_boundary | PASS | write aliases PUBLIC=false; guarded web-role execution retained |
| same_owner_finish_replay | PASS | finished replay is idempotent and keeps one row |
| same_owner_start_replay | PASS | same owner start replay returned existing active row |
| session_guards | PASS | missing, invalid and stale sessions rejected before live writes |
| valid_uuid_start | PASS | UUID/text live match created active at 0-0 with correct creator and zero rounds |

## Residue / invariants

- Controlled v766 match/session residue: `0`.
- Controlled v766 push jobs: `0`.
- Ice: `2.8`.
- Direct web-role Klaverjas DML grants on the inventoried target tables: `0`.
- Classic `jas_games` / entries / rating rebuild queue were unchanged by the live proof.

## Final independent gate

Before PR #8 is made ready/merged, run `LIVE_POSTAPPLY_V755S_VERIFY.sql` read-only in production. Required final state:

- `live_aliases_exist`: PASS;
- `live_write_rpc_boundary`: PASS;
- `public_live_getter_boundary`: PASS;
- `direct_dml_boundary`: PASS;
- `controlled_v766_residue`: PASS;
- `controlled_push_jobs`: PASS;
- `ice_invariant`: PASS;
- `baseline_snapshot`: informational PASS with current production counts.

## Next phase already identified

After v766 merges, the frontend still needs a separate release to:

1. allow a 0-0 live start without using the finished-match tie validator;
2. expose a Start Live action from the scorer, matching the live page instructions;
3. bump frontend version/cache-busters according to the project release convention.
