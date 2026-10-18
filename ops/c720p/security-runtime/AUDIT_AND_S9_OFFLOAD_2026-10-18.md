# Security runtime audit and S9+ offload inventory

Scope: the actual Home Assistant Security route, its embedded pages, camera
capture/control APIs, native microSD and historical Drive catalogs, evidence
workers, derived playback, retention, relay authentication, motion/light
integration and related timers/watchdogs. Layout redesign belongs to the
parallel UI work. This change preserves recording, review and manual-light
features.

## Verified repairs

| Problem | Repair | Evidence |
| --- | --- | --- |
| Evidence coverage watchdog repeatedly failed with 404 | Read the current loopback archive and manual-review API contracts. Count manual profiles explicitly; use the independent face-quality count only while its source snapshot is current. | Live service completed after deployment. |
| Legacy retention imported a retired S3 recorder and assumed unknown recorder health meant idle | Skip a missing recorder only when its service is inactive. Require an explicit successful, boolean idle-health response before retention. Preserve the existing retain function/policy. | Synthetic unavailable/busy/malformed-health cases pass; live dry run and service succeeded, all six legacy videos unchanged. |
| Client disconnects became tracebacks or a second playback error response | Close cancelled requests quietly for BrokenPipe/ConnectionReset only, preserving real exceptions and source-unavailable responses. | Synthetic cancellation and real-error cases pass. Live client resets produced no cancellation traceback; missing/expired credentials returned 401 and valid credentials returned 200. |
| Legacy classifier repeatedly decoded the same unchanged uncertain clip, starving older candidates | Bind completed full scans to exact clip, detector-source and model-file content digests. Reuse completed results, load the detector only when work remains, and retain explicit --force rechecking. | Live cached verification: 1.92 CPU seconds, 19.5 MiB peak and 4.80 seconds wall time, versus 21.20 CPU seconds / 201.1 MiB / 77 seconds before. Both pending clips were processed once; subsequent backlog was zero. Input/model changes and incomplete scans still retry. No deletion or classification thresholds changed. |
| Fully cached evidence refresh still polled every recording and rewrote the cache | Check pending image keys first. Load the pinned detector only for uncached/retry work; checkpoint only changed measurements. | Live cached run: zero phone polls, zero image reads, zero cache checkpoints, no detector load. CPU fell from 4.41 to 0.336 seconds and peak memory from 29.8 to 16.2 MiB in the measured cached run. |
| New-clip fast indexer rejected rich manifests above 14 KB | Use a shared 32 KiB contract in both fast-index paths and the catalog's native manifest decoder. The native full scanner previously accepted these larger files without a bound; its 14 KB restriction belonged to the older archive path. | Six current manifests exceed 14,000 bytes, maximum 15,844. Synthetic rich/boundary/oversized cases pass. Live full catalog and fast-index services completed: 175 originals and an empty error list. |
| A daily watchdog restart opened localhost, outside the kiosk's existing authenticated 127.0.0.1 origin | Set the launcher's default to 127.0.0.1. Preserve its explicit URL override and all browser options. | Reproduced the login-route failure, then performed a real restart and daily watchdog run: authenticated Home restored, service succeeded. No credentials or auth gates changed. |
| The browser recovery helper assumed TCP frame headers arrived in one read and could spin on payload EOF | Read exact frame lengths with EOF detection and a total monotonic deadline; retain the existing recovery actions. | Four segmented-frame, length, EOF and deadline tests pass. Live browser status and screenshot actions succeeded; the private PNG was 680,718 bytes. |

The initial inventory matched 46 loaded camera/security-related services. Five
failed units were investigated: two were already disabled legacy guards, two
were active failing jobs repaired here, and the daily dashboard watchdog's
restart exposed the wrong-origin bug repaired above. Final verification found
zero failed user units. Disabled legacy guards remain disabled; clearing their
old failed states is not a claim that their implementations were repaired.

Clock synchronization is an unresolved administrator action: the hub is about
90 seconds slow, NTP is disabled and its service package is absent. Actual sudo
installation/activation attempts required a password. This can reject freshly
issued media tokens under the existing 60-second future-time check; that is a
mechanism identified in the code, not proof of every earlier login failure. See
[the exact administrator repair](ADMIN_TIME_SYNC_REPAIR.md). Token checks were
not relaxed.

