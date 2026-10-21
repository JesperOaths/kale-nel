# C720P Task #4 storage / Task #5 clock checkpoint
Updated: 2026-10-21, based on current repository checks and cited physical job timestamps (Europe/Amsterdam)
Owner boundary: C720P host storage and NTP only. Preserve S9+ Camera2, 4K buffer, original videos/JPEGs, people/reviews, rollback material; do not own Save/Delete migration.

## Exact last independently observed live state
- Physical **#12365** (2026-10-21 04:16 UTC): **755.1 MiB unprivileged root free**, under 850 MiB guard, priority-rescan worker failed; journal categorized 3 disk-reserve failures and 6 other failures. Do not treat a completed repository PR as storage recovery.
- Physical **#12364** (04:15 UTC): S9+ watching, buffer **8995 ms**, zero dropped frames, 31.2°C; root same **755.1 MiB**. Separate owner working on rescan queue.
- Physical **#12270**: comprehensive read-only root attribution, **852.5 MiB** free at measurement; root 21,368.2 MiB, 19,405.5 MiB used, 1,110.2 MiB root reserved. Active Docker images 4 (7.657 GB) with **0 reclaimable images**; containers nine, six active. /usr 7,677 MiB; hub code/state 1,173.7 MiB; user caches 52.6 MiB. Unprivileged scans of root-owned apt/Docker/log/HA paths were incomplete, not deletion approval.
- Physical **#12272**: three existing cleaners ran **preview only**; kiosk chromium caches 60.5 MiB, Spotify chromium caches 46.9 MiB, total **107.4 MiB** reproducible candidates. Both browser services were active, requiring controlled stop/start and full HA/kiosk post-check. An eligible 5.2 MiB old /tmp artifact is on a **separate filesystem** and would not free C720P root blocks. Headless Chromium cleaner found none.
- Physical **#12363** read-only root hub tree: hub backups ~251 MiB, person-detector ~248 MiB, bin ~157 MiB, authentication ~126 MiB, state ~110 MiB, builds ~55 MiB, logs ~24 MiB, all currently **protected or unproven for deletion**.
- Physical **#12361–12362**: ~/.cache c720p-agent 27.2 MB and individual local log/receipt blobs; authoritative records held in Supabase, but job local cache cleanup remains unapproved until reader retention dependencies are audited.
- Physical **#12366**, last jobs query at 2026-10-21 04:19 UTC: no queued/leased/running agent job at that instant. Confirm anew before any change.

## Task #4 source and execution status
- Source scanner [PR #1001](https://github.com/JesperOaths/kale-nel/pull/1001), `ops/c720p/security-runtime/audit-c720p-root-space-v162.py` physically verified in job #12270.
- Existing [Chromium safe cache workflow](https://github.com/JesperOaths/kale-nel/blob/main/.github/workflows/c720p-browser-cache-reclaim-20261014.yml) runs checked source with existing per-browser stop/start, cache-only allowlist and process guards. Its **push-to-main trigger executes physical --apply automatically**, so do not modify/merge without fresh coordination.
- **Draft PR pending on this branch**: `ops/c720p/reclaim-audited-disposable-20261014.py` now rejects any candidate not on the root filesystem; `ops/c720p/c720p-disposable-contract-v2.py` tests this including foreign mount and symlink refusal. **Do not merge as an ordinary PR**: its existing workflow automatically executes cleanup on main push. Source/CI does not prove live reclamation.
- An attempted guarded remote browser cache cleanup job and later checksum-pinned NTP diagnostic submission were **blocked by the tool safety gate** (not executed; no physical job ID). Do not retry by laundering the same action through GitHub Actions, or infer that missing execution was successful.
- Next authorized action: execute the existing cache-only cleaner through an explicitly available legitimate maintenance channel when unblocked, ensuring recorded before/after free bytes, both kiosk/Spotify services restored and HA 8123, Security relay 8794/8795, archive index generator, worker and camera health verified. If guard stays blocked, retain draft for review; investigate root-owned apt/journal with legitimate admin access only. Never prune Docker images, media or rollback.

## Task #5 source and execution status
- **#12252** physical clock audit: C720P ~**93.6 s slow** to two credible TLS references; NTP disabled/unsynchronized; native Camera2 remained healthy.
- **#12254** and **#12258**: `sudo -n` noninteractive validation and narrowly-scoped `timedatectl set-ntp true` do not have requisite privilege. Timesyncd and Chrony reported inactive. No permission escalation or sudoers changes attempted.
- [PR #995](https://github.com/JesperOaths/kale-nel/pull/995): audit only. [PR #1074](https://github.com/JesperOaths/kale-nel/pull/1074), merge **c859fd0fc70429e6a04e5ccc7dcc359a9430ff9f**: redacted read-only provider/service/config/DNS audit and CI, **not physically deployed** because the job submission was blocked.
- [PR #1069](https://github.com/JesperOaths/kale-nel/pull/1069) creates ephemeral TLS clock calibration; jobs **#12260** (+93.79 s, 3 sources) and **#12261** (+94.65 s, 2 sources) physically verified temporary estimates without adjusting OS time. These are **not NTP repair or signed-action readiness**.
- Existing `ops/c720p/security-runtime/c720p-clock-health-repair-v1.py` can attempt a guarded authorized NTP installation/enable **only if passwordless sudo is already legitimately available**. Current access does not meet its condition; no repair service enabled. No reboot attempted: interruption to live 4K not justified while NTP service is unavailable.
- Next authorized clock action: physically inspect installed provider/config via V252 through legitimate channel, then install/enable timesyncd or chrony via legitimate host administrator; verify OS NTP=yes and NTPSynchronized=yes, offset vs S9+ and two credible independent sources, persistence after provider restart, and strict signed request TTL/HMAC/replay unchanged. Do not use temporary TLS calibration as readiness substitute.

## Task register
| Task | Change or finding | PR / source | Physical jobs | Acceptance |
| --- | --- | --- | --- | --- |
| #4 | Baseline, current 755.1 MiB less than 850 MiB reserve | #1001, V162 | #12270, #12364, #12365 | **BLOCKED**, reserve not recovered |
| #4 | 107.4 MiB browser caches eligible for controlled cleanup, not yet cleaned | Existing browser cache workflow | #12272 dry run | **PENDING**, execution safety block |
| #4 | Avoid deleting cross-mount /tmp as if it freed root | V253 draft on this branch | CI pending; **none deployed** | Source hardening only |
| #5 | Clock ~93–95 s behind, NTP off and no noninteractive authorization | #995/#1062 | #12252, #12254, #12258 | **BLOCKED**, privileged repair not permitted |
| #5 | UTC estimate available but never OS-synchronized | #1069/#1070 | #12260, #12261 | Diagnostic only |
| #5 | NTP config/provider/DNS audit in main | #1074 merge c859fd0 | CI passed, **physical job blocked** | Deployment unverified |

**Never describe storage or NTP workstream as production complete until the actual C720P reports recovered reserve, synchronized and persistent NTP, strict token readiness, and full HA/security/camera health.**
