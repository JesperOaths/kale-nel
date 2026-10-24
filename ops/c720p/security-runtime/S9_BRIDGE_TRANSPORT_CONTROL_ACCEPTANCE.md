# S9+ native bridge, wireless topology and camera lifecycle — corrected 2026-10-24

**Source-only procedures and diagnostic code. No camera-control authorization or restart.**
Infrastructure owner: Chat 1. Task9 observer/inference: Chat 2 PR #1179.
Playback/Save/review UI: Chat 3. Preserve the installed camera and original media.

## Actual transport topology (USB is OPTIONAL)

1. **Direct wireless:** C720P ADB server -> SM-G965F at
   `192.168.178.250:5555`; its localhost TCP forward maps
   `127.0.0.1:18808 -> device 127.0.0.1:8808`. This route provided verified
   bounded reads at 19:01-19:03 CEST and at 19:05 CEST on October 24. It is
   presently the demonstrated first-choice route. These successes do not
   demonstrate a continuous control transaction or 4K ring readiness.
2. **Optional identity-checked S3 peer relay:** Existing installed
   `c720p-s9-peer-bridge.py` exposes a potential S3 listener
   `192.168.178.47:15555 -> S9:5555`. It validates the exact SM-G965F
   **model and device serial** on the bridged transport and also has
   non-ADB camera relays. `c720p-newcam-adb-pro-watchdog.py` documents
   preferring S3 when direct WLAN cannot reach S9, falling back to
   mDNS/neighbor-discovered direct candidates. Both relevant maintenance
   timers were observed **disabled**; at 19:06 ADB listed only the direct
   S9 transport, S3 neighbor entry was STALE and no current peer proof
   existed. Thus peer reachability and reliability remain **unverified**.
   Do not run the peer script solely as a health check: it reconnects clients
   and may create S3 listeners. Do not probe old Toybox nc -L listeners
   with a raw TCP connection; a probe can consume a one-shot accepted session.
3. **Optional direct S9 USB:** For cases where authorized network routes
   cannot provide an acceptably reliable management channel, use a data
   cable and unique SM-G965F USB serial. A separately prepared read-only
   diagnostic can validate dedicated USB `18809 -> 8808` without switching
   USB back to Wi-Fi. **Physical USB is not established as necessary.** The
   PHILIPS flash drive is archival storage, not the S9 cable.
4. The installed October-13 `20-recover-authorized-s9-usb.conf` overrides
   the repo's original `Type=oneshot` `adb connect; adb forward` with
   `recover-authorized-s9-adb-from-usb-v1.py`. This helper FIRST tries
   direct wireless. Its conditional USB fallback runs `adb tcpip 5555`
   then reconnects **over wireless**; it is not a retained wired session.
   Do not overwrite this owner-managed override to deploy repo source.

The bridge `Type=oneshot` becomes inactive/dead after setup; the separate
ADB server retains the listener. `OnUnitInactiveSec=75s`,
`RandomizedDelaySec=10s`, `AccuracySec=1min` are repair intervals,
not a connection reservation. An exit status 0 or momentary HTTP200 is
**not** a liveness guarantee over a later camera STOP/START. The shared
ADB daemon was the same long-lived instance during observed disconnections;
active S5 scripts inspected did not demonstrate killing it. Root cause of
intermittent phone Wi-Fi/adbd loss is not proven by host NIC counters.

## Read-only differential diagnosis

`python3 ops/c720p/security-runtime/s9-native-bridge-readonly-check-v1.py`

It uses two bounded samples of the existing **direct wireless** ADB device,
exact SM-G965F model **and owner-pinned device serial 27bb603837047ece**,
exact 18808 forward and camera-frame advancement; both device identity and
forward mapping are rechecked after the interval. A status
failure triggers a *read-only after-failure discrimination*:
- ADB `get-state` not device -> transport loss.
- ADB alive, the mapping gone -> missing forward.
- ADB alive and forward **listed**, but /status unavailable -> **recorder
  API unavailable while the mapping is listed**. This may mean normal
  CameraService shutdown, unresponsive phone API, or broken forwarding;
  it does NOT establish an ADB transport disconnect or prove Camera2 stopped.
- All checks pass -> bounded liveness only; never an exclusive lease,
  permission to STOP, or Task9 admission.

`test_s9_native_bridge_readonly_check_v1.py`: **13/13 offline fixture
tests pass**, including API-only refusal, forward loss, ADB transport loss,
initial wrong serial and changed serial between observations.
No live phone call is required for these tests. The code must not be wired
directly to `ExecStartPost` for all modes: it presently expects `watching`,
whereas a healthy service can legitimately be `recording`.

The separate `s9-direct-usb-transport-preflight-v1.py` is *optional*
and source-only. Its preflight does not convert USB to Wi-Fi; `--prepare`
only installs a dedicated non-rebinding forward when explicitly authorized.
It cannot reserve a management transaction. All seven USB offline tests passed,
but no physical S9 USB acceptance has been established.

**Do not reroute any previously rejected phone-inspection operation.**
Previously denied phone memory/4K/thermal inspection remains denied in the
same circumstance regardless of possible direct, peer or USB paths.

## Android STOP / START lifecycle — tracked source vs installed package

