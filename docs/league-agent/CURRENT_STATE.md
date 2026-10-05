# Current League agent state

Last updated: 2026-10-05 07:24 Europe/Amsterdam

## Trial

- Trial expires: 2026-10-11 17:03 Europe/Amsterdam.
- Status: active; do not work after expiry unless renewed.

## Source planes

- Repository path: `C:\Users\jespe\Documents\GitHub\kale-nel`.
- Active source branch: `main`; this cycle's tested result commit is `3978321d` (`test: cover league data quality rendering states`), followed by a docs-only state/lease release commit.
- `origin/main` remains `72d8f1f4`; after the improvement commit and before the docs release commit, local `main` is nine commits ahead with the prior role-purity repair, compact-report fixture coverage, public-page smoke coverage, Data Quality wording repair, and bounded-cycle state commits.
- Older `C:\Users\jespe\GitHub` path is not used.

## Live plane

- Live `/league/` fetched at 2026-10-05 07:04 Europe/Amsterdam returned HTTP 200 with the public League workspace and Riot/session-only copy.
- Production was not deployed in this cycle. The improvement is test-only and changes no production plane.
- Existing live/source drift remains: production still serves the v294 League asset family while local frontend/test/doc commits are ahead of `origin/main`.

## Completed this cycle

- Added `scripts/check-league-data-quality-dom-smoke.mjs`, a VM-based rendered Data Quality smoke that exercises `renderQuality` with synthetic thin, unknown/unavailable, and unsupported-queue evidence states.
- The smoke asserts that thin evidence renders as descriptive-only, unavailable timeline evidence renders as unknown-not-zero, unsupported special/bot queues are not counted as losses or zero-rate evidence, and sample exclusions fail closed outside the report cohort.
- Imported the DOM smoke into `scripts/check-league-analysis-contract.mjs` so the broader contract suite covers rendered Data Quality card semantics.
- Committed the tested improvement as `3978321d`.

## Current goal

No active lease. Next run should take the highest-value remaining P2 item unless a higher-priority correctness or drift failure appears.

## Verification

- `node scripts/check-league-data-quality-dom-smoke.mjs` - pass.
- `node scripts/check-league-analysis-contract.mjs` - pass.
- `node check-league-web-v1.mjs` - pass.
- `node scripts/check-league-public-page-smoke.mjs` - pass for local markup.
- `node check-active-js-syntax.mjs` - pass (`Files checked=531`).
- `git diff --check` and staged/unstaged diff inspection - pass.
- `commit_check` for `test: cover league data quality rendering states` - pass.

## Known issues / deployment blocker

- Local `main` remains ahead of `origin/main`; the prior frontend role-purity fix, public-page smoke coverage, Data Quality frontend wording fix, and this test-only Data Quality DOM smoke are not proven pushed or deployed.
- This cycle itself changed only tests and docs, so it has no affected production plane and no deployment requirement.
- Exact blocker for claiming overall live/source parity remains: no authorized push/deployment workflow was invoked or verified. Before claiming parity for existing frontend drift, push authority and the static deployment job must be confirmed, then the live v294 asset references and affected frontend behavior must be rechecked.

## Notes

- Riot API keys must remain session-only and never be committed, logged, or persisted.
- Production work requires focused verification of every affected plane; otherwise leave code committed with deployment blocker.