The real authenticated HA route loaded Live, Recordings, People & faces, Tracks
& movement, Evidence & analytics, Archive and four camera-setting controls.
The live image decoded at 640 pixels wide. Loaded recording/track/evidence
images had no broken-image elements in that check. The current People source
intentionally retires the standalone crop gallery. A follow-up that targeted
the old face-pane control therefore did not open a gallery or assign image
URLs; it is not a successful gallery-rendering test. Crop delivery is verified
separately below. Page availability alone does not establish every UI action.

## Measured baseline on the C720P

These are individual observations, not promises about continuous load. Service
CPU times are the last run unless stated otherwise. Wall time includes ADB,
network waits and the existing CPU quotas.

| Component | Observed CPU time | Peak memory / other measurement |
| --- | ---: | --- |
| Legacy no-person full scan | 21.20 s/run | 201.1 MiB; repeatedly the same clip before repair |
| Full SD catalog | 16.34 s/run | 56.8 MiB; 126 s wall time |
| Cached evidence worker before repair | 4.41 s/run | 29.8 MiB; 24 s wall time |
| Fast recent index | 0.284 s/run | 9.6 MiB |
| Visual metadata index | 0.459 s/run | 20.0 MiB |
| Presence metadata worker | 0.556 s/run | 21.7 MiB |
| Complete-clip coordinator | 0.236 s/run | 12.5 MiB |
| Historical phone coordinator | 0.288 s/run | 14.6 MiB |

A 15-second CPU sample measured Whisper at 65.9% of one CPU, wake-word service
at 26.3%, legacy camera classification at 24.8%, kiosk at 18.1%, and the
living-room detector at 0.91%. These workloads overlap; percentages do not sum
to a whole-machine utilization figure. Whisper/wake-word processing is a
separate voice workload, not hidden S9 video inference.

Root storage had 635 MiB free (97% used) at the final check. That favors small bounded derived
caches and streaming jobs rather than copying the original archive onto the
C720P. No original or safe-cache deletion was performed as part of this audit.

## What already runs on the S9+

- Camera2 native 3840×2160 recording, the continuous 4K prepend buffer and
  appended event capture.
- Garden person gating and native scene classification using the phone GPU.
- Historical native recording review, V5 face-candidate extraction, thumbnails,
  and the supported per-clip appearance/movement metadata production.
- Original MP4s, verified sidecars and face JPEGs on microSD.

The hub's small coordinators request/check these phone jobs and publish their
metadata. Moving a coordinator does not newly offload the inference it already
delegates. Pose/runtime fields that report unavailable remain unavailable;
the watchdog does not invent pose or gait measurements.

The phone is an SM-G965F, Android API 29, arm64-capable, with about 5.49 GiB RAM
and 2.15 GiB available in the platform check. No shell python3 or ffmpeg was
found. A Python/desktop-ffmpeg script cannot simply be copied there and expected
to run. Use the existing app/job mechanism or deliberately package a compatible
runtime. Available RAM is a snapshot and capture has priority.

## Prioritized tasks that could move to the S9+

No further compute migration is activated by this audit. This is the requested
candidate list; each row names the work and the integration needed.

