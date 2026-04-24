# GEJAST v659 Feature Phase Matrix — Game Group B bundle

## Bundle implemented

This bundle targets **Phase 9 + Paardenrace/Pikken live-state safety** as the next Game Group B bundle.

| Phase | Workstream | v659 status | Evidence |
|---:|---|---|---|
| 9 | Pikken lobby/live/session-state | Partially implemented | `get_pikken_phase_bundle_v659`, `admin_game_group_b_health.html`, `gejast-game-group-b-bridge.js`, Pikken page/live/stats bridge |
| 9b | Paardenrace lobby/live/input safety | Partially implemented | `get_paardenrace_phase_bundle_v659`, `admin_game_group_b_health.html`, `gejast-paardenrace-input-guard.js`, Paardenrace page/live/stats bridge |

## Boundary

v659 is deliberately **non-destructive**. It does not rewrite Pikken dice/round/vote logic, Paardenrace animation/deck/race engine, room ownership, or live scoring persistence. It adds proof surfaces and the strict Paardenrace input guard rule: form inputs must not be overwritten by polling.
