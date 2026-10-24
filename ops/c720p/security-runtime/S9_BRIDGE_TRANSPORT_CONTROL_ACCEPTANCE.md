# S9+ native bridge transport and control-acceptance contract

Status: **source-only diagnostic preparation; no camera restart authorized by this PR**.
Scope: C720P owner infrastructure. Task 9 implementation belongs to Chat 2.

## Actual installed unit versus repository installer

* GitHub `ops/c720p/s9-native-security/install-native-bridge.sh` sets up a
  `Type=oneshot` service with `adb connect` then `adb forward`.
* The live host has a pre-existing October 13 `20-recover-authorized-s9-usb.conf`
  override. Its `ExecStart` instead uses the host-local
  `recover-authorized-s9-adb-from-usb-v1.py`. Do **not** overwrite or remove
  that owner-maintained override during an ordinary source deployment.
* That Python program attempts Wi-Fi first. Its USB fallback verifies one
  Samsung SM-G965F, sends `adb tcpip 5555`, then restores **Wi-Fi** forwarding.
  It does not hold a wired control channel. On October 24 no S9+ USB device was
  physically present.
* Once the oneshot finishes, the shared ADB server owns `tcp:18808 -> tcp:8808`.
  The service becomes inactive/dead even when its last exit status is 0.
  `OnUnitInactiveSec=75s`, randomized delay 10s and `AccuracySec=1min`
  are re-establishment attempts, not a reservation. The S5 app may share the
  server; no demonstrated running S5 owner issued `adb kill-server`.

## Read-only diagnostic

`python3 ops/c720p/security-runtime/s9-native-bridge-readonly-check-v1.py`

The command checks exact device state and model, exact host forward, two
well-formed `/status` responses separated by two seconds, fresh frame
timestamps and advancing counters. Failure is exit code 2 with a generic
machine-readable reason. It does not reconnect, create a forward, access
recording media, use camera-control POST, or restart a service. **Passing
does not prove sustained transport, confer a lease, reserve a control
transaction or authorize a recorder restart.** It also requires an idle
`watching` camera, so do not unconditionally wire it as a generic bridge
`ExecStartPost` during legitimate active recordings.

Offline tests:
`python3 ops/c720p/security-runtime/test_s9_native_bridge_readonly_check_v1.py`

Six isolated tests reject wrong model, missing mapping, loss during interval,
stale frames and side-effect commands; successful probes still explicitly
return `control_transaction_accepted=false` and `transport_reserved=false`.
No real camera is contacted by tests.

## Proposed follow-on correction, not yet live

Review a separate minimal bridge setup/readiness check that works during both
watching and legitimate recording, while keeping the owner-installed USB
recovery override intact. It should fail closed on absent/invalid forward
or unavailable status, but a startup proof still cannot guarantee that the
forward remains usable throughout a subsequent stop/start. Do not resolve
that gap by repeated camera restarts, lower thresholds or forced encoder
trials. Owner-scoped deployment should include specific test cases for:
missing phone/unauthorized USB model, success without a usable forward,
forward lost after the oneshot exits, and natural recovery without
overwriting active recordings.

## Next supported physical connection action

Physically attach the **S9+ SM-G965F** to C720P using a data-capable USB
cable; unlock it and approve USB debugging for that host if Android asks.
Verify a unique USB serial/model and its stable USB ADB transport. Do **not**
use the existing USB-to-Wi-Fi recovery script as a substitute for an actual
wired transaction, because it intentionally switches to `tcpip 5555`.

Only after a **new, explicit camera-maintenance authorization**, new
idle/finalization and competing-worker exclusions, verified camera startup
guards (temperature, battery, SD reserve) and an intact pinned APK should
a camera owner consider a single supported normal application service
stop/start over the pinned wired session. Check camera PID, recorder mode,
new sensor frames, native continuous 4K buffered history, drops, thermal
state, installed APK and media counts immediately afterwards. Never
infer readiness from legacy preroll or a single HTTP200.

Chat 2 owns independent Task 9 admission and draft PR #1179. Preserve
previous denied phone-inspection operation; no alternative executor.
