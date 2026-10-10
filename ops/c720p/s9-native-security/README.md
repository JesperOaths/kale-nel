# S9+ native 4K SD-only security camera

## Production architecture (9 October 2026)

This standalone Android application replaces IP Webcam Pro for camera acquisition, motion detection, clip storage and post-recording classification. Verified on Samsung SM-G965F (Android API 29) with native Camera2 rear camera.

- **Video:** 3840 × 2160, H.264 at 30 fps and 36 Mb/s, encoded directly to removable SD using MediaRecorder. The actual sample MP4 was independently verified through Android metadata (not merely a requested setting).
- **Motion:** independent 640 × 480 YUV_420_888 Camera2 stream, adaptive regional luma comparison, temporal voting, connected component filtering, and global-exposure suppression. Native service includes thermal, free-space and recording-duration safety limits; the baseline version had a 12-per-hour recording cap. Version 2 retains 12 ordinary slots and reserves 12 additional 4K slots for sustained coherent motion (24 maximum/hour).
- **Offline review:** TensorFlow Lite GPU / CPU fallback, six sample frames from completed MP4s, COCO-style classes (people, animals, vehicles), SHA-256 verification manifest and JPEG thumbnail. One-person, multiple-people, vehicles, animals, other motion and unreviewed groups are visible in Security.
- **Storage:** microSD `Android/data/nl.kalenel.s9security/files/Security4K`, with MP4, `.verified.json`, `.thumb.jpg`. MP4s are finalized through a temporary `.recording` rename. Nothing is sent to Google Drive.
- **Local-only live:** Camera2 YUV JPEG at `127.0.0.1:8808/shot.jpg`, multipart MJPEG at `/mjpeg`, diagnostics at `/status`. C720P ADB forwards to `127.0.0.1:18808`; authenticated relay on C720P `8794/new/live.mjpg` serves the Security interface.
- **Backwards playback:** S9 SD catalog `c720p-s9-local-sd-catalog.timer` and archive server `8795` serve old IP Webcam and new native MP4s via verified, ranged HTTP playback.
- **Migration/rollback:** IP Webcam Pro has been disabled (not uninstalled); existing application data and SD recordings retained. Re-enable with `adb shell pm enable com.pas.webcam.pro` if rollback is required. Hub native mode is guarded by `s9-native-security-active.flag`; do not remove it without configuring the previous motion/live paths.

## Verification

The safe dual-stream pilot produced a verified 3840 × 2160, 8.862 s, ~40 MB video on microSD, ran 277 motion frames concurrently, and classified its output on the phone's GPU with person detection. A separate pilot verified native JPEG snapshot delivery. Signed relay MJPEG responded with HTTP 200 and valid JPEG data; SD archive ranged playback returned HTTP 206 with the requested byte count. The deployed native service reported healthy `watching`, ~29.5 °C and no reported recent failures at its last sampled status.

## Accuracy, privacy and remaining quality work

Current detector is a COCO quantized SSD MobileNet v1. Its individual labels and counts are *model outputs*, not guarantees of actual scene contents. **No persistent named-person or face identification is deployed**: the app does not determine that an unknown passer-by in two recordings is the same person. The Security view supports scene/object categorization instead.

A better mobile detector (for example EfficientDet-Lite0 or Lite2) needs device-specific A/B testing for precision, misses, inference latency, GPU delegate compatibility, and sustained temperature before replacing this model. Benchmark on real low-light garden clips and negative triggers; do not infer accuracy merely from the model name or a benchmark from another device. The hourly event cap protects storage but must be tested against real daytime/night-time walk-bys to ensure important activity is not suppressed.

For recovery, preserve older SD app-specific video directories. Do not uninstall legacy apps until their files have been copied to neutral storage.

## Reproducible APK builds and safe upgrades

The build pipeline resolves one immutable Git commit (default: current main; override with `S9_SECURITY_REF=<full SHA>`). It fetches all six Java classes, including `PreviewJpeg`, and the matching AndroidManifest.xml from that exact revision. Source and compiled revision stamps must agree before packaging.

From the C720P build directory:

```bash
bash ./build-install.sh    # compile + sign only; does NOT install
cat "$HOME/c720p-home-hub/build/s9-native-security/s9-native-security.apk.source-commit"
sha256sum -c "$HOME/c720p-home-hub/build/s9-native-security/s9-native-security.apk.sha256"
```

`S9_INSTALL_SHADOW=1` is intended only for a phone that does not already have this app installed; the script now refuses **all existing installations**, even stopped ones, because Android's MY_PACKAGE_REPLACED receiver may re-arm a previously enabled recorder. Existing installations require the separate `safe-night-guard-upgrade.py` backup/rollback procedure and compatible APK signing keys.

An orderly service shutdown now attempts to finalize and locally review an active 4K clip. An OS kill, power loss or camera fault can still leave a `.recording` file; preserve it for forensic recovery. TensorFlow Lite delegate cleanup is serialized after queued review jobs.

GitHub Actions checks shell syntax, source/build safety invariants and compiles six Java classes against Android SDK and TensorFlow Lite 2.14. **This is not on-device validation.** Before a live upgrade verify the rollback APK, safe idle interval, SD space, native JPEG/MJPEG, ranged playback, SHA-256 manifests, frame cadence, temperature and clip-review completion. Do not re-enable Drive uploads or IP Webcam.

## Evidence-preservation continuation

