# Current League agent state

Last updated: 2026-10-04 21:22 Europe/Amsterdam

## Trial

- Trial expires: 2026-10-11 17:03 Europe/Amsterdam.
- Status: active; do not work after expiry unless renewed.

## Source planes

- Repository path: `C:\Users\jespe\Documents\GitHub\kale-nel`.
- Active source branch: `main`; this cycle's tested result commit is `f361faf8` (`test: add league public page smoke`), followed by a docs-only state/lease release commit.
- `origin/main` remains `72d8f1f4`; after the docs-only release commit, local `main` is six commits ahead with the prior role-purity repair, compact-report fixture coverage, public-page smoke coverage, and bounded-cycle state commits.
- Older `C:\Users\jespe\GitHub` path is not used.

## Live plane

- Live `/league/` fetched at 2026-10-04 21:04 Europe/Amsterdam returned HTTP 200 with `/league/styles.css?v=20261004-league-web-v294`, `GEJAST_PAGE_VERSION`, Riot/session-only copy, and no new source changes from this cycle.
- Browser check at 2026-10-04 21:15 Europe/Amsterdam rendered the public League workspace, `Backend + Riot ready`, `No Kalenel login required`, and `Riot API key is session-only`; browser error log returned zero errors.
- Production still serves the v294 League asset family; this cycle added a smoke-test script and agent docs only.
- No deployment was attempted because no production plane was affected by this cycle.

## Completed this cycle

- Added `scripts/check-league-public-page-smoke.mjs`, a dependency-free smoke guard for local League markup plus optional live HTTP verification via `KALENEL_LEAGUE_SMOKE_URL=1`.
- The smoke proves the public League page keeps its main landmark, no-login copy, session-only/non-saved Riot key copy, password Riot key input, indexable robots metadata, no private Kalenel login/session gates, and live `app.js`/`styles.css` asset availability.
- Committed the tested improvement as `f361faf8`.

## Current goal

No active lease. Next run should take the P1 Data Quality wording improvement unless a higher-priority correctness or drift failure appears.

## Verification

- `node scripts/check-league-public-page-smoke.mjs` - pass.
- `KALENEL_LEAGUE_SMOKE_URL=1 node scripts/check-league-public-page-smoke.mjs` - pass against `https://kalenel.nl/league/`.
- `node scripts/check-league-analysis-contract.mjs` - pass.
- `node check-league-web-v1.mjs` - pass.
- `node check-active-js-syntax.mjs` - pass (`Files checked=530`).
- `git diff --check` and staged/unstaged diff inspection - pass.
- Browser `https://kalenel.nl/league/` check - rendered public page and returned zero browser errors.
- `commit_check` for `test: add league public page smoke` - pass.

## Known issues / deployment blocker

- Local `main` remains ahead of `origin/main`; the prior frontend role-purity fix and subsequent test coverage are therefore not proven pushed or deployed.
- Exact blocker: no authorized push/deployment workflow was invoked or verified in this cycle. Before claiming parity, push authority and the static deployment job must be confirmed, then the live v294 asset references and affected frontend behavior must be rechecked. This test-only cycle itself requires no production deployment.

## Notes

- Riot API keys must remain session-only and never be committed, logged, or persisted.
- Production work requires focused verification of every affected plane; otherwise leave code committed with deployment blocker.