| Priority | C720P work / services | Proposed phone work | Expected benefit and requirements |
| --- | --- | --- | --- |
| 1 | On-demand playback conversion in s9_hub_playback.py | Create a bounded 360p/480p browser copy with Android's media pipeline beside the original; serve it through the existing authenticated relay | Avoid hub 4K decode/resize/software H.264 encode. Keep originals intact, single job, bounded microSD cache, expiry, cancellation and byte-range/seek support. Verify actual encoder support, duration, cadence, night material, audio and 4K capture under concurrent load before activation. Existing hub fallback remains available. |
| 2 | Full SD catalog and fast recent index | Publish a versioned incremental metadata catalog from the app after each finalized sidecar, with generation/ETag and bounded deltas | Reduce repeated ADB listings/cat/stat subprocesses and the 126-second full scan. Include deleted/quarantined tombstones, size/digest validation, stable pagination and full reconciliation. Keep hub validation and review storage. |
| 3 | Legacy person-no-person-clean, Drive person revalidation and historical thumbnail generation | Submit a verified historical clip once to a protected phone work directory; return detection/thumbnail metadata | Moves the remaining old-clip decoding/inference away from the hub. The repeated-scan bug is already fixed, so measure the remaining workload before doing this migration. Keep Drive credentials and retention on the hub; bound transfer size, working storage, retries and cleanup. Preserve all manual labels and originals. |
| 4 | Independent crop-content/quality screening and original-gap benchmarks | Run a separately versioned detector/quality audit on the phone and return provenance-bound measurements | Avoids hub JPEG/frame decoding when new images arrive. Preserve the independent check rather than treating the native extractor's output as its own validation. Bind results to exact crop/source/model digests and source time. Reuse measured results. |
| 5 | Contact sheets, thumbnail choice and native brightness/sharpness summaries | Generate them while the phone already has decoded frames | Avoid duplicate decodes and image transfers. Many basic thumbnails are already generated there; move only remaining duplicate work. Return small bounded metadata/images, retaining original timestamps and manual thumbnail choices. |
| 6 | Capture-local daily/hourly duration and scene summaries | Incrementally aggregate phone-native event metadata | Modest CPU benefit: these are cheap calculations. Use Amsterdam 06:00 boundaries and versioned counters; preserve per-source provenance. Keep cross-source Drive/manual-review joins on the hub. Counts remain recording counts, not people counts or continuous dwell time. |
| 7 | Read-only native recording integrity/space/quarantine candidate checks | Produce an on-phone integrity and storage report | Phone-local stat/digest work reduces repeated ADB round trips. Initially reporting only; keep delete approval, protected/manual-review rules and an auditable policy on the hub. Never silently promote a detection failure into deletion. |
| Separate pilot | Whisper speech-to-text (and possibly synthesis) | Dedicated arm64 audio worker reachable by the hub | Could address a larger measured CPU load than metadata workers. Requires compatible native packaging, microphone/audio transport, response-latency and accuracy tests, and capture-priority/resource limits. This is outside the camera repair rollout; the always-listening microphone/wake path and fallback remain on the hub. |

Start with playback-copy generation and the incremental catalog protocol. They
remove actual video/subprocess work. Do not start by relocating low-cost
watchdogs or small JSON joins merely to increase the number of moved services.

## Processes that should stay on their current device

| Work | Reason |
| --- | --- |
| Home Assistant, signed media authorization, LAN/tunnel ingress and administrator agent | Central access control, integrations and an independent recovery route must remain available when the phone is busy or offline. |
| Manual person/review database, review intent validation and Drive credentials | These are authoritative user decisions and account access, not camera compute. The phone receives only the task inputs it needs. |
| Living-room lamp ownership/timeout and C720P front-camera capture | The optical viewpoint is inside the room. The garden phone is not a replacement sensor. Preserve manual ON overrides and the existing ten-minute camera-owned timeout. |
| Bedroom motion and privacy boundary on the S3; HA five-minute ownership timer | Keep bedroom pixels on the bedroom device. Do not create a bedroom live-feed export to the garden phone. Preserve manual lamp overrides. |
| Kiosk, screen-idle/lid recovery, browser health and local microphone wake path | They operate C720P-local hardware or must function during a camera/phone failure. |
| Signed app upgrades, ADB recovery and thermal/capture supervision | The supervisor should survive a phone app crash. A completed V5 cool-window installer is management plumbing, not continuous inference waiting to be offloaded. |

## Runtime inventory by responsibility

This grouping includes the connected background services checked in the audit;
it does not propose removing any of them.

- Capture/preview: frontyard-security-new, retired frontyard-security,
  s9-native-camera-bridge, s9-go2rtc, lan-camera-relay and its watchdog.
- Access/serving: drive-security-archive, security-web, security-tunnel and its
  watchdog, security-posture-guard, security-self-audit, post-security-reboot-probe.
- Catalog/evidence: s9-local-sd-catalog, s9-fast-recent-clips,
  s9-complete-clip-worker, s9-historical-v28, s9-visual-index-v36,
  s9-person-presence-v44, s9-evidence-quality, s9-evidence-quality-audit,
  s9-preroll-verification, s9-face-v5-cool-window.
- Archive policy/legacy work: archive-quota-trim, drive-archive-thumb-backfill-v1,
  drive-person-revalidate, drive-security-upload (inactive by storage policy),
  drive-value-retention, security-value-retention, motion-thumbnails,
  person-no-person-clean, midnight-security-cleanup, s9-quarantine-prune,
  security-disk-guard.
