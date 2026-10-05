# Current League agent state

Last updated: 2026-10-05 02:18 Europe/Amsterdam

## Trial

- Trial expires: 2026-10-11 17:03 Europe/Amsterdam.
- Status: active; do not work after expiry unless renewed.

## Source planes

- Repository path: `C:\Users\jespe\Documents\GitHub\kale-nel`.
- Active source branch: `main`; this cycle's tested result commit is `78eb8ac0` (`fix: clarify league data quality evidence limits`), followed by a docs-only state/lease release commit.
- `origin/main` remains `72d8f1f4`; after the improvement commit and before the docs release commit, local `main` is seven commits ahead with the prior role-purity repair, compact-report fixture coverage, public-page smoke coverage, Data Quality wording repair, and bounded-cycle state commits.
- Older `C:\Users\jespe\GitHub` path is not used.

## Live plane

- Live `/league/` fetched at 2026-10-05 02:03 Europe/Amsterdam returned HTTP 200 with the public League workspace and Riot/session-only copy.
- Production was not deployed in this cycle. The frontend source changed in `league/app.js`, so live parity is not claimed until the static plane is pushed/deployed and verified.
- Existing live/source drift remains: production still serves the v294 League asset family while local frontend/test/doc commits are ahead of `origin/main`.

## Completed this cycle

- Improved frontend Data Quality wording so thin evidence explicitly says it is descriptive only and not stable yet.
- Clarified missing evidence as unknown rather than zero.
- Clarified unsupported special/bot queue exclusions as fail-closed outside coaching/benchmarks, not losses or zero-rate events.
- Added contract assertions to keep the new Data Quality wording from regressing.
- Committed the tested improvement as `78eb8ac0`.

## Current goal

No active lease. Next run should take the highest-value remaining P2 item unless a higher-priority correctness or drift failure appears.

## Verification

- `node check-league-web-v1.mjs` - pass.
- `node scripts/check-league-analysis-contract.mjs` - pass.
- `node scripts/check-league-public-page-smoke.mjs` - pass for local markup.
- `node check-active-js-syntax.mjs` - pass (`Files checked=530`).
- `git diff --check` and staged/unstaged diff inspection - pass.
- `commit_check` for `fix: clarify league data quality evidence limits` - pass.

## Known issues / deployment blocker

- Local `main` remains ahead of `origin/main`; the prior frontend role-purity fix, public-page smoke coverage, and this Data Quality frontend wording fix are not proven pushed or deployed.
- Exact blocker: no authorized push/deployment workflow was invoked or verified in this cycle. Before claiming parity, push authority and the static deployment job must be confirmed, then the live v294 asset references and affected frontend behavior must be rechecked.

## Notes

- Riot API keys must remain session-only and never be committed, logged, or persisted.
- Production work requires focused verification of every affected plane; otherwise leave code committed with deployment blocker.
