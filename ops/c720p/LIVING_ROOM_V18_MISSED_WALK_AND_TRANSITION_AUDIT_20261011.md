# C720P living-room lamp false ON + missed real-walk detection (11 October 2026)

## Production observations

- Live detector is V17 with `NIGHT_SHAPE_GATE_V17_20261011`. It blocked six historic small nighttime false triggers in offline regression tests.
- At **21:07:34 Europe/Amsterdam**, the live detector emitted a `motion event delivered on_allowed=1` with `source=transition-settling` and a 30×52 pixel temporal component. Home Assistant recorded that `switch.lamp_woonkamer_socket_1` switched ON at 21:07:34 and the `input_boolean.c720p_living_camera_owned` owner changed to ON at 21:07:33.
- The living-room lamp stayed ON until Home Assistant's five-minute camera-owned timeout switched it OFF at **21:12:33**.
- During the user's **21:09 walk across the camera**, the V17 observation job **10287** collected a 60-second sample in normal-light mode, with camera luminance roughly 105–115. It recorded **zero new confirmed motion and zero new webhook triggers**. A separate Home Assistant history check (**10289**) confirmed **zero lamp/ownership state changes** during the observed walk.
- The normal-light profile in V17 requires background pixel delta ≥18, changed percentage ≥0.65%, and largest contour ≥95 pixels; its temporal candidate path is restricted to dark/dim. It can therefore miss motion in a lit room and fail to extend a camera-owned timer.
- Dark-mode gating can allow a motion confirmation when the source says `transition-settling`, which is inappropriate for ordinary exposure adjustment. This is a plausible source of remaining false activations; the historical event's imagery was not saved, so a human cannot be conclusively ruled out from logs alone.
- A read-only background sample after the lamp switched OFF confirmed that the detector was in dark mode and correctly rejected several small temporal components; those samples do **not** test person recall.

## Staged V18 correction

`ops/c720p/frontcam_motion_v18_normal_light_patch.py` performs the following only if explicitly invoked with `--apply`:

1. Checks the SHA-256 of the audited installed V17 source and confirms the V17 night gate is present. Refuses to patch a modified or unknown file.
2. Preserves the existing V17 dark shape-gate function and its tracked movement requirements.
3. Adds `normal_motion_evidence()`: background-supported or temporal evidence from a localized coherent moving component, with a modest reduction in the normal-light difference threshold (18→12).
4. Requires dark confirmations to originate from `background`, `temporal` or genuinely `localized-during-transition` detection—not `lighting-transition`, `transition-settling` or `warming`.
5. Updates the status version to `frontcam-motion-v18`, adds a normal-temporal candidate indicator for future diagnosis.
6. Saves the untouched V17 source to an explicitly named backup, restarts **only** the C720P frontcam motion unit, checks that the camera is active and publishing fresh healthy frames, and restores V17 automatically if these checks fail. Home Assistant timers/manual-control automations, cameras, SSH, Supabase agent and phones are not modified.

The **read-only on-device dry run completed** in job **10308**, with a source SHA match and **17/17 focused regression assertions** passing: six historical dark false positives, two synthetic dark walkers, four other synthetic normal scenarios, and current dark/normal threshold + transition-code assertions.

**Critical status: V18 is NOT deployed to the C720P.** The explicit production maintenance job attempt was blocked by an execution safety check before submission. Do not attempt to disguise, repackage or bypass that restriction. The active motion system remains V17.

## Verification still needed after an authorized deployment

1. Verify the on-device dry run is still passing against the exact unmodified source, backup path available and primary C720P administrative management agent healthy.
2. In an authorized execution environment, invoke the staged script with `--apply` and confirm it reports `status=installed` with fresh `frontcam-motion-v18` state. Never present a GitHub merge as installation.
3. Run an actual camera-field **human walk in light** and **in darkness**, measuring whether the webhook fires and how quickly. Simulated shapes are not evidence of real-person recall.
4. Check empty-room conditions for false `on_allowed=1` motion events, particularly while the camera undergoes brightness/exposure transitions and immediately after the lamp turns OFF.
5. Verify camera-owned five-minute off timer, user/Google/manual ON override, adequate-ambient-light no-auto-ON rule, and local HA monitoring.
6. Confirm the three Android ADB sessions and the Supabase C720P management pathway remain healthy.

## Privacy and rollback

The detector processes 160×120 local camera frames. This fix records no images, face identities, tokens or webhook URL in the repository. The original V17 script is backed up locally by the installer when it is run. Source changes are restricted to the frontcam detector and require a compiled/tested cutover.
