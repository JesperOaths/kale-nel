# S9+ edge processing companion — live v6 (October 9, 2026)

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
- v4 generated a successful 65 KB thumbnail on the S9+ by selecting the sharpest of three sampled MP4 frames. Android boot receiver exists but has not been validated with a full phone reboot.
- v5 on-phone guarded recording pilot captured `rec_2026-10-09_19-04.mp4` (2,251,856 bytes), and auto-archived it to microSD with a SHA-256 manifest and 65 KB thumbnail. Reported `recording_count=1`, `recording_failures=0`, `auto_sd_archive_count=1`, `auto_sd_archive_errors=0`.
- v6 compiled, signed, and installed successfully. Live status showed `recording_enabled=true`, `recording_armed_persistent=true`, `recording_orphan_present=false` after an explicit local ADB arm command. Full reboot persistence remains untested; it should never be claimed proven without the test.
- The v6 capture guard keeps at least 1,250 MiB free on internal storage and 15 GiB on removable SD, limits original-source video backlog to 300 MiB, pauses at battery temperature >=40.5°C, adds a >=105-second cooldown, and caps recordings at 8 starts/hour with persisted rate history. The phone leaves the source recording intact after transferring the verified SD copy. Upon interrupted capture, `orphan_capture_requires_inspection` disarms further captures for safety.

## Safety constraints and unfinished migration
- **Do not uninstall S9 edge while any verified videos live only in its Android app-specific SD directory. Android may remove that directory on uninstall.** Rollback via the phone's ADB interface, not uninstall. Export verified videos before changing the app's package identity or deleting its data.
- To pause automatic recording but retain motion and archive processing, start `nl.kalenel.s9edge/.EdgeActivity` using ADB with `--ez pilot_recording false`; if the activity is already displayed and Android does not forward new-intent extras, a cold start with `am start -S -n ...` was verified to reach the service. Do not cold-restart during an active recording.
- To resume persistent guarded recording: `adb -s 192.168.178.250:5555 shell am start -S -n nl.kalenel.s9edge/.EdgeActivity --ez pilot_recording true`. Check `recording_enabled`, `recording_armed_persistent`, and `recording_orphan_present` afterward. An orphan requires manual inspection, not unconditional restart.
- Video copies remain on the phone; automatic **recording** is intentionally disabled until motion and internal storage budgets are proven. The original C720P recorder remains untouched as a fallback, but was itself blocked by its 900 MiB free-disk floor and 12/hour rate cap, and Drive archival was blocked by its 5 GiB reserve.
- No ML/TFLite GPU or NNAPI person detection yet. A coherent-motion silhouette is not person classification. Do not claim the new detector can distinguish people from vehicles without validation.
- Recording is now enabled on the S9+ subject to strict storage, temperature and rate limits. The automatic archiver **retains the original internal MP4**, so the 300 MiB source cap will eventually block new recording unless cloud verification and source lifecycle handling are added. **Do not weaken/remove this limit just to make captures continue.** Removable SD is not an off-phone backup.
- The v6 `recording_count` counter is process-lifetime plus a persisted completed total; a reset of `event_seq` after service restart does not imply deleted saved videos.
- IMPORTANT: The detector uses Java CPU analysis of coherently moving regions, **not GPU-accelerated person detection**. Geometrical `person_shape_candidate` is a heuristic, not an ML-confirmed human. No recorded labeled walk-by test has yet established recall or false positive rate.
- The C720P recorder is still blocked by its 900 MiB disk floor and 12/hour guard, and the camera snapshot code still runs on the hub. Camera encoding, motion evaluation, SD transfer and thumbnail work have phone-side implementations, but do not claim the hub has retired all duplicate camera work.
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
