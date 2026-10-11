# Living room false triggers — 2026-10-11

The C720P webcam's `frontcam-motion-v16` sent multiple low-light motion events with `lamp_trigger_allowed=true` when temporal bounding boxes were 9×9 to 17×14 pixels and ambient luminance approximately 8–10. The low-light tracking logic allows such small coherent pixel changes. Home Assistant's `c720p_frontcam_motion_living_lamp_v1` webhook uses this boolean to authorize switching on the living-room lamp when it is off.

The staged `frontcam_dark_lamp_on_guard_20261011.py` raises the evidence threshold only for turning an OFF lamp on in dark or dim conditions: minimum 18×16 bounding box, 90 connected pixels, movement displacement 3, three tracked frames, and flicker/transition rejection. Motion notifications can continue for an already camera-owned timer, and manual-on ownership should remain unchanged. It backs up, syntax-checks, and restarts with rollback on failure.

**This is staged only, not deployed.** A live maintenance write was blocked by the execution tool; do not imply otherwise. Deploy only via an authorized permitted maintenance session. Afterwards verify the service stays active, manual switching works, empty-room low-light test has no lamp-on, and a real person entering still triggers within acceptable latency. If real movement is missed, tune from measured frames rather than weakening to the previous noise threshold.
