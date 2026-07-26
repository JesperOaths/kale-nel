# Recovery Kalenel v757

## Current rollback references
- Production/main before this work: dba341b02fe969d08aceed18ed8f2a2d8249377c
- PR #2 candidate start: e05b4c6f428f789e8167c81297ba491034b77da8
- Preserved local preflight patch: C:\Users\jespe\Documents\GitHub\kale-nel-preflight-uncommitted-20260724.patch
- Preserved local stash: stash@{0} preflight-local-main-dirty-v750-v756-20260724
- Evidence ZIP: C:\Users\jespe\.openclaw\workspace\kalenel-master-finalization.zip

## Rollback principle
- Frontend rollback: redeploy the last known good public SHA.
- SQL rollback: use forward-compatible migration only unless an explicit impact plan says otherwise. Do not delete/recalculate production data casually.
- Admin rollback: if admin split/Access fails, keep public admin files unavailable and pause release rather than exposing protected tools.

## Current release status
Blocked from merge/deploy until full gate is proven.