- **Recording admission:** the first 12 captures in a one-hour window are accepted as before; the next 12 are reserved for coherent, sustained motion (not a verified person-identification decision). Quota exhaustion does not disable low-resolution analysis.
- **Suppression evidence:** if a motion event cannot start video due to quota, cooldown, temperature or free-space safeguards, save a throttled 640×480 JPEG and JSON sidecar directly on microSD (at most one every 45 seconds). These preview files are **not 4K clips, are not classed as identified people, and are not yet listed by the MP4-only Security video catalog**.
- **Crash recovery:** on startup, scan a bounded set of recent native clips for missing review manifests. Only rename a leftover `.mp4.recording` to `.mp4` when it is verified as a readable 3840×2160 video of at least one second. Leave unreadable files untouched, and queue review and thumbnail generation on the phone.
- **Diagnostics:** `/status` shows priority motion, reserve usage, suppressed recordings, fallback evidence totals and recovery outcomes.
- **Limits:** Camera2 settings, TensorFlow Lite model, thermal threshold (41.5°C), minimum SD reserve (15 GiB), and existing active motion thresholds are not changed. Actual people-vs-false-trigger accuracy remains to be evaluated with labeled day and night evidence. The hourly cap may still result in missed full-quality videos in extremely busy periods.

This stage does not claim named-person recognition, automated deletion of forensic evidence, or guaranteed playback of corrupted unfinalized MP4 files.

## S9+ suppressed-motion still images — secure Security gallery

New fallback still images (\`preview_motion_<milliseconds>.jpg\`) are indexed separately from video. The private metadata index is at \`~/c720p-home-hub/state/s9-fallback-evidence.json\` (mode 0600). The JPEG **bytes remain exclusively on S9+ microSD** and are read via ADB only upon authenticated image requests. The authenticated archive endpoint \`/new/api/saved\` retains \`events\` for playable video and adds a separate \`fallback_previews\` array; \`/new/saved/still/<name>.jpg\` verifies the indexed size + SHA-256 before serving \`image/jpeg\`. It is never an MP4 and never implies an identified person.

The hub Security \`clips.html\` gains a separate “S9+ motion preview evidence” gallery using the existing \`C720PSecureRelay\`. It shows the reason each still was retained, displays “not person-identified”, and opens the still in a photo dialog rather than attempting MP4 playback. When no preview events have occurred, an empty category is shown.

Deploy with \`deploy-fallback-evidence.py --staging <staged-files-directory>\` after staging all three required scripts and the test from the same pinned Git commit (see commit history). It backs up the existing catalog, authenticated archive extension and Security HTML, reruns tests, refreshes the catalog, restarts only the archive service, validates the videos remain visible and auto-rolls back on failure. It never reinstalls the camera APK or changes Drive settings. Existing microSD originals are not deleted or copied to the hub.


## Anonymous per-clip tracks (10 October 2026)

The native `ClipClassifier` now attaches **temporary** `Person 1`, `Person 2`, etc. tracklets to completed 4K clips. It follows detected bounding boxes across **at most 12 sampled frames**, not all frames. Upper-clothing-colour tags are coarse RGB estimates excluding the head/face and may be unavailable under low light. The track count is **not** a count of distinct people; losing and regaining the detection may produce two track IDs for one person. Track IDs reset for every clip. No named recognition, face embeddings, or automated cross-recording identity links are produced.

The on-phone `motion_<milliseconds>.mp4.verified.json` sidecar contains `anonymous_tracking_version=sampled_box_tracklets_v1`, `anonymous_track_scope=this_recording_only`, `anonymous_track_count` and an `anonymous_tracks` array. The existing 4K MP4, SHA-256 evidence, thumbnail and SD-only retention policy are unchanged.

The C720P `local-sd-catalog.py` exports only allowlisted anonymized fields, rejecting malformed track IDs or timing. The authenticated `/new/api/saved` route exposes the clip-scoped data; the `patch-anonymous-tracks-ui.py` Security panel adds filtering by approximate clothing colour, grouped scenes, vehicles or animals and opens the original recording through the existing authenticated playback path. Old manifests are explicitly labelled `not_available_in_original_review`. The update **does not retroactively re-analyse** historical MP4s or create face-linked identity records.

### Guarded deployment runbook (requires authorized C720P shell/ADB)

Do not mistake repository merging, CI compilation or immutable staging for on-device activation. The device must be reachable and in a healthy non-recording window. Keep the current signed APK and original SD content for rollback.

From a checkout of the *same immutable release revision* on the C720P:

```bash
export S9_SECURITY_REF="$(git rev-parse HEAD)"
bash ops/c720p/s9-native-security/compile-only.sh
bash ops/c720p/s9-native-security/package-only.sh
python3 ops/c720p/s9-native-security/stage-verified-deployment.py
python3 ops/c720p/s9-native-security/deploy-anonymous-clips-index.py \
  --staging "$HOME/c720p-home-hub/build/s9-controls-validated/$S9_SECURITY_REF"
python3 ops/c720p/s9-native-security/safe-night-guard-upgrade.py
```

`stage-verified-deployment.py` requires matching source/compile/APK commit stamps and a signed package, validates all staged inputs from that pinned commit and tests Security HTML patching. `deploy-anonymous-clips-index.py` backs up the C720P catalog/proxy/page/index, restarts only the archive service, verifies that indexed video records and stills are not lost, and rolls back on failure. `safe-night-guard-upgrade.py` separately backs up the installed phone APK and performs a guarded update with automatic old-APK restore on failure.

**Live acceptance:** confirm Camera2 returns to `watching`, snapshots and 4K recording are healthy, temperature/SD safeguards remain active, `/new/api/saved` still lists existing video and fallback stills, and a newly completed 4K recording has an anonymous-track manifest with the expected local-only scope. `anonymous_track_count=0` on an analyzed clip means no people were detected **in the sampled frames**, not necessarily no people in the video. Until those acceptance checks pass on the phone and hub, the source implementation is **not deployed**.
