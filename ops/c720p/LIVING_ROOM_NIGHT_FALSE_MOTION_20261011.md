# Living-room lamp: false camera motion at night (11 October 2026)

## Findings

The C720P front camera reported several low-light motion events despite no room movement. The detector's V16 dark-mode contour gate accepted very small patches that survived a short motion track. Its event log contained spurious dark/dim detections at 18:59, 19:18, 19:37, 19:50, 20:12 and 20:51 local time. Home Assistant's recorder showed corresponding ON transitions of the living-room lamp at five of these timestamps, generally within a second of the camera events.

This is a confirmed false-trigger mechanism, not verified evidence of people. The low-light background/exposure processing was far too permissive for the observed noise shapes.

## Applied on C720P

Installed NIGHT_SHAPE_GATE_V17_20261011 in /home/jespern/c720p-home-hub/bin/c720p-frontcam-motion-living-lamp.py, through the authorized Supabase management gateway.

The dark/dim gate now requires a coherent temporal bbox of at least 14 by 16 px, an 80 px² contour, 0.40% frame change, 3 consistent frames, at least 3 pixels displacement and reasonable mask fill; tiny edge-only patches are rejected. This does not change manual light control, normal daylight thresholds or the S3 bedroom light sensor.

Production job 10267 passed: six historical false-pattern examples rejected, two *synthetic* walk-shaped examples accepted, service restarted successfully, and its live JSON reported night_shape_gate_v17=true. This is not a live human walk-through validation.

The original detector source is backed up on the hub at /home/jespern/c720p-backups/frontcam-night-shape-gate-20261011/frontcam-motion-v16.before.py.

## Reinstallation / later tuning

The public GitHub repo does not contain an exact copy of the live V16 source. Do not publish the full local detector script if it includes private configuration. Instead reapply the tested patch through ops/c720p/apply_frontcam_night_shape_gate_v17.py, using --check before --apply. That patcher includes syntax tests, historical noise examples and automatic rollback if the camera service fails.

Preserve authorized SSH, Supabase agent, ADB and Home Assistant control. Do not trigger a light or disable manual ownership during verification. If false ON events return, collect the new temporal bbox, area, displacement and source diagnostics and refine the guard rather than changing every sensitivity threshold.
