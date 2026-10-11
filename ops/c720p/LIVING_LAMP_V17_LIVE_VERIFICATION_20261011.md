# Living-room lamp false-trigger investigation and live V17 cutover
**Date:** 11 October 2026 · Europe/Amsterdam.

## Root cause confirmed

The original C720P front-camera V16 was accepting tiny dark-frame temporal components (e.g. bounding boxes 9×10 through 17×14 pixels at sensor luminance approximately 8–10). Its local webhook emitted `lamp_trigger_allowed=true`. Home Assistant's `c720p_frontcam_motion_living_lamp_v1` automation is intentionally allowed to turn on `switch.lamp_woonkamer_socket_1` when that flag is true and the lamp is off.

The Home Assistant recorder confirms this sequence: 20:51:34 lamp on, 20:51:41 manual off, then 20:53:23 another false-trigger lamp on. The living-room camera ownership input boolean followed the same transitions. It was off again at 20:58:22.

## Actual production fix already installed

At approximately 20:57 local, **C720P job 10267** reported successful installation of the on-device `NIGHT_SHAPE_GATE_V17_20261011` logic and an active `c720p-frontcam-motion-living-lamp.service`. A backup of the pre-change detector is held at:
`/home/jespern/c720p-backups/frontcam-night-shape-gate-20261011/frontcam-motion-v16.before.py`.

In dark/dim conditions, the actual `night_lamp_shape_gate` function now requires:

- Temporal bounding box width ≥14 and height ≥16 at 160×120
- Temporal connected component area ≥80 and changed pixels ≥0.40%
- At least 3 tracked detections and ≥3 pixels of tracked displacement
- Filled component ratio ≥0.08
- Additional rejection for narrow components touching the left camera edge

The existing tracker and light-transition rejection also run before the shape gate. Brightness gating still applies. These checks tighten *camera detection* before any motion webhook is sent; they do not alter Home Assistant's manual-control ownership rules, five-minute timeout, or S3 bedroom sensor.

## Verification

- Job 10267: pre-deployment offline test blocked six logged false triggers and accepted two simulated walking-like examples. Service restarted and remained active.
- Job 10270: independently read installed V17 source; confirmed the shape gate is integrated into the `confirmed` branch of the actual detector.
- Job 10272: checked running V17 logic and active systemd unit. The persistent status still labels itself `frontcam-motion-v16`, a **cosmetic stale version identifier**, despite the installed V17 marker.
- Job 10274: Home Assistant recorder showed no additional lamp-on after the V17 deployment within the inspected interval. Manual-control and five-minute ownership automation definitions remained intact.
- Job 10278: 12/12 offline regression cases passed by extracting the **actual installed V17 function** from the running source. The test script is `ops/c720p/test_frontcam_night_shape_v17.py`.

**Limits:** Two walking-like cases are synthetic. A real person walking through the room after this cutover has **not** yet been observed and timed; neither an indefinite empty-room observation nor an illumination/false-positive benchmark has been completed. The current label still reads V16 in local JSON. Do not describe those remaining checks as passed.

## What not to deploy

`ops/c720p/frontcam_dark_lamp_on_guard_20261011.py` is an **older V16 staging patch** and is now superseded by this live V17 fix. It has been updated to exit successfully without changing files if the V17 marker is present. Do **not** stack the old patch on V17 or overwrite V17 with the older GitHub-only draft.

## Safe acceptance tests

1. Confirm motion unit active, agent still operational, camera frames healthy.
2. Run `python3 ops/c720p/test_frontcam_night_shape_v17.py` against live source (test is read-only).
3. With the room empty and lamp off, observe camera events and actual lamp state for a sustained dark period; do not simulate a movement webhook as that directly switches the lamp.
4. Have a person walk across the camera field in dark and normal light; measure detection latency, genuine hit rate, and false-on rate. Tune only with measured evidence.
5. Check a manual ON remains user-owned and is not turned off by camera's five-minute timer.
6. Roll back only if actual detection fails, using the saved pre-V17 backup and an authorized guarded service restart, preserving administrative access.
