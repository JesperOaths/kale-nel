# Current League agent state

Last updated: 2026-10-04 20:01 Europe/Amsterdam

## Trial

- Trial expires: 2026-10-11 17:03 Europe/Amsterdam.
- Status: active; do not work after expiry unless renewed.

## Source planes

- Repository path: `C:\Users\jespe\Documents\GitHub\kale-nel`.
- Active source branch: `main`; this cycle's tested result commit is `5a61876e` (`test: cover compact league report cohorts`), followed by a docs-only state/lease release commit.
- `origin/main` remains `72d8f1f4`; after the docs-only release commit, local `main` is four commits ahead with the prior role-purity repair, two bounded-cycle state commits, and this cycle's fixture coverage.
- Older `C:\Users\jespe\GitHub` path is not used.

## Live plane

- Live `/league/` fetched and browser-checked at 2026-10-04 19:59 Europe/Amsterdam returned HTTP 200, rendered the public League workspace and session-only Riot key copy, and logged no browser errors.
- Production still serves the v294 League asset family; this cycle changed tests and agent docs only.
- No deployment was attempted because no production plane was affected by this cycle.

## Completed this cycle

- Added executable compact saved-report fixtures in `scripts/check-league-saved-report-cohort-fixtures.mjs`.
- The fixture evaluates the actual frontend cohort helpers and proves selected-role filtering happens before mechanics filtering, role aliases remain supported, unknown/missing roles fail closed, mixed-mechanics fallback widens mechanics only, summary-role fallback stays strict, and malformed game arrays return an empty cohort.
- Guarded visual summaries/champion cards, match history, consistency summaries, and coaching charts against bypassing the shared `reportCoachingGames(r)` cohort.
- Wired the fixture into `scripts/check-league-analysis-contract.mjs` and committed it as `5a61876e`.

## Current goal

No active lease. Next run should take the P1 public-page browser smoke unless a higher-priority correctness or drift failure appears.

## Verification

- `node scripts/check-league-saved-report-cohort-fixtures.mjs` — pass.
- `node scripts/check-league-analysis-contract.mjs` — pass.
- `node check-league-web-v1.mjs` — pass.
- `node check-active-js-syntax.mjs` — pass (`Files checked=529`).
- `git diff --check` and staged diff inspection — pass.
- `commit_check` for `test: cover compact league report cohorts` — pass.

## Known issues / deployment blocker

- Local `main` is three commits ahead of `origin/main`; the prior frontend role-purity fix is therefore not proven deployed.
- Exact blocker: no authorized push/deployment workflow was invoked or verified in this cycle. Before claiming parity, push authority and the static deployment job must be confirmed, then the live v294 asset references and affected frontend behavior must be rechecked. This test-only cycle itself requires no production deployment.

## Notes

- Riot API keys must remain session-only and never be committed, logged, or persisted.
- Production work requires focused verification of every affected plane; otherwise leave code committed with deployment blocker.
