# Task 9 V370 — isolated phone-first original-4K frame probe

Status: **SOURCE ONLY / NOT INSTALLED / NOT SCHEDULED / NOT RELEASED**. Backend Task 9 owns this candidate. Camera2, HA, human review and Playback relay owners retain their existing scope. This branch does not change any production Python, timers, routes, camera application, human decisions or already-deployed hashes.

## Authoritative intent and installed gap

The user's phone-first requirement, recorded in `offline-worker/S9_OFFLINE_RUNTIME_STATUS.md`, is all inference on S9+, not C720P. Current V304 `evaluate_one` calls C720P-side `ffmpeg` for three HTTP-fed original 4K frame decodes and on-hub OpenCV YuNet. Its old results may be temporarily useful but **do not satisfy** the required phone-first placement.

Existing S9+ primitives already include `S9StandalonePersonRoiAuditV2` for Android-side `MediaMetadataRetriever` MP4 frames (a separate person ROI use case), `S9YuNetSingleSnapshotAudit` and `PhoneYuNetLandmarkDecoder` for isolated, hash-pinned Android ONNX YuNet on a *single snapshot*, and ORT/JNI packaging for `app_process`. Those verified parts are not equivalent to a three-frame, source-qualified 3840x2160 4K evidence scan, and currently no live V304 worker invokes this new class.

## New *bounded* phone-side class

`offline-worker/S9Original4KGapAuditV370.java` is a **standalone, uninvoked** `app_process` candidate. Its only entrypoint is `--probe-one-frame clip.mp4 source_sha256 source_bytes source_revision offset_ms`. It:
- accepts only canonical S9 microSD original basenames, expected positive byte length, exact SHA-256 original bytes and a 64-hex source revision; only looks beneath its fixed original microSD archive folder
- verifies the pinned YuNet model SHA-256 on the phone before inference, hashes the original MP4 again before returning and rejects any drift
- decodes **one** `3840 x 2160` original video bitmap using Android `MediaMetadataRetriever.OPTION_CLOSEST` (no C720P video decode); refuses lower-resolution frames
- uses the full frame plus six overlapping tiles, each scaled with aspect ratio preserved into a padded 640 x 640 ONNX YuNet tensor; maps conservative candidates back to original-frame coordinates, deduplicates and caps at three per sample
- uses one ORT intra/inter-op thread, a 65-second cooperative deadline, one frame per process, bounded video length/size, and no camera/review/media writing
- produces a typed single-frame receipt with `host_attestation_required:true`, `eligible_to_publish:false`, `frame_requested_not_actual_pts:true`, zero assignments and no identity prediction. Neither a single-frame result nor an attempted invocation can mark a queue item completed.

**Important limitation:** Android `getFrameAtTime` does not provide the actual presentation timestamp of the returned decoded frame; `time_ms` is the requested offset. Before replacing the V304 sampler, acceptance must verify the semantics of the decoded frame/time offsets and original geometry against a known-good clip without weakening the source contract. An `app_process` abrupt termination, ORT output mismatch, missing JNI dependency or camera heat is an unavailable/deferred frame, never an accepted no-face measurement.

## Required guarded integration (not yet implemented or approved)

1. Keep the existing V304 queue/producer/readback running and avoid any new timer. Resolve Chat1 memory >=900 MiB, S9 temperature <=34.5 C, root >=850 MiB, continuous 4K ready/watching/buffer >=6500ms/0 output drops, source SD headroom, recording and worker exclusions, and both cross-locks. Require authorized Android app_process runtime and existing original recording writer. Camera2 PID remains unchanged.
2. Hold one V304 source/model lease; freshly read the authoritative phone catalog, current quality priority and native-pass state; compare clip/source SHA-256, byte length, revision and model. Bind the same values to each of **three** ordered phone invocations. One per-frame probe must be guarded and sampled separately to bound thermal exposure; recheck health and source after each.
3. Assemble exactly three **different** requested offsets, each containing valid 3840x2160 decoded source and at most three genuine anonymous face candidates. Reject missing/wrong-model/same-basename-other-source/changed priority/failed phone decode/unknown PTS semantics rather than treating it as an absence of a face. Never publish provisional single-frame receipts.
4. Only after non-destructive physical verification and source-pinned rollout, connect a guarded host coordinator (control/validation only) to the existing `publish` path. The original 4K frame bytes and YuNet inference must stay on S9. Maintain unchanged queue audit/versioning and downstream V369 qualified reader + V361 independent 200 acknowledgement before `completed`. Re-read V361 after completion because its receipt changes on the processing-to-completed transition.
5. Retired **currently authorized** completed evidence must remain impossible: current completed queue rows are retained until their priority/source is revoked. Archiving a completed row after priority withdrawal intentionally makes the historical evidence 410, not accessible 200. If future queue compaction archives still-current completed evidence, **both** V369 reader and V361 consumer must simultaneously gain fail-closed exact archived-completed provenance support; do not perform that migration implicitly.
6. Chat3 separately proves authenticated relay 200/400/410/503 and cache invalidation through ordinary index and quality refresh. Never interpret anonymous face detections, absent candidate boxes, provisional V3 appearance or repeated outfits as identity evidence or automatic group assignment.

## Remaining acceptance and rollback

No model, DEX, APK or isolated process is installed by this branch. The new class cannot start without an explicit external invoke and doesn't change any existing runtime. Before any future rollout, compile with pinned Android SDK and ORT AAR, run tests of ONNX 12-head geometry and native coordinate maps, then prove a single bounded phone frame in a genuinely cool-window approved session with unchanged Camera2 PID, 0 dropped output frames and original SHA. Only then implement host aggregation and worker selection; until that gate, **phone-first acceptance is not passed** and Task 9 stays open.

The existing production reader/consumer hashes and queue history are unchanged by these source-only additions. No user review history can be retrofitted as verified evidence.
