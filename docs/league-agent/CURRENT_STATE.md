# Current League agent state

Last updated: 2026-10-05 12:20 Europe/Amsterdam

## Trial

- Trial expires: 2026-10-11 17:03 Europe/Amsterdam.
- Status: active; do not work after expiry unless renewed.

## Source planes

- Repository path: `C:\Users\jespe\Documents\GitHub\kale-nel`.
- Active source branch: `main`; this cycle's tested result commit is `efbf3211` (`docs: document league deployment verification planes`), followed by a docs-only state/lease release commit.
- `origin/main` remains `72d8f1f4`; after the improvement commit and before the docs release commit, local `main` is eleven commits ahead with the prior role-purity repair, compact-report fixture coverage, public-page smoke coverage, Data Quality wording repair, Data Quality DOM smoke coverage, deployment-plane verification documentation, and bounded-cycle state commits.
- Older `C:\Users\jespe\GitHub` path is not used.

## Live plane

- Live `/league/` fetched at 2026-10-05 12:04 Europe/Amsterdam returned HTTP 200 with the public League workspace and Riot/session-only copy.
- Production was not deployed in this cycle. The improvement is documentation-only and changes no production plane.
- Existing live/source drift remains: production still serves the v294 League asset family while local frontend/test/doc commits are ahead of `origin/main`.

## Completed this cycle

- Added `docs/league-agent/DEPLOYMENT_VERIFICATION.md` with separate static `/league/` and `league-api-v1`/Supabase function verification checklists.
- Documented the current function-slot drift explicitly: frontend traffic uses `/functions/v1/printify-gildan-diff-diag-v1` while `league-api-v1` remains the source name because the Supabase project is reusing a diagnostic slot.
- Captured blocker wording for unverified static or backend planes so future runs do not claim parity from a push, a static smoke, or a function health check alone.
- Committed the tested improvement as `efbf3211`.

## Current goal

No active lease. Next run should take the highest-value remaining P2 item unless a higher-priority correctness or drift failure appears.

## Verification

- `node scripts/check-league-public-page-smoke.mjs` - pass for local markup.
- `node check-league-web-v1.mjs` - pass (includes League learning review).
- `git diff --check` and staged/unstaged diff inspection - pass.
- `commit_check` for `docs: document league deployment verification planes` - pass.

## Known issues / deployment blocker

- Local `main` remains ahead of `origin/main`; the prior frontend role-purity fix, public-page smoke coverage, Data Quality frontend wording fix, Data Quality DOM smoke, and this deployment-verification documentation are not proven pushed or deployed.
- This cycle itself changed only docs, so it has no affected production plane and no deployment requirement.
- Exact blocker for claiming overall live/source parity remains: no authorized push/deployment workflow was invoked or verified. Before claiming parity for existing frontend drift, push authority and the static deployment job must be confirmed, then the live v294 asset references and affected frontend behavior must be rechecked.

## Notes

- Riot API keys must remain session-only and never be committed, logged, or persisted.
- Production work requires focused verification of every affected plane; otherwise leave code committed with deployment blocker.
