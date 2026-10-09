# S9+ edge processing companion (October 9, 2026)

## Architecture
- Samsung Galaxy S9+ (SM-G965F, Android 10) retains the existing IP Webcam Pro stream at `192.168.178.250:8080`.
- `nl.kalenel.s9edge` is a separate foreground service. It reads `http://127.0.0.1:8080/shot.jpg` ON THE PHONE, analyzes the frames locally, and publishes motion telemetry only on **phone-local** port 8798.
- The C720P sees that telemetry via ADB-forwarded `127.0.0.1:18798`. A lightweight user-systemd timer reestablishes the forward after Android/ADB reconnects.
- Finalized IP Webcam recordings can be copied **within the phone** to a protected app-specific directory on its microSD card, without passing video through the C720P. The app verifies byte length and rereads the SD copy with SHA-256 before placing a `.verified.json` manifest alongside it.
- The app does not delete originals, delete any SD evidence, or modify C720P/Drive retention.

## Verified tests
- IP Webcam `/startvideo`, `/stopvideo`, `/list_videos` and `/v/<filename>` work. IP Webcam originals initially land in its **internal** `/sdcard/Android/data/com.pas.webcam.pro/files/tmp_videos` folder.
- S9 edge v2 copied `rec_2026-10-09_16-25.mp4` (1,003,024 bytes) to `/storage/9C33-6BBD/Android/data/nl.kalenel.s9edge/files/SecurityClips/`; the original/SD SHA-256 checksums matched independently.
- v3 auto-SD archive background thread copied a second completed sample `rec_2026-10-09_16-55.mp4` unattended; status `auto_sd_archive_count=1`, `auto_sd_archive_errors=0`. No originals deleted.
- Motion service initially ran at approximately 3 fps, zero snapshot errors in the observed samples, S9+ temperature around 34–35 C. The original motion threshold was overly noisy; v3 tightened the person-shaped/coherent confirmation. No controlled human-walk sensitivity test completed yet.
- v4 adds best-of-three video-thumbnail extraction and an Android boot/package-replaced receiver; verify on the installed phone before claiming those features live.

## Safety constraints and unfinished migration
- **Do not uninstall the S9 edge app while the only verified copies live in its Android app-specific SD directory. Android may remove the directory on uninstall.** Roll back processing using `adb shell am force-stop nl.kalenel.s9edge`, not uninstall. Export verified videos first if app removal is required.
- Video copies remain on the phone; automatic **recording** is intentionally disabled until motion and internal storage budgets are proven. The original C720P recorder remains untouched as a fallback, but was itself blocked by its 900 MiB free-disk floor and 12/hour rate cap, and Drive archival was blocked by its 5 GiB reserve.
- No ML/TFLite GPU or NNAPI person detection yet. A coherent-motion silhouette is not person classification. Do not claim the new detector can distinguish people from vehicles without validation.
- Automatic archiving currently **retains the original internal MP4**, so unattended recording must never be enabled without a bounded source-retention/transfer policy and enough free space. MicroSD is not a verified independent Drive backup.
- Security tab / saved clips index is not yet wired to the phone's SD recordings. Test clips stored on the S9+ are not necessarily visible in the hub UI.
- Home Assistant, camera relay, voice services and existing person-evidence retention still run on C720P. Switching the hub's detection/recording to phone mode must be feature-flagged, measured, and reversible.

## Operator checks
On C720P:
```bash
adb -s 192.168.178.250:5555 forward tcp:18798 tcp:8798
curl -fsS http://127.0.0.1:18798/status
curl -fsS http://127.0.0.1:8793/health.json
systemctl --user status c720p-s9-edge-bridge.timer
adb -s 192.168.178.250:5555 shell df -h /data /storage/9C33-6BBD
```
Only re-install a signed APK built from reviewed source. The `build-install.sh` script fetches pinned source from GitHub; update its commit pin explicitly when modifying source.