- Device/power: camera-android-power-save, camera-auto-profile,
  camera-battery-notifier, camera-return-watch.
- Room/hub continuity: frontcam-motion-living-lamp, s3-privacy-watchdog,
  screen-idle, lid-recovery, home-hub-kiosk, kiosk-health-watchdog,
  kiosk-renderer-watchdog, dashboard-watchdog, homeassistant-gai-guard,
  homeassistant-mdns-alias. The disabled old home-live-contract and s9-edge
  guards were inspected without restarting their retired implementations.

## Rollout and verification record

- PR #767 contains the backend repairs and backend-only regression CI.
- Runtime activation job 11487: immutable source
  55af3b9dd311b8f812463f4c75a09fd29dec703a, passed 34 staged tests, verified 175
  originals, unchanged manual reviews and all six legacy MP4s. Capture was ready,
  watching, 32.6°C, with zero dropped output frames.
- Catalog-bound activation job 11491: source
  90be5c6d754f1368dce475fceca2183ecaf57b1c, eight staged tests, 175 recordings,
  no catalog errors and both timers restored.
- Playback response/source separation job 11494: source
  f5c112c56e50d5f61ce3dcbbc2ae432c64704519, twelve staged tests and 175 originals.
- Legacy content-cache activation job 11500: source
  aee43a9ea227a91b0b114018b7f52c3c9152f1df, fourteen staged tests, pending legacy
  scans 2 → 1 → 0, then a successful cached run without detector import.
- Manual-profile counter activation: source
  6f27abb66fc2864c20c55368a91fda53732fa0fc. Live coverage audit succeeded with
  175 recordings, 20 manual profiles and 16 independently supported crops.
- Kiosk-origin activation and real restart: source
  df86daedab257c927d5ff023218df9cfd9fc99fd. The daily watchdog passed after
  restart, retaining the already authenticated 127.0.0.1 profile origin.
- CDP transport activation: source
  d58e5aee810e283eaf599f25492a6d7659be208e. Four transport tests and live browser
  status/screenshot actions passed.
- Independent origin checks in job 11490: missing/expired credentials returned
  401, valid credentials returned 200, and deliberate client resets produced no
  BrokenPipe/ConnectionReset traceback in either HTTP service.
- Complete media check, job 11504: all 175 native originals answered HEAD with
  the expected size/type; 12 byte-range requests returned 206 with the expected
  512 bytes. All 16 supported crop JPEGs matched their recorded size/digest.
  The evidence snapshot was current. All 175 recordings had completed V5;
  there were 602 candidate crop references, not 602 verified faces or people.
- Historical Drive remains read-only and available: 94 recordings, three
  sampled video HEAD requests returned 200. Opened archive UI, job 11516:
  19 date groups and 14 loaded previews, zero broken previews. The Drive
  uploader remains inactive under the existing storage policy.
- Bounded post-restart browser check, job 11517: Live repeatedly reported
  "S9+ watching" and decoded a 640-pixel preview; the kiosk was restored to
  Home after inspection. The attempted standalone face gallery showed no
  requested images. Source inspection, job 11519, established that this
  gallery/control is intentionally retired in the current People UI. No UI
  patch or gallery-rendering success is claimed by this audit.
- Room/privacy check, jobs 11505 and 11516: living-room camera-owned start and
  refresh use ten minutes; bedroom uses five minutes. Source guards preserve
  manual ON ownership. No physical walk/manual-switch test was performed and
  no light was toggled. S3 Wi-Fi ADB and image-export ports were closed or
  unreachable; the privacy watchdog accessed no images. Its camera health
  file was stale, so a current bedroom frame heartbeat was not established.
- Final camera status: watching, continuous 4K ready, zero dropped output
  frames, 32.6°C and no reported error. Final user-service failed count: zero.
- Local regression verification: 71 tests across runtime, TCP transport,
  manifest bounds, fast indexing, evidence quality, face pipeline and snapshot
  integrity. The added runtime CI executes 49 tests plus Python compilation
  and shell syntax checks; the existing face/pipeline checks also passed.

Exact rollback material remains on the managed hub in the private deployment
backup directory. Deployer source pins and live predecessor checks prevent this
change from overwriting newer runtime work. No HTML/CSS/JavaScript, APK, camera
configuration, original MP4 or manual review is a deployment target here.
