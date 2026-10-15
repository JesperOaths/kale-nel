# On-phone temporal review and Security workbench — 15 October 2026

V37 is deployed. The final completed run processed **all 9 currently verified
original-4K S9+ recordings**, decoding **163 native frames** with **41 follow-up
requests**. The catalog contains **27 candidate crops: 17 temporally supported
views and 10 weak views kept separately**. These are model candidates, not 27
people or an accuracy measurement. No production crop was manually confirmed
and no production folder was created by the agent.

## Phone processing

- `ClipReviewSchedule` requests 8–16 overview frames, adding nearby native
  requests at +220 ms / +550 ms for fresh candidate tracks. At most 12 extra
  requests and 28 total requests are scheduled. Actual decoder PTS values must
  increase. Short clips and near-duplicate requested timestamps are bounded.
- A single detection cannot supply a repeatedly observed person count. A track
  requires at least two distinct observations spanning 500 ms. Repeated groups
  additionally require corroborated co-occurrence of the same clip-local tracks.
  Neither temporal support nor a detector score is human confirmation.
- The original Exynos decoder and 3840×2160 crop extraction are retained. Full
  and upper crops carry exact PTS, native pixel boxes, dimensions and hashes.
  V37 crop names contain `.v37.` to preserve earlier derivatives. Original MP4s
  are immutable; the previous sidecar is retained as
  `.visual-v36.before-temporal-v37.json`.
- The private hub sends `visual-review-queue-v37.json` containing current human
  Person / People decisions and current file sizes. The phone validates the
  bounded list, names, file sizes, human flag and issue time. A missing or stale
  queue fails closed after 10 minutes. The queue refreshes on the existing index
  timer. The phone rechecks permission between decoding/inference steps.
- Review still runs on the existing serialized executor only while watching,
  below 37°C, with sufficient microSD space, and after 15 seconds without motion.
  Capture preempts review. Recorder helpers, assets, native libraries, manifest,
  signer, garden detector, pre-event target and 10-second tail are preserved.

The exact installed APK SHA-256 is:
`d0582c3a1aa0103617c7ddea3db4ce182bf025f273c2da6266c9771faf2a6f05`.
The preserved recorder source remains unified-v11
`ae547c163909940047a74fcada4a367a0cb972e1`.

## Hub and tabs

- Sidecar refresh now compares sidecar digests, so a reprocessed recording is
  reindexed even when its original video size is unchanged. Verified recordings
  have indexing priority. Source-size and digest validation remain enforced.
- `support=supported|weak|all` separates weak detections without deleting them.
  The default contains repeated observations or explicitly confirmed crops.
  Human-confirmed weak crops remain usable. `clip=<exact-name>` narrows review
  to a recording. Archive verification remains mandatory for every view/crop.
- **People & faces** opens on manual folder tiles with confirmed crop/recording
  counts, folder notes and a review inbox. Confirmation and folder assignment
  remain explicit human actions. Existing labels/notes are retained on changes.
- **Tracks & movement** groups observations under their recording, shows one
  native crop per track and the sampled time span, entry/exit and image movement.
  This is clip-local motion, not gait or cross-recording identity matching.
- **Evidence & analytics** separates Human review from Detector classification.
  Filtering human verification also filters totals, charts and exports. Human
  decisions require matching source bytes; unavailable verification is not
  labelled unreviewed. Detector metrics and timed observations are expandable;
  repeated score/sample badges were removed from evidence cards. CSV exports
  include the human verification separately.
- Embedded tabs share the outer title/Refresh controls. Refresh preserves the
  current tab's filters, review folder and Archive source. Inactive workbenches
  stop periodic polling. Nested Archive review dialogs keep their own controls.
- Archive still defaults to S9+ microSD; Drive remains historical storage.
  Verification, selection, deletion and playback controls are retained.
  All four live camera controls remained available.

No face/body embeddings, biometric identity matching or automatic folder
assignment were added. Repeated background false positives can still occur;
review confirmation and rejection remain necessary.

## Verification

- 33 isolated catalog/review tests passed, including weak-view recovery, queue
  scope and reloading revised sidecars while original bytes stay unchanged.
- Four playback lifecycle regressions passed for hidden-tab suspension and
  preventing delayed playback or live retries from restarting a hidden player.
- JVM track/count/scheduling suites passed. Four suites also ran on the physical
  S9+ with `app_process`, including ten queue safety checks for missing/stale/
  future queues, changed sizes, unconfirmed references, traversal and duplicates.
- All 25 Android source hashes reproduced exactly from the pinned v11 sources
  plus the V37 preparation steps. The signed build retained original non-code
  APK entries and the existing signing certificate.
- Synthetic browser checks covered folder home/inbox separation, confirmation
  of weak crops, manual folder assignment, refresh preserving filters, movement
  timelines, human-review analytics totals and populated camera controls. The
  changed folder layout also fit the 430-pixel mobile breakpoint. No private
  camera footage was exported for browser testing.
- Fourteen final live acceptance checks passed: both catalog services, all nine
  native 4K jobs, verified-only processing, unchanged original digests, weak-view
  separation, invalid-filter rejection, private access/manual-intent gates,
  native crop hashes/dimensions, original HEAD/range video, four camera controls,
  deployment hashes, final UI assets, exact installed APK and healthy capture.

Final camera checkpoint: watching, **30.01 fps**, **35.8°C**, zero dropped encoder
frames and zero visual-review errors. The original hashes for all nine recordings
matched their preserved pre-upgrade sidecars. Production manual state remained
zero folders / zero actions.

## Release files and rollback

Private hub receipts:

- `build/s9-temporal-review-v37/release.json`, `deployment.json`.
- `state/s9-visual-attributes-v36/temporal-hub-v37-release.json`.
- `state/s9-visual-attributes-v36/temporal-pipeline-v37-verification.json`.

Phone rollback:
`backups/s9-temporal-review-v37/before-20261015T212213Z.apk`, SHA-256
`5548aece5864cfb9bae96211aa4d15375e59892f822b186ce20cd0c223c74bb0`.
Hub source/SQLite backup:
`backups/s9-temporal-review-v37/20261015T212140Z/restore.json`.
Final static-page backup:
`backups/s9-temporal-review-v37/final-20261015T213124Z/restore.json`.
HA entry backups:
`/config/.storage/lovelace.c720p_hub.before-security-entry-v36-20261015T212208Z`
and `...20261015T213132Z`. Final cache: `temporal-review-v37a-20261015`.

For rollback, preserve newer human decisions and original media. Stop the index
timer before source restoration; use guarded source/APK hashes and the existing
direct ADB route. Keep SSH and the outbound maintenance agent alive. Restoring a
previous sidecar may require its preserved crop names; V37 keeps those crops.

For a fresh build, stage the 21 immutable v11 Java sources, then run
`prepare-temporal-phone-v37.py` to create the 25-source tree. Stage the three JVM
test classes and run `build-temporal-phone-v37.py`, followed separately by
`deploy-temporal-phone-v37.py`. The legacy V36 preparation command now refuses
the newer source tree. Do not install historical branch recorder sources or
merge the broad legacy Android diff over the independently deployed recorder.
