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

## Live rollout — 11 October 2026

Confirmed on the **C720P/S9+**, not source-only. Pinned APK source revision `351aae729105c19539ebf79eedad9e2f789977a2` compiled and was signed on the C720P, after verifying the installed and replacement app share signer certificate SHA-256 `0ca669482a7b5bc4698eae4ba43897b913177f87907418a8231b95e830675bb5` and carry the same existing face model SHA-256 `2254b01065c1f69ff501e9501042441b85323710e3d5a7b6be04a5084b647651`.

- Guarded upgrade agent job **10097**: **done**, exit code **0**, one attempt. APK SHA-256 `3b29ad2315988f5b1c2d0c169342ec25f16e087879340f4b6d9e73360e895e0e`, 10,019,536 bytes. The existing app was backed up before reinstall; Camera2 restarted healthy in **watching** mode, the snapshot was ready, the 24/hour configured video admission policy was preserved, battery temperature was **34.6°C** and SD had **79,602,253,824 bytes available**. Live native `/status` explicitly advertised the new `capture_event_version` and `thumbnail_selector`.
- Signed previous-APK rollback: `/home/jespern/c720p-home-hub/backups/native-security-cutover/S9-native-before-night-guard-20261011-090409.apk`.
- Authenticated Home Assistant metadata/gallery agent job **10098**: **done**, exit code **0**, one attempt. The local catalog and V5 Saved Clips HTML were updated, the microSD index service completed, and only the authenticated archive service restarted. Catalog SHA-256 `9a377a2c9f3b68a276e243a32d8f29a657150df0ac2253d7478ad7ac46be4399`; HTML SHA-256 `c0e9248fbd2e01e610377b6a888e75eb39bbc86b33e21f54049b25cf91bd50ee`.
- Catalog and HTML rollback: `/home/jespern/c720p-home-hub/backups/s9-event-v3-hub-publication/20261011T070707756325Z`.
- Source tests: **S9 Event Capture V3**, **S9 Native Security Source Safety**, and UI regressions passed for the pinned feature-source commit. A subsequent unrelated repository-wide GEJAST watermark check concerning `s3-motion-health-panel.html` failed on later commits; that is not evidence of a camera defect.

**Acceptance still outstanding:** no newly captured real person walk-by or 120-second continuous event was observed during this rollout, so 4K segment chaining, person classification and cover-image quality on actual new recordings have not been empirically validated. The installation is confirmed, not the accuracy or visual suitability of future event evidence. No original MP4 file was deleted or uploaded by this release.
