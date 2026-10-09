# S9+ native 4K SD-only security camera

## Production architecture (9 October 2026)

This standalone Android application replaces IP Webcam Pro for camera acquisition, motion detection, clip storage and post-recording classification. Verified on Samsung SM-G965F (Android API 29) with native Camera2 rear camera.

- **Video:** 3840 × 2160, H.264 at 30 fps and 36 Mb/s, encoded directly to removable SD using MediaRecorder. The actual sample MP4 was independently verified through Android metadata (not merely a requested setting).
- **Motion:** independent 640 × 480 YUV_420_888 Camera2 stream, adaptive regional luma comparison, temporal voting, connected component filtering, and global-exposure suppression. Native service includes thermal, free-space and recording-duration safety limits; the deployed version also reported a 12-per-hour recording cap.
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
