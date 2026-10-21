# V323 inactive Security playback preview — 21 October 2026

This is a source-only checkpoint, not production activation.

- Active protected People UI remains V50/V320. Its JavaScript SHA256 is `7ed25925a7785cf4267b0f0ff8234b3b5ce40b21f07d899d9e9057b8baf8e1b7`.
- Inactive V323 JavaScript installed on C720P with SHA256 `436d2eb4696872f5149e8a48b4267abcfc57d6eaacd8f2dae1403e42d412045b`; companion V53 HTML SHA256 `ba43e983cb677881c2d599033ad5cba3650a09c46100e6ce75b98c594004e720`.
- V323 rejects non-GET/HEAD relay calls, adds a read-only warning, one bounded signed-URL recovery attempt, and distinguishes 4K decode error from network failure. Chromium regression tests: 10 recovery assertions, denied POST, rendered read-only banner and synthetic errors. No real 4K transcode or signed remote expiry acceptance.
- Physical C720P checkpoint: `/home/jespern/c720p-home-hub/reports/playback-20261021/FINAL_UI_RELAY_ACCEPTANCE_CHECKPOINT.md`. Original staged files: `/home/jespern/c720p-home-hub/build/security-v323-readonly-20261021/`.
- **Critical new blocker**: at ~10:29 CEST root `/dev/sda2` had **0 MiB available / 100% used**, down from ~1007 MiB at 10:21. Existing `c720p-security-disk-guard.service` was invoked once and failed. Individual authorized SSH commands became intermittently rejected or timed out. No media, review, camera or other protected data was removed. UI/relay deploy must be frozen until the storage owner restores reserve and validates producers.
- The 48 historical manual reviews remain unbound; no writer or Save/Delete activation was performed.

Follow-up: reconcile current active writes and source/deployed hashes; restore >1 GiB root reserve safely; then validate actual V323 on real authenticated non-loopback expiry/frozen live/reconnect, and a source-preserving 4K-compatible verified derivative before considering activation. Do not downgrade production or weaken storage, thermal or worker guards.

## Subsequent read-only incident verification

- The private infrastructure command application stopped responding, so no destructive cleanup, restarts or further deployments were attempted.
- Independent private health readback remained fresh (approximately two minutes of publisher delay) and reported `disk.free_mb=0` and `used_percent=99.9` at 08:48 UTC (10:48 CEST). This corroborates the zero-free-space SSH measurement; no recovery can be claimed.
- Aggregate health reported 32 failed user units. The legacy camera's health route reported `camera_ok=true`, `recording=false`, `disk_free_mb=0` at the same snapshot. S3 was unavailable. These are status observations, not confirmation of S9+ recording failure.
- Private remote camera probe was failing with HTTP 530 around 08:40 UTC; the exposed health projection is not browser playback acceptance.
- Local retention diagnostic reported `emergency_active=true`, zero eligible candidates and no deletions. Do not treat protected originals as disposable or lower reserve thresholds.
- The inactive V323 preview remains blocked from activation; live production V50/V320 has not been changed by this incident response.
