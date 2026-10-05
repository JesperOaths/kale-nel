# Current League agent state

Last updated: 2026-10-05 22:18 Europe/Amsterdam

## Trial

- Trial expires: 2026-10-11 17:03 Europe/Amsterdam.
- Status: active; do not work after expiry unless renewed.

## Source planes

- Repository path: `C:\Users\jespe\Documents\GitHub\kale-nel`.
- Active source branch: `main`; this cycle's tested result commit is `d9341e63` (`refactor: share league selected-role resolver`), followed by a docs-only state/lease release commit.
- `origin/main` remains `72d8f1f4`; after the improvement commit and before the docs release commit, local `main` is fifteen commits ahead with the prior role-purity repair, compact-report fixture coverage, public-page smoke coverage, Data Quality wording repair, Data Quality DOM smoke coverage, deployment-plane verification documentation, chart metadata readability, shared selected-role resolver refactor, and bounded-cycle state commits.
- Older `C:\Users\jespe\GitHub` path is not used.

## Live plane

- Live `/league/` fetched at 2026-10-05 22:04 Europe/Amsterdam returned HTTP 200 with v294 League asset markers and Riot/session-only copy.
- Production was not deployed in this cycle. The static frontend plane changed (`league/app.js`), but no authorized push/static deployment workflow was invoked or verified.
- Existing live/source drift remains: production still serves the v294 League asset family while local frontend/test/doc commits are ahead of `origin/main`.

## Completed this cycle

- Added shared `reportSelectedRole` helper for frontend report role precedence and reused it in role-scope checks, report subtitles, coaching-cohort filtering, and coaching-context gating.
- Preserved role-pure mechanics filtering while reducing duplicated selected-role precedence logic in the frontend cohort helpers.
- Updated focused contract and saved-report fixture coverage so the shared resolver remains loaded and required by the strict cohort checks.
- Committed the tested improvement as `d9341e63`.

## Current goal

No active lease. Next run should prioritize live/source drift resolution or a new highest-value P0/P1/P2 item if one is identified; the previously listed P2 backlog is complete.

## Verification

- `node scripts/check-league-analysis-contract.mjs` - pass.
- `node check-league-web-v1.mjs` - pass (includes League learning review).
- `node scripts/check-league-public-page-smoke.mjs` - pass for local markup.
- `node check-active-js-syntax.mjs` - pass for 531 files.
- `git diff --check` and staged/unstaged diff inspection - pass.
- `commit_check` for `refactor: share league selected-role resolver` - pass.

## Known issues / deployment blocker

- Local `main` remains ahead of `origin/main`; the prior frontend role-purity fix, public-page smoke coverage, Data Quality frontend wording fix, Data Quality DOM smoke, deployment-verification documentation, chart metadata change, and shared selected-role resolver refactor are not proven pushed or deployed.
- This cycle changed the static frontend plane but not backend/API code.
- Exact blocker for claiming this cycle live: static frontend changed but no authorized push/static deployment job was invoked or verified. Before claiming live/source parity, push authority and the static deployment job must be confirmed, then the live v294 asset references and affected frontend behavior must be rechecked.

## Notes

- Riot API keys must remain session-only and never be committed, logged, or persisted.
- Production work requires focused verification of every affected plane; otherwise leave code committed with deployment blocker.