`CameraActivity.java` binds the **Stop native service** button to
`startForegroundService(Intent(CameraService.class).setAction("STOP"))`.
`CameraService.java::onStartCommand` receives STOP, persists
`native.enabled=false` and **posts** `shutdown()` to the camera handler
asynchronously; returning `START_NOT_STICKY` is not proof that the handler
has finished. `shutdown()` finalizes a live recording where possible,
closes camera, encoder and socket `127.0.0.1:8808`, then calls
`stopForeground(true); stopSelf()`. The app's **Linux PID need not exit**.
Do not infer service lifecycle merely from an unchanged PID.

After normal STOP, losing /status can be **expected** even while ADB
`get-state=device` and forward mapping remain listed. A synchronous
START before teardown has been acknowledged can hit
`if(running) { Log.i("Already running"); return START_STICKY; }` and
race with the queued shutdown. A blind three-second delay is insufficient
evidence that the previous CameraService instance was destroyed.

This is tracked SOURCE behavior, not independent proof that the exact
installed APK matches those lifecycle lines. Preserve its installed hash,
version and the prior before/after receipts; do not assert a transition
without an independently observed service state/camera-finalization proof.

## Correct historical classification: one prior supervision attempt

The earlier Android shell command emitted `Usage: input ...`; the guard
then emitted `NATIVE_STOP_UNCONFIRMED` (exit 72). Consequently, **no
STOP completion or restarted CameraService was established**. The
unchanged PID 5789 and later active service prove continuity at that later
observation, but **cannot exclude** a brief asynchronous STOP or automatic
service recreation between measurements.

The corrected follow-on command failed **before STOP** on
`urllib.error.URLError: <urlopen error [Errno 111] Connection refused>`
fetching the local status API. No contemporaneous independent ADB
`get-state` result was preserved *at the exact instant of refusal*, so
API absence cannot retrospectively be labeled wireless ADB loss.
No successful manual rearm, new 4K buffer or genuine service restart was
demonstrated. The prior authorization is exhausted/not extended here.

## Future bounded owner-authorized service maintenance (NOT EXECUTED)

0. **New explicit maintenance authorization required.** Check current
   owners/jobs first; preserve installed APK SHA256, camera preference,
   recordings/media-sidecar manifests, pre-change diagnostics and rollback
   paths. Keep Camera2 running until all conditions pass. Never deploy
   APK, modify thermal/recovery counters, or force manual encoder trials.
1. Choose verified identity-pinned **direct wireless first** if bounded
   checks show reliable device/model, forward and independent recorder
   service state. If direct wireless cannot meet control preconditions,
   inspect existing S3 peer route *under its owner-approved supported
   workflow* and validate exact S9 serial/model. Wired USB is an optional
   last resort when network alternatives demonstrably fail. None of these
   alternatives excuses a platform denial.
2. Establish a **fresh** same-invocation window with camera mode
   `watching`, no `recording` or `starting`, no queued
   finalization/preroll/tail/thumbnail/review/inference/scan/export,
   no active worker leases, pending Save/Delete or human review, expected
   app/SD capacity and startup battery/temperature thresholds, healthy HA
   and archived originals. One old partial must not be removed or assumed
   finalized based on age. Abort on any unknown guard. Check worker jobs
   again immediately before action.
3. With a currently permitted trusted management route, send **one**
   documented `CameraActivity` STOP control, and record its command
   receipt. A command returning without error is only a STOP request.
   Observe the service lifecycle separately, with a **bounded timeout**:
   the original `CameraService` instance must be absent/teardown
   confirmed, no active recording or finalization, camera/media resources
   closed. **Do not use app-PID disappearance as the test.** An HTTP
   refusal after verified STOP can be expected; independently distinguish
   it from device/forward loss and never repeatedly issue STOP.
4. Once shutdown is **positively** confirmed and startup guards are
   fresh, send **one** normal `CameraActivity` ENABLE control with
   `enable_native_camera=true`. Its implementation calls
   `startForegroundService(CameraService)` and restores
   `native.enabled=true`. Do not send START while service teardown is
   incomplete; do not force-stop the process or invoke the production
   encoder trial.
5. Independently verify service start/foreground and fresh camera sensor
   frames; native continuous-4K READY, nonempty/sufficient buffered history
   over time, correct output/framerate/no drops, temperature and errors,
   retained original/partial media counts and unchanged installed APK.
   Status/API checks alone are not 4K recording acceptance.
6. If the trusted control transport is lost **before STOP**, ABORT and
   preserve recording. If lost **after verified STOP**, do not invent a
   completed START; preserve stop receipt and, after new validated
   connectivity, use only the owner's bounded authorized normal ENABLE
   path to restore basic camera operation, then verify health. Treat
   any unconfirmed shutdown, guard failure or failed rearm as a terminal
   incident requiring human authorization and review; do not loop,
   retry a destructive command or declare the old 4K issue resolved.
7. Only after independently proven physical 4K recovery can Chat 2
   conduct its **own fresh** Task9 temperature, hub/phone RAM, worker
   exclusion and PR #1179 integration checks. No old snapshots admit work.

The previous immutable receipts remain on C720P. A corrected *superseding*
checkpoint explicitly cites their SHA-256 and explains the USB/lifecycle
corrections without rewriting the original forensic evidence.
