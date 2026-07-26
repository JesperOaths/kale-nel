# Kalenel Final Release Workplan

Started: 2026-07-24 06:22 Europe/Amsterdam
Branch: agent/v757-finalization
Base PR: #2 / agent/v755-stabilization @ e05b4c6f428f789e8167c81297ba491034b77da8
Target visible frontend version: v757 (monotonic after production v756 SQL-only hotfix)

## Preflight facts
- Real checkout: C:\Users\jespe\Documents\GitHub\kale-nel
- Local main/origin main SHA before candidate work: dba341b02fe969d08aceed18ed8f2a2d8249377c
- Preserved dirty local main patch: C:\Users\jespe\Documents\GitHub\kale-nel-preflight-uncommitted-20260724.patch
- Preserved dirty local main stash: stash@{0} preflight-local-main-dirty-v750-v756-20260724
- Evidence ZIP: C:\Users\jespe\.openclaw\workspace\kalenel-master-finalization.zip
- Extracted evidence dirs exist under C:\Users\jespe\.openclaw\workspace\kalenel-master-finalization*.
- Live public site returned HTTP 200 and v750-era content.
- Public /admin.html returned HTTP 200: blocker until public/admin split + Access are proven.
- admin.kalenel.nl DNS did not resolve: external/hosting blocker for final deploy gate unless credentials/config become available.

## Current candidate changes
1. Continue PR #2 candidate on v757 branch.
2. Replace homepage workarounds with source-owned fixes.
3. Make version drift blocking in CI.
4. Normalize visible release version to v757.
5. Deepen Toepen deterministic tests and backend evidence.
6. Prepare public/admin split and Cloudflare Access evidence.
7. Run live-write gates only after credentials and safe test identities are available.

## Gate policy
Do not merge or deploy until CI, SQL, admin split, Access, live-write, mobile, cache-upgrade, and rollback gates are complete or explicitly waived as an external blocker.
