# C720P five-part reliability pass — 2026-10-04

This checkpoint records the live C720P reliability work completed after the 1366×768 Home Assistant dashboard redesign.

## 1. Kiosk white-surface self-heal

Live watchdog:
- `/home/jespern/c720p-home-hub/bin/c720p-kiosk-renderer-watchdog.py`
- `c720p-kiosk-renderer-watchdog.timer` enabled, one-minute cadence.
- Samples the actual X11 framebuffer below the XFCE panel using `xwd + ffmpeg signalstats`.
- Healthy dark dashboard is approximately YAVG 57–60.
- Near-white detection requires YAVG >= 242, YMIN >= 228, SATAVG <= 8, Home Assistant as foreground window, and two consecutive samples.
- Security playback is excluded.
- Recovery order: compositor toggle + xrefresh + Ctrl+R, then kiosk restart only if still white.
- Existing CDP health recovery remains in place.

## 2/3. Presence + Eco Guard

Live HA package:
- `/config/packages/c720p_presence_eco_v1.yaml`
- Canonical copy in this repository: `ops/c720p/c720p-presence-eco-v1.yaml`.

Important fail-safe:
- `Unknown` or unavailable presence never counts as Away.
- `person.jesper` currently has no attached device trackers, therefore the live state is intentionally `Unknown`.
- Once a reliable personal phone tracker is attached to the HA person, the existing logic starts working without code changes.
- Confident Away for 15 minutes (configurable) turns off Living + Bedroom room aggregates only when Eco Guard is enabled.

Do not use the S9+ camera phone, household iPad, or an unidentified LAN client as Jesper presence evidence.

## 4. TV / HTS / Bluetooth

Live dashboard component:
- `/local/c720p-extra-row-v82.html?v=MEDIA_ASYNC_VERIFIED_V82_20261004`.

Media route button now:
1. Reads live 8790 state.
2. Skips startup when live Bluetooth sink + default sink are already verified.
3. Otherwise starts the locked async `/pipeline/bluetooth-fast` pipeline.
4. Polls live state until Bluetooth connection, sink presence and default sink are all true.
5. Only then selects the C720P/Laptop audio source.
6. Shows the actual pipeline failure instead of optimistic "sent" text.
7. Duplicate taps cannot launch duplicate cold-start sequences.

HDMI3 evidence semantics were corrected in the live `c720p-bluetooth-helper-server.py`:
- TV power can be confirmed.
- HDMI3 navigation is **commanded/acknowledged**, not independently input-read-back.
- HTS Bluetooth, C720P Bluetooth and PulseAudio sink readiness are verified from live state.
- No `confirmed_hdmi3` literal remains in the active pipeline.

## 5. Cleanup

Verified archive:
- `/home/jespern/c720p-backups/c720p-cleanup-rollback-20261004_050900.tar.gz`.

Archived before deleting:
- 423 files / 7,416,050 raw bytes.
- compressed archive: 1,265,452 bytes.

Post-cleanup policy:
- Keep the current UI plus assets referenced by the eight newest Lovelace rollback points.
- Keep eight newest `lovelace.c720p_hub.before-*` files.
- Stale `www` backup copies reduced to zero.
- TV/HTS pipeline logs reduced from 61 to the newest 20.
- Camera/security recordings were not touched.

## Certified live state

At certification:
- HA HTTP 200.
- kiosk active.
- Bluetooth helper active.
- HT-E6500 helper active.
- renderer watchdog timer enabled + active.
- framebuffer `near_white=false`, YAVG about 59.
- live UI uses Eco V5, extra-row V82, scenes V3, original Voice V55.
- bottom row remains LIVE + Security only and fits the 768px display.
