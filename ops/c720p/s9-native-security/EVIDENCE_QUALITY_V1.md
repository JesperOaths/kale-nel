# Face evidence content and extraction quality

This backend separates a valid JPEG, a secondary detector-supported face
candidate, image quality, and a human content label. None establishes identity.
It preserves every original, native manifest, existing crop and review decision.
No HTML or JavaScript is deployed by this feature.

## Data and resource boundaries

- Sources: the existing private `/new/api/saved` catalog and SHA-256-checked
  microSD crop relay. Images are decoded in memory and never written to the hub.
- Detection: OpenCV YuNet 2023mar, exact SHA-256
  `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4`.
  Official model source: <https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet>.
  This uses face detection only; there is no recognition model or embedding.
- The existing `person-detector/venv` supplies OpenCV. The relay imports no
  OpenCV or NumPy. The optional worker runs serially every 15 minutes, with a
  20% CPU quota, 384 MB memory limit and idle I/O priority. It stops processing
  when the phone is recording, hot, or not recording continuous 4K reliably.
- Cache identity includes the exact image name, content hash, size and source
  timestamp. Changed evidence is measured again. The HTTP reader excludes
  references that no longer match the current catalog.
- Only derived JSON and the small detection model live under private
  `state/s9-evidence-quality-v1`. No new media storage or cloud upload exists.

## Backend contract

The existing authenticated relay exposes `GET /new/api/evidence-quality`.
Each recording has an original URL, relative crop timestamps, source hashes,
secondary face scores, native detail, exposure and sharpness measurements.
`best_supported_snapshots` ranks candidates with score at least 0.9 and native
eye spacing at least 8 pixels, favoring different source times. Scores are not
calibrated probabilities. Unconfirmed images remain available in the archive.

The report contains sampled person observations and validated observation
windows when present. It explicitly leaves continuous dwell time, zone
presence, physical speed and unique people counts unmeasured. Sparse detector
samples cannot establish those measurements or prove absence.

`activity_analysis` adds day-by-hour motion-clip counts, face-evidence yield,
repeated person-candidate recording counts and recording-duration summaries.
Days run from 06:00 to 06:00 in Europe/Amsterdam. These are indexed recording
counts, not visitor counts or activity rates adjusted for camera coverage.

Private `content-benchmark.json` can hold visual content labels keyed to the
exact source image key. Its `image_labels` map accepts `visible_face`,
`not_a_face` and `uncertain`. This records image content only and does not
change keep/dismiss decisions or person folders. Benchmark counts state their
selection method; accepted-candidate precision does not measure archive recall.

## Original-4K gap benchmark

`rescan-original4k-face-gaps-v1.py` independently checks the zero-crop recordings
at five source times, using full-scene and six overlapping native-frame tiles.
It verifies decoded 3840 by 2160 geometry, deduplicates overlapping detections
within each frame, and writes metadata to `original-gap-benchmark.json`.
The API includes this result when available. This bounded diagnostic performs
no source, crop, manifest or decision writes. Non-detections remain uncertain;
five frames are not full-video ground truth. Optional contact sheets are
ephemeral diagnostic output, never files on the hub.

## Deployment and rollback

Use `deploy-evidence-quality-v1.py` with an immutable source commit, all source
SHA-256 values, and the exact live proxy predecessor checksum. Dry run first.
Apply installs one optional proxy hook and one module, verifies all original
recording references and camera health, then optionally enables the incremental
timer. Failure restores the exact proxy predecessor and removes installed units.
Keep the private backup directory printed in the deployment result.

Local/CI validation: `python3 ops/c720p/s9-native-security/test-evidence-quality-v1.py`.
The benchmark and worker share a nonblocking lock, preventing concurrent heavy
processing. Camera capture is never restarted by this deployment.
