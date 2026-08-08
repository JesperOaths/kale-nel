# v765 Klaverjas read-only audit start

Base: `main` after v764 merge.

Purpose: inspect the unresolved Klaverjas finished-score/history write path before any production mutation or SQL repair.

Safety rules:
- read-only repository inspection first;
- no production SQL changes;
- no live finished-game writes;
- preserve existing working room/lobby behavior;
- identify exact RPC signatures, ownership/session guards, rating/history side effects, direct table grants, idempotency/replay behavior, and reversible repair options before proposing changes.

Primary targets from v764 evidence:
- `create_jas_game(text,jsonb)`
- `klaverjas_upsert_match_state_scoped(...)`
- finished score/history/rating writes and rebuild behavior
- direct table DML boundaries
- client match ownership/replay isolation

Status: INVENTORY STARTED.
