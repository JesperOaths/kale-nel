# League maintenance backlog

Prioritize analytical correctness, role purity, evidence quality, and production parity before visual polish.

## P0

1. Keep `scripts/check-league-analysis-contract.mjs` passing; any failure means the report may misrepresent role/mechanics evidence.
2. Keep saved-report and frontend-derived cohorts role-pure and mechanics-cohort-aware.
3. Keep live/source deployment drift explicit; do not claim deployment until static assets and backend/API planes are verified.

## P1

1. [done 2026-10-04, `5a61876e`] Expand focused fixtures around compact saved reports so visual summaries, match history, champion cards, and coaching charts all consume the same role/mechanics cohort.
2. [done 2026-10-04, `f361faf8`] Add a lightweight public-page smoke for `/league/` that verifies local no-login/session-only Riot-key copy and optional live HTTP asset availability.
3. [done 2026-10-05, `78eb8ac0`] Improve report Data Quality wording for small samples and unsupported queues where users could otherwise over-trust descriptive rates.

## P2

1. Improve chart readability without changing analysis semantics.
2. Reduce duplicated frontend cohort logic once contract coverage is stable.
3. Document deployment-plane verification steps for `/league/` static assets and `league-api-v1` separately.
4. Add a fixture or DOM smoke for rendered Data Quality cards with thin, unknown, and unsupported-queue states.
