# GEJAST v725a Surgical Repair Notes

This is a correction after the overly broad v725 SQL pass.

## What went wrong

The v725 file tried to own too much of the Pikken and Paardenrace backend at once. That violated the repair-first handoff model:

- preserve existing owner paths
- patch only the broken wrapper/signature/cache edge
- do not replace gameplay logic unless the owner implementation is proven wrong
- do not create broad compatibility SQL that can silently change working behavior

## Handoffs / references checked

- `HANDOFF_v717_CONTINUATION_SUMMARY.md`
- `migration handof/v222/GEJAST_UNIFIED_HANDOFF_v4.md`
- `migration handof/v222/GEJAST_MASTER_AI_READY_PACKAGE_v1.md`
- `migration handof/v222/sql_architecture_handoff_extended.txt`
- `migration handof/redundant/this is in zip 6/GEJAST_HANDOFF_v450_MASTER.md`
- `migration handof/redundant/this is in zip 6/GEJAST_HANDOFF_SUPPORT_v450.md`
- `migration handof/redundant/this is in zip 6/PAARDENRACE_RULEBOOK_FOR_IMPLEMENTATION.md`
- old targeted Pikken bundles:
  - `for super soldier/gejast_v489_pikken_lobby_restore.zip`
  - `for super soldier/gejast_v552_pikken_lobby_to_live_pipeline_fix.zip`
- existing patch lineage:
  - v695 live Pikken/Paardenrace
  - v700 Pikken ready/bid/reject/vote
  - v706 room recognition/cleanup
  - v716 Pikken archive/lobby naming
  - v717 lobby/start/ladders fix

## New repair rule for continuation

Do not run `GEJAST_v725_pikken_paardenrace_pipeline_contract.sql` as the preferred repair path.

Use `GEJAST_v725a_SURGICAL_rpc_wrapper_repair.sql` instead when the current production issue is:

- Pikken state RPC missing/schema cache stale
- Paardenrace room-state wrapper missing
- Paardenrace ready/start/join ambiguous overloads

The v725a SQL keeps the older gameplay implementations intact and only repairs frontend-facing wrapper signatures.

## What v725a does

- Drops only frontend-facing ambiguous wrappers for:
  - `get_paardenrace_room_state_safe`
  - `get_paardenrace_room_state_fast_v687`
  - `join_paardenrace_room_fast_v687`
  - `set_paardenrace_ready_safe`
  - `start_paardenrace_room_safe`
  - `start_paardenrace_countdown_safe`
  - `pikken_get_state_scoped`
- Recreates one exact safe signature for each.
- Delegates Paardenrace state to `_paardenrace_build_room_state`.
- Delegates Pikken state to `_pikken_build_state_v695` if it exists.
- Does not rewrite Pikken bidding, voting, round resolution, or match recording.

## Remaining verification needed

After running v725a SQL:

1. Open Pikken lobby page.
2. Create lobby.
3. Join with second account.
4. Ready both.
5. Start match.
6. Confirm `pikken_live.html` loads without state-RPC error.
7. Place bid, reject with the non-bidder, confirm old game logic resolves.
8. Open Paardenrace lobby page.
9. Create room.
10. Join with second account.
11. Select two different suits, verify wagers, ready both.
12. Start race and confirm live page receives real room/race state.

If a gameplay function fails after that, patch that specific owner function only.
