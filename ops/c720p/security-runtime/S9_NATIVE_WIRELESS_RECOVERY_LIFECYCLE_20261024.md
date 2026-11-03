# S9+ CameraService: bounded wireless recovery procedure (not executed)

**Status:** Prepared for owner review on 2026-10-24. **No new Camera2
STOP/START authorization is available under this document.** The previous
single supervised restart supervision did not complete any confirmed stop or
restart, and the user explicitly prohibited extending it as repeat authority.

## Physical transport assessment

A data USB cable is **not an architectural requirement**. At ~19:09 CEST
the direct authorized Wi-Fi ADB target `192.168.178.250:5555` provided the
SM-G965F model; the existing port `18808 -> 8808` served live status,
which reported fresh camera frames and exhausted 4K recovery (3/3 attempts).
ADB disappeared around 19:10 and returned after natural bridge restoration.
At ~19:16 the patched native bridge service completed normally with exact
model+serial and forward checks. This proves bounded setup, not guaranteed
future transport or CameraService health.

Alternative route `192.168.178.47:5555` (S3) was assessed once without
starting its relay; TCP ADB connect returned `Connection refused`.
The `c720p-s9-peer-bridge.py` source can create listeners on 0.0.0.0.
Do **not** activate new public listeners or change S3 network state as a
shortcut, or use it to reroute any previously denied phone-inspection call.
Existing USB fallback deliberately returns to wireless ADB and is not an
architectural prerequisite.

The host battery/low-drain service intentionally sends the S9+ KEYCODE_SLEEP
after applying Wi-Fi survivability configuration, every ~15 minutes. Its
19:08:36 CEST completion preceded a wireless loss, but no causal evidence
ties that sleep to all observed transport drops. Do not change the phone's
battery, Wi-Fi, thermal or display settings without an independently
verified narrowly scoped cause.

## Native lifecycle semantics (verified from repository CameraService.java
and CameraActivity.java, not an assertion about the installed APK's binary)

CameraActivity's **STOP NATIVE SERVICE** button sends a foreground-service
Intent with action `STOP`. CameraService.onStartCommand processes it by
writing `native.enabled=false`, posting `shutdown()` asynchronously to
`cameraHandler` and returning `START_NOT_STICKY`. When shutdown actually
runs, it finalizes active recording if any (therefore STOP is forbidden if
recording/finalization is in progress), sets `mode=stopped`, releases
Camera2/encoder and closes the local HTTP API, calls `stopForeground(true)`
and `stopSelf()`. The Android *application PID can remain*. The HTTP socket
disappearing is expected; it must not be interpreted as an ADB disconnect.

CameraActivity's normal **ENABLE NATIVE 4K SECURITY MODE** button calls
`startForegroundService` with `enable_native_camera=true`,
`pilot_only=false`, `takeover_ipwebcam=true`. Its exported Activity
`onNewIntent` also accepts `am start -n
nl.kalenel.s9security/.CameraActivity --ez enable_native_camera true
--ez pilot_only false` to dispatch this normal (not forced-test) path.
It is not the low-level `continuous_4k_trial=enable` API and must never
bypass temperature/memory/storage guards.

## Future one-shot procedure, only after **NEW explicit user authorization**

1. Take an immutable before-state receipt with original host/date, exact
   target serial `27bb603837047ece`, model `SM-G965F`, installed APK
   SHA256 `37091d542b8708db26f520a67af8a4edbb687c80d2b24c01d87bf1a2d8b5d059`,
   preserved current/release rollback, native CameraService state, status
   frame counters/timestamps, temperature, storage reserve, source recording
   inventory and *non-secret* worker state. Reject if APK/config changed.
2. Fail closed unless `adb get-state` is `device`, model+serial match,
   `adb forward --list` shows exact target 18808 -> 8808, two bounded
   read-only status checks show increasing frames and `watching`, and no
   active recording, pending media finalization, writer, inference, source
   hash, complete-clip, archive triage, catalog or competing worker exists.
   Camera startup temperature must satisfy normal app protection; Task 9
   will separately require its stricter 34.5°C condition. No memory
   evictions or weakened thresholds.
3. Wake/verify the exact installed CameraActivity and its STOP button
   by package+visible label and fresh UI bounds, **never guessed taps**.
   Send **one** normal STOP through that app button, with correctly quoted
   single `adb shell input tap X Y`; do not use `am force-stop`,
   kill the app, change preferences manually, or use an experimental trial.
4. Observe a bounded shutdown window: phone ADB transport *still* reports
   `device`; independently read Android CameraService service registration
   until its instance is gone or reports stopped and finalization has
   finished. A lost native HTTP endpoint is expected after shutdown. A
   persistent app PID is **not** a failure criterion. Do not arm again
   merely because one HTTP request fails. If service state or finalization
   remains ambiguous, stop the procedure and record uncertainty; never
   issue another STOP.
5. Only after shutdown is positively complete **and** ADB is still
   authenticated and the owner lock/exclusion remains held, invoke the
   CameraActivity's normal Enable path exactly **once**. Wait for foreground
   CameraService registration and stable `watching`, correct camera
   source, fresh advancing frames, normal startup temp, expected SD
   reserve, stable 4K production preference and **replenishing continuous
   native 4K ring**. Verify growing `continuous_4k_buffered_ms`, zero
   drop/encoder errors, and no source damage. A bridge HTTP200 or legacy
   preroll flag is not acceptance.
6. Independently recheck pinned installed APK/digest, recording inventory,
   saved/quarantine/review protections and current configuration after the
   transaction, and write the immutable after-state receipt.
7. Fail closed if the link disappears, a STOP acknowledgment is ambiguous,
   start does not complete, the source changes, recording becomes active,
   or the 4K buffer does not grow in the bounded window. Preserve logs and
   media. **No restart loop, repeat taps, forced trial, counter edits or
   APK install.** Report if a STOP happened but normal rearm could not be
   verified; never falsely declare Camera2 healthy.

**Chat 2 Task9:** after *physical* 4K ring recovery, it must independently
recheck live recorder/temperature (34.5°C threshold), phone/hub RAM and worker
exclusions; draft PR #1179's source/test correction also must be resolved.
Chat 3 continues to own its UI/relay lifecycle. Empty-clip automatic
quarantine remains separately blocked under draft PR #1181.

## Previous attempt: exact preserved record

Pre-state `S9_NATIVE_4K_SUPERVISED_RESTART_BEFORE_20261024.json`
SHA256 `b1e572deb35ce7b0f4c2877b3ffcdbab23ae3981cfd31a48c4c6d0ae71b48a59`.
First Android input was incorrectly shell-quoted: `Usage: input ...`,
`NATIVE_STOP_UNCONFIRMED`, exit 72; subsequent native recorder remained
`watching` with original PID 5789, fresh frames, 4K attempts still 3/3.
Second corrected preparation stopped **before** control at
`urllib.error.URLError: <urlopen error [Errno 111] Connection refused>`
to localhost forward 18808. There is **no evidence any STOP completed**,
and no camera restart completed. Outcome receipt
`S9_NATIVE_4K_SUPERVISED_RESTART_OUTCOME_20261024.json`
SHA256 `290288890793608b75de42f447d7cc235884b1b299835b8554ca9154e4985697`.
