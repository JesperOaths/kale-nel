# Current League agent state

Last updated: 2026-10-05 22:48 Europe/Amsterdam

## Trial

- Trial expires: 2026-10-11 17:03 Europe/Amsterdam.
- Status: active; do not work after expiry unless renewed.

## Source planes

- Repository path: `C:\Users\jespe\Documents\GitHub\kale-nel`.
- Active source branch: `main`; this cycle's tested result commit is `0fbb7921` (`fix: preserve missing league chart evidence`), preceded by lease commit `a2b5c17f`.
- The push advanced `origin/main` from `72d8f1f4` through all previously tested local League cycles to `0fbb7921`; local and origin were equal before the state-release commit.
- Older `C:\Users\jespe\GitHub` path is not used.

## Live plane

- Live `/league/` fetched after deployment at 2026-10-05 22:46 Europe/Amsterdam returned HTTP 200 from `worker-assets` with `no-store`, v295 `app.js`/`styles.css` markers, public-workspace copy, and session-only Riot-key copy.
- Static workflow run `37370884905` completed successfully, including bundle build, security tests, dry-run packaging, Worker/static deployment, protected perimeter checks, and live public League bundle verification.
- Backend workflow run `37370884913` completed successfully, including League web contract, Deno type-check, and deployment to `printify-gildan-diff-diag-v1`; read-only health returned `ok: true`, `mode: league-api-v1`, `internal_slot: retired-diagnostic-reuse`, `requires_session: false`, and `public_workspace: true`.
- Live/source drift for the League implementation is resolved at `0fbb7921`; Pages and broad certification runs were still queued when this state was recorded, but the production Worker static plane and backend plane were independently verified.

## Completed this cycle

- Fixed chart null handling so missing metric values cannot be coerced into plotted or averaged zeroes.
- Preserved chronological x positions, broke lines at missing observations, and added explicit x-axis missing marks plus unknown-not-zero metadata and SVG accessibility text.
- Added keyboard-focusable, collapsible underlying-value tables with date, champion, value, and unavailable rows for every coaching chart.
- Added `scripts/check-league-chart-gap-accessibility.mjs` and wired it into the main League analysis contract; cache-busted League assets to v295.
- Committed the tested implementation as `0fbb7921` and deployed it through the established push workflows.

## Current goal

No active lease. Next run should add a non-production rendered chart-card fixture so desktop/mobile browser checks can exercise gap marks, the disclosure table, and keyboard focus without requiring Riot credentials or production records.

## Verification

- `node scripts/check-league-analysis-contract.mjs` - pass.
- `node scripts/check-league-chart-gap-accessibility.mjs` - pass.
- `node check-league-web-v1.mjs` - pass (includes League learning review).
- `node scripts/check-league-public-page-smoke.mjs` - pass for local markup and live URL.
- `node check-active-js-syntax.mjs` - pass for 532 files.
- `git diff --check` and staged/unstaged diff inspection - pass.
- `commit_check` for `fix: preserve missing league chart evidence` - pass.
- Live desktop viewport 1441×1000 and narrow viewport 391×844 loaded v295 assets with no console errors; narrow viewport had no horizontal overflow and visible controls remained 44–74px tall.

## Known issues / deployment blocker

- No production deployment blocker remains for the changed static plane; v295 source strings and assets are live and the backend workflow/health are green.
- Chart-specific browser visual proof remains limited because the live browser workspace had no saved report and the cycle correctly avoided creating production analysis records or handling Riot credentials. The executable fixture proves null/gap/table behavior; the exact next action is a local, non-production rendered chart-card DOM fixture for desktop/mobile screenshots and keyboard checks.
- GitHub Pages, `Check League backend`, `Current main certification`, and published-page integrity runs were still queued at the state capture time. They are not used as proof for the already verified Worker-served `/league/` plane.

## Notes

- Riot API keys must remain session-only and never be committed, logged, or persisted.
- Production work requires focused verification of every affected plane; otherwise leave code committed with deployment blocker.
