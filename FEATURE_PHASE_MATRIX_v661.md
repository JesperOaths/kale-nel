# GEJAST v661 Feature Phase Matrix — Despimarkt / Beurs bundle

## Bundle implemented

This bundle targets **Phase 13** after the drinks/push bundle.

| Phase | Workstream | v661 status | Evidence |
|---:|---|---|---|
| 13 | Auto Beurs / Despimarkt markets, wallet, ledger and admin proof | Partially implemented | `admin_despimarkt_health.html`, `gejast-despimarkt-phase-bridge.js`, `get_despimarkt_phase_summary_v661`, `get_despimarkt_market_read_v661`, `admin_get_despimarkt_audit_v661` |

## Boundary

v661 is deliberately non-destructive. It does not replace `gejast-despimarkt.js`, market creation, bet placement, wallet mutations, settlement, promotional backing, Dry Dock, or debt logic. It adds proof/read/audit surfaces and route panels so the subsystem can be verified before deeper mutation work.
