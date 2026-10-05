# Current League agent state

Last updated: 2026-10-05 17:12 Europe/Amsterdam

## Trial

- Trial expires: 2026-10-11 17:03 Europe/Amsterdam.
- Status: active; do not work after expiry unless renewed.

## Source planes

- Repository path: `C:\Users\jespe\Documents\GitHub\kale-nel`.
- Active source branch: `main`; this cycle's tested result commit is `d21c9b5b` (`fix: clarify league chart evidence metadata`), followed by a docs-only state/lease release commit.
- `origin/main` remains `72d8f1f4`; after the improvement commit and before the docs release commit, local `main` is thirteen commits ahead with the prior role-purity repair, compact-report fixture coverage, public-page smoke coverage, Data Quality wording repair, Data Quality DOM smoke coverage, deployment-plane verification documentation, chart metadata readability, and bounded-cycle state commits.
- Older `C:\Users\jespe\GitHub` path is not used.

## Live plane

- Live `/league/` fetched at 2026-10-05 17:05 Europe/Amsterdam returned HTTP 200 with v294 League asset markers and Riot/session-only copy.
- Production was not deployed in this cycle. The static frontend plane changed (`league/app.js`, `league/styles.css`), but no authorized push/static deployment workflow was invoked or verified.
- Existing live/source drift remains: production still serves the v294 League asset family while local frontend/test/doc commits are ahead of `origin/main`.

## Completed this cycle

- Added chart metadata under each League economy/tempo chart showing plotted valid-observation count, date range, and evidence-floor summary before the interpretive reading.
- Kept chart semantics unchanged: role-specific specs, evidence gates, signed/inverse interpretation, and consistency summaries still share the same existing definitions.
- Added focused contract assertions so the metadata disclosure and CSS remain covered.
- Committed the tested improvement as `d21c9b5b`.

## Current goal

No active lease. Next run should take the highest-value remaining P2 item unless a higher-priority correctness or drift failure appears.

## Verification

- `node scripts/check-league-analysis-contract.mjs` - pass.
- `node check-league-web-v1.mjs` - pass (includes League learning review).
- `node scripts/check-league-public-page-smoke.mjs` - pass for local markup.
- `node check-active-js-syntax.mjs` - pass for 531 files.
- `git diff --check` and staged/unstaged diff inspection - pass.
- `commit_check` for `fix: clarify league chart evidence metadata` - pass.

## Known issues / deployment blocker

- Local `main` remains ahead of `origin/main`; the prior frontend role-purity fix, public-page smoke coverage, Data Quality frontend wording fix, Data Quality DOM smoke, deployment-verification documentation, and this chart metadata change are not proven pushed or deployed.
- This cycle changed the static frontend plane but not backend/API code.
- Exact blocker for claiming this cycle live: static frontend changed but no authorized push/static deployment job was invoked or verified. Before claiming live/source parity, push authority and the static deployment job must be confirmed, then the live v294 asset references and affected frontend behavior must be rechecked.

## Notes

- Riot API keys must remain session-only and never be committed, logged, or persisted.
- Production work requires focused verification of every affected plane; otherwise leave code committed with deployment blocker.
