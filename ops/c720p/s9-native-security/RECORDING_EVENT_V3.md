# Stage 3 — event-linked native 4K capture and crisp evidence covers

This stage modifies the existing **S9+ Camera2** service and after-recording review; it does not switch to the experimental Stage 2 detector model. Preserve the current signed APK as rollback before any installation.

## Logical event and physical segments

- Existing native person-gated start remains intact. Motion (inside configured garden ROI) and confirmed garden-person inference are evidence for continuation. A single AI score does not start a new recording.
- Every **successfully started** MediaRecorder session begins an immutable logical segment. It writes a new `motion_<epoch_ms>.mp4.recording`; the original file is only promoted to `.mp4` after MediaRecorder finalization and 3840×2160 verification.
- On **120-second maximum segment duration**, the service finalizes the current MP4. Only if fresh garden event evidence exists does it attempt to begin a new segment when the preview capture session is ready, through the existing hourly-cap, temperature and free-space guards.
- A visitor who returns within 12 seconds of the previous physical segment's end may inherit the same logical event ID. The **event ID is not a person identity** and is not comparable across app process restarts.
- Camera2/MediaRecorder are reconfigured between MP4s. **This is not frame-perfect, gapless recording.** The recorded physical reconfiguration gap is exposed in milliseconds. Other reasons, including ordinary quiet end, never automatically force another recording.
- Failed finalization leaves the original `.recording` for forensic recovery and resets event-lineage state; no clip is deleted because its classifier produced a negative.

## Evidence and thumbnail selection

- As soon as a physical MP4 has been verified, a separate evidence writer queues `<clip>.capture.json`. It records segment index, prior filename, stop reason, gap and the fact that the annotation is not human-verified. An eventual classifier failure cannot erase this basic capture history.
- The existing post-recording S9+ classifier hashes the **original 4K MP4** and samples up to 12 frames, unchanged scene classification policy. This stage additionally ranks thumbnail candidates using garden-person score, focus, contrast and foreground motion, then attempts up to two near-event precise-seek images. Selection is on the **S9+**, not the C720P.
- The 1200px JPEG cover is encoded at JPEG quality 92. The model-confidence, focus and seek details are recorded in the verified JSON manifest. No MP4 video data or person identity is transformed into a thumbnail.
- The authorized C720P catalog allowlists event metadata and labels its provenance explicitly. The Security recordings browser marks **same event · segment N · X.Xs gap** for multi-file events. It does not call this seamless video or a person identification.
- Existing earlier recordings remain intact. The sharpness-aware algorithm applies to **new recordings after a successful APK upgrade**; this stage is not a bulk historic-thumbnail rewrite.

## Gate to production

Source CI: `S9 Event Capture V3`, `S9 Native Security Source Safety` and existing `S9 Security UI V4 isolated` checks must pass. On C720P, compile and sign from the **same immutable revision**, verify the phone's existing face embedding model matches the packaged model, and verify current/new APK signer certificate fingerprints match. Back up the old APK. Only during two consecutive healthy idle-camera checks may the guarded rollout stop Camera2 and install. If readback/health fails, restore the previous APK and restart Camera2.

After installation, inspect `/status` for `capture_event_version`, original native 4K state, snapshot age, temperature, SD space and zero camera failure increments. Await a genuine new motion event and verify **actual** MP4 size, dimensions, `.verified.json` capture metadata, thumbnail focus fields and authenticated Home Assistant playback. A single short clip cannot prove the 120-second continuation path; that requires a real long garden visit or isolated nonproduction test.

Do not claim production success from compilation or a signed APK alone. No new classifier model, cloud upload, automatic clip deletion, persistent person identity, or 4K pre-roll is added.
