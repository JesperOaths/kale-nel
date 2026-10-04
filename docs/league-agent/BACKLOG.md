# League maintenance backlog

Prioritize analytical correctness, role purity, evidence quality, and production parity before visual polish.

## P0

1. Keep `scripts/check-league-analysis-contract.mjs` passing; any failure means the report may misrepresent role/mechanics evidence.
2. Keep saved-report and frontend-derived cohorts role-pure and mechanics-cohort-aware.
3. Keep live/source deployment drift explicit; do not claim deployment until static assets and backend/API planes are verified.

## P1

1. Expand focused fixtures around compact saved reports so visual summaries, match history, champion cards, and coaching charts all consume the same role/mechanics cohort.
2. Add a lightweight browser smoke for `/league/` that verifies the public page loads without private login gates and shows the session-only Riot key copy.
3. Improve report Data Quality wording for small samples and unsupported queues where users could otherwise over-trust descriptive rates.

## P2

1. Improve chart readability without changing analysis semantics.
2. Reduce duplicated frontend cohort logic once contract coverage is stable.
3. Document deployment-plane verification steps for `/league/` static assets and `league-api-v1` separately.
