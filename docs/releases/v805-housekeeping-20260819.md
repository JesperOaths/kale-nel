# v805 release housekeeping — 2026-08-19

Certified product commit: `b64a116f2b2684d1fbd475b40c2b76f569d40942`

Status: **release evidence consolidated; disposable branch deletion blocked by repository rules**

## Completed

- `release/v805-certified-20260818` is pinned exactly to the certified product commit.
- `release/v805-certified-freeze-20260818` was repointed exactly to the certified product commit so it no longer carries certification-only commits.
- Tag `v805-certified-20260818` resolves exactly to the certified product commit.
- `release/v805-finalization-record` remains intentionally retained as the evidence branch.
- The permanent release record is present on `main` at `docs/releases/v805-certified-20260818.md` and preserves the v801a migration, authoritative run/job IDs, visual artifact ID, SHA-256 `7757d1e51ae99152ee730efb640a27566a28d05eb2d635957bf40f40118495c5`, and zero-production-residue result.
- The retained final live-browser certification no longer downloads Playwright Chromium. It uses deterministic GitHub-runner system Chrome with a fail-closed runtime preparation step.

## Branch-cleanup attempt

Observable Actions run: `32250218928`

Cleanup job: `96059335429`

The immutable-evidence preflight completed successfully and emitted:

`RESULT=V805_FINAL_HOUSEKEEPING_PREFLIGHT_PASS`

The job then attempted deletion of the exact disposable v805 proof/ops/test branches and the merged maintenance branches. GitHub rejected each deletion with repository-rule error `GH013` and the explicit rule result:

`Cannot delete this branch`

The Actions token had `Contents: write`; therefore this is a repository ruleset restriction, not a workflow token-scope defect. The workflow deliberately continued across the allowlist and confirmed the named branches remained as residue. No permanent release branch or tag was targeted, moved, or deleted.

## Operational conclusion

The certified v805 rollback baseline itself is clean and immutable. The remaining cleanup is repository-reference housekeeping only. Deleting the obsolete branches requires changing or bypassing the repository rule that forbids branch deletion; that cannot be solved correctly by weakening release evidence checks or by adding more cleanup workflows.

The failing one-shot cleanup workflow is removed from `main` so subsequent development does not inherit a permanently failing housekeeping Action. Once branch deletion is permitted at the repository-rules level, the exact obsolete branch inventory can be deleted and verified without changing the certified product tree.
