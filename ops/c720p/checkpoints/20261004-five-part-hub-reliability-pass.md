# C720P five-part hub reliability pass — 2026-10-04

## Current live state

This checkpoint records the live Acer C720P / Home Assistant state after the five-part reliability pass.

### 1. Kiosk white-screen self-healing

- Active watchdog: `c720p-kiosk-renderer-watchdog.timer`
- Frequency: every 60 seconds.
- Implementation: `/home/jespern/c720p-home-hub/bin/c720p-kiosk-renderer-watchdog.py`
- Health combines Home Assistant/CDP state with X11 framebuffer signal statistics.
- Security playback routes are excluded from recovery interference.
- Recovery escalates from CDP/reload to compositor refresh/reload and only then kiosk restart.
- A real white/launch-screen failure occurred during cache cleanup on 2026-10-04.
- It was recovered automatically by the watchdog on the following cycle; no manual recovery was used.
- Healthy framebuffer after recovery: YAVG about 55, YMIN 11, hasLaunchScreen=false, failures=0.

### 2. Presence foundation

Home Assistant package:
`/opt/homeassistant/config/packages/c720p_presence_eco_v1.yaml`

Entities:
- `sensor.c720p_home_presence`
- `binary_sensor.c720p_away_confident`
- `input_number.c720p_away_auto_off_minutes`

Safety rules:
- `person.jesper` must have at least one actual `device_tracker`.
- Zero trackers => Presence = Unknown and Away Confident = unavailable.
- Unknown/unavailable can never count as Away.
- Current `person.jesper` has zero attached trackers, so presence intentionally remains Unknown.
- No existing HA mobile_app, SmartThings, iBeacon, Tile, iCloud, router-tracker or similar integration is configured.
- BlueZ currently only knows the Samsung HT-E6500 Bluetooth device.

### 3. Presence-aware Eco Guard

Automation:
`automation.c720p_eco_guard_confident_away_lights_off`

Behavior:
- Enabled only while `input_boolean.c720p_energy_saver` is on.
- Requires `binary_sensor.c720p_away_confident` to remain on for the configured delay.
- Default delay: 15 minutes.
- Then turns off:
  - `light.c720p_ui_living_room_lights`
  - `light.c720p_ui_bedroom_lights`
- Cannot run when presence is Unknown/unavailable.

Existing room Eco Guard remains in place:
- Living Room covers ceiling + socket through `light.c720p_ui_living_room_lights`.
- Bedroom guard remains unchanged.

### 4. TV / HT-E6500 / C720P Bluetooth orchestration

Live UI:
`/opt/homeassistant/config/www/c720p-extra-row-v82.html`

Marker:
`C720P_MEDIA_ASYNC_VERIFIED_V82`

V82 behavior:
- The C720P media route button starts `POST /pipeline/bluetooth-fast` on port 8790.
- Pipeline is locked so duplicate taps cannot start overlapping TV/HTS sequences.
- UI polls `GET /state` for live BlueZ/PulseAudio verification.
- Audio source is selected only after Bluetooth + A2DP sink + default sink are verified.
- Actual failure reason is shown rather than merely saying the command was sent.

Bluetooth helper:
`/home/jespern/c720p-home-hub/bin/c720p-bluetooth-helper-server.py`

State semantics were corrected:
- `state` / `live_ready` describe current live Bluetooth/audio truth.
- `pipeline_state` now describes current orchestration state.
- `last_pipeline_state` records historical result separately.
- Example disconnected idle state:
  - state=bluetooth_disconnected
  - live_ready=False
  - pipeline_state=idle_disconnected
  - last_pipeline_state=connected

No physical TV/HTS power test was forced during the final verification.

### 5. Cleanup / storage

Superseded zero-reference UI generations were archived and removed.

Archive:
`/home/jespern/c720p-home-hub/backups/ui-cleanup/c720p-ui-superseded-20261004_051643.tar.gz`

- gzip integrity check passed.
- Referenced legacy assets were intentionally retained.
- Current active UI assets all returned HTTP 200.
- Lovelace rollback files were reduced to 8 recent/useful checkpoints.
- Camera/security recordings were not touched.

A safe browser/APT cache cleanup reclaimed approximately 681 MB:
- C720P kiosk regeneratable Service Worker/component/GPU caches
- Spotify regeneratable caches
- APT binary cache metadata
- temporary scratch caches

Free root space returned to about 1.6 GB (~93% used), around the configured elastic target.

## Dashboard checkpoint

Current active major assets:
- Eco: `c720p-eco-timer-dual-v5.html`
- Main lower row/radiator/media: `c720p-extra-row-v82.html`
- Bottom actions: `home-scenes-primary-v3.html` — LIVE + Security only
- Voice: original `c720p-voice-banner.html`
- Spotify: `c720p-spotify-compact-v1.html`
- Surveillance: `c720p-surveillance.html`
- Weather: `c720p-weather-row.html`

The 1366x768 hub fits without scrolling and the final direct C720P screenshot after automatic recovery rendered normally.
