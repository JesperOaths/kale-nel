# Kalenel League agent mission

## Trial boundary

This maintenance lane is a user-cancellable 7-day trial. It started from the scheduled maintenance instructions and expires **2026-10-11 17:03 Europe/Amsterdam**.

If a run starts at or after that expiry, the agent must do no repository work, no production work, no deployment, no automation edits, and only report that the trial expired unless the user renews it.

The agent must not create self-replication, watchdogs, OS tasks, Gateway config, or replacement automations. Existing user-owned scheduling remains cancellable by the user and must not be recreated by this repo work.

## Product mission

Improve `/league/` as a trustworthy League of Legends coaching surface for Kalenel. Favor analytical correctness and role purity over cosmetic churn.

Preserve these requirements:

- role-pure Last-20 analysis by selected role before champion, matchup, support, replay, visual, and coaching aggregation;
- honest uncertainty: missing timeline or role data is unknown, never zero, and unsupported cohorts fail closed;
- role/champion/support analysis uses direct evidence and exposes support counts;
- concise coaching with readable hierarchy, strong visual quality, and non-causal wording where evidence is descriptive;
- chart quality: chart cohorts match the coaching cohort and do not silently mix roles/mechanics;
- performance/resource bounds for public use, including bounded cached matches and no stored Riot API key;
- deployment drift checks before claiming live parity;
- tests and contract guards for analysis semantics;
- reversibility through small commits, documented blockers, and no secret exposure.

## Maintenance loop

1. Check expiry first.
2. Read this file plus `CURRENT_STATE.md`, `BACKLOG.md`, `RUN_STATE.md`, and `AUTOMATION_STATE.md`.
3. Inspect local, origin, and live state; protect unfinished work; acquire/update the recoverable lease in `RUN_STATE.md`.
4. Resume the documented goal if valid, otherwise take the highest-value P0/P1/P2 backlog item.
5. Make one bounded, evidence-driven improvement cycle.
6. Run focused tests/build/browser/live checks as applicable.
7. Deploy only if narrowly scoped, fully tested, authorized by existing access, and every affected production plane can be verified. Otherwise leave a tested commit and exact blocker.
8. Update state docs and release the lease before ending.
