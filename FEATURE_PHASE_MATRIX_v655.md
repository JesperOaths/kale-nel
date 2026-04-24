# GEJAST v655 Feature/Phase Matrix

## Base repair status

Implemented in the v655 patch bundle, not yet proven live unless the bundle is uploaded/committed/deployed and browser checked.

| Base item | Status | Evidence | Remaining proof |
|---|---|---|---|
| Version alignment | Implemented in patch | VERSION, gejast-config.js, page version declarations, script cache-busters, and watermarks are bumped to v655. | Verify GitHub main and deployed page source after upload. |
| Admin navigation | Implemented in patch | admin.html links the repair-first diagnostic pages. | Verify live admin hub is the uploaded Beheerhub version. |
| Public-page performance | Partially implemented | Perf guard helper and System Health page exist. | Run browser/runtime checks; static files cannot prove speed. |
| Stale diagnostic runtimes | Implemented in patch for known diagnostic pages | Diagnostic admin pages and helper script refs are v655. | Verify DevTools loads v655 assets after deploy. |
| GitHub-vs-deployed mismatch | Not closable by static patch alone | Patch provides aligned files. | Commit/upload/deploy, then compare GitHub main vs kalenel.nl source/runtime. |

## Feature/phase statuses

| Phase | Feature/workstream | Status | Reason | Next action |
|---:|---|---|---|---|
| 0 | Base repair/version/config/admin/performance drift | Implemented in patch, needs live proof | v655 patch aligns static files and adds diagnostics. | Deploy then run System Health. |
| 2 | Cross-game stats | Partially implemented | Shared/profile/ladder surfaces exist, but end-to-end stats are not proven. | Trace pages to RPCs and SQL cache. |
| 3 | Implementation matrix / owner audit | Implemented in patch | Admin page and JS matrix exist. | Use it as review checklist. |
| 4 | System health/version/gates/boot/performance | Partially implemented | Browser helpers exist; SQL audits depend on live admin/RPC. | Run after deploy/admin login. |
| 5 | Identity/dropdowns/profiles/avatars/badges | Partially implemented | Helpers and admin page exist; runtime profile/badge behavior unverified. | Test real sessions and profile pages. |
| 6 | Drinks surfaces | Partially implemented | Pages exist; verification/unit/speed/push behavior unverified. | Drinks-specific runtime/RPC audit. |
| 7 | Shared stats framework | Partially implemented | Admin page/helpers exist; SQL cache not proven. | Run shared stats audit. |
| 8 | Klaverjassen shared stats | Partially implemented | Core pages exist; advanced shared stats not proven. | Trace scorer/live/leaderboard/RPC chain. |
| 9 | Pikken | Partially implemented | Pikken page set exists; lobby/live/RPC state not proven. | Verify create/join/state/hand RPC flow. |
| 10 | Beerpong full implementation | Partially implemented | Beerpong surfaces exist; full behavior not proven. | Beerpong-specific trace before patching. |
| 11 | Boerenbridge full implementation | Partially implemented | Boerenbridge pages exist; draft upsert/live/finalization not proven. | Trace live/write/read/finalize chain. |
| 12 | Klaverjassen cleanup/shared stats continuation | Present but unlinked/not proven | Legacy quick-stat/scorer references exist. | Compare current pages to legacy/reference files. |
| 13 | Auto Beurs / Despimarkt markets | Present but unlinked/not proven | Despimarkt pages exist; market SQL/RPC auto creation unverified. | Keep as separate subsystem patch. |
| 14 | Ops observability/release readiness/rollback/smoke | Partially implemented | Ops page/helper exist; live error/smoke data unverified. | Run deployed smoke checks. |

## Boundary

This matrix is static repo/patched-file evidence. It deliberately does not claim Supabase, browser, iPhone, Android, or deployed runtime success until those checks are actually run.
