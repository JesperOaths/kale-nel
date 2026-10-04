# Current League agent state

Last updated: 2026-10-04 17:23 Europe/Amsterdam

## Trial

- Trial expires: 2026-10-11 17:03 Europe/Amsterdam.
- Status: active; do not work after expiry unless renewed.

## Source planes

- Repository path: `C:\Users\jespe\Documents\GitHub\kale-nel`.
- Active source branch for this run: `main` fast-forwarded to `origin/main` at `72d8f1f4` (`League v294: finish web contract migration for target lineage`).
- Older `C:\Users\jespe\GitHub` path is not used.

## Live plane

- Live `/league/` fetched at 2026-10-04 17:11 Europe/Amsterdam returned HTTP 200 and visible text for the League analysis page.
- Local source advertises `/league/styles.css?v=20261004-league-web-v294` and `GEJAST_PAGE_VERSION='v817'`.
- No deployment was attempted in this maintenance cycle.

## Completed this cycle

- Repaired the local League analysis contract failure found on the first trial run.
- `renderVisualSummary` now uses `reportCoachingGames(r)` as its explicit source cohort.
- Match history now derives its source list from the role-pure, mechanics-cohort-aware `reportCoachingGames(r)` path instead of raw `r.games`.
- Committed initial trial mission/state docs and the frontend cohort fix in `22ca4385`.

## Current goal

No active lease. Next run should pick the highest-value P1 backlog item unless the user changes priorities.

## Notes

- Riot API keys must remain session-only and never be committed, logged, or persisted.
- Production work requires focused verification of every affected plane; otherwise leave code committed with deployment blocker.
