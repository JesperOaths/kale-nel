# S9+ detection and review release — 16 October 2026

This release fixes specific recall and false-trigger paths. Detector outputs
remain candidates; this is not a measured person-detection accuracy claim.
No cross-recording biometric identity matching or automatic folder assignment
is implemented.

## Detector and recording changes

- Live inference checks up to ten simultaneous candidates in separate,
  short-lived motion hypotheses. One stronger false box no longer replaces
  every other candidate. Unique-frame, local-motion and spatial checks remain.
- A stronger motor-vehicle prediction can reject a contained false person box
  even when its whole-vehicle IoU is small. A separately localized person
  beside a car, or with a head above the vehicle roof, is retained by this
  containment rule. Vehicle presence alone never rejects the whole frame.
- Post-record classification applies the vehicle checks too and searches the
  overlapping regions after finding a person. Native 4K review uses narrower
  tiles and the correct source-image aspect ratio.
- Duplicate suppression previously discarded boxes smaller than 0.4% of the
  image. Its numerical noise floor is now 0.045% (about 3,700 pixels at 4K),
  preserving smaller, distant candidates without declaring them people.
- Review requests 16–32 overview frames and up to eight follow-ups, with a
  maximum of 40 native frames. The nine current verified clips have overview
  gaps below 600 ms. Longer clips remain bounded sparse samples.
- All decoding, detection, histograms and exact-PTS crop extraction run on
  SM-G965F. Capture interruption and temperature limits remain in place.

The continuous recorder, encoded-PTS stop timing, sloped garden ROI, 5-second
pre-event target and 10-second motion tail remain based on the pinned v11
recorder. Original compressed recordings are not rewritten or deleted.

## Review workbench

The inbox includes isolated detections by default, clearly labelled as weak.
Coverage reports distinguish all Archive clips from current owner-verified
Person / People clips. Only the latter feed this workbench and phone queue.

Colour/scene comparison sets use exact upper/lower named colour tags and
entry/exit zones. These are temporary comparison sets, can contain different
people, and never create a review folder. Histogram-distance ordering is
available within human review. Real folder contents require explicit crop
confirmation and manual assignment. Notes, labels and old extraction reviews
are retained; changed crop geometry requires confirmation again.

The overview places comparison sets beside saved folders with native crop
previews. The inbox groups views by recording, keeps one principal crop,
collapses extra details, and shows bulk actions when crops are selected.
Selections are capped at 100. Folder navigation clears temporary comparisons
so a previous comparison cannot silently hide folder contents.

The live camera panel now has a natural 16:9 height and its own scroll region,
with recording/settings links and expandable status below the camera.
Desktop and 430×650 mobile scrolling were checked using synthetic footage.

## Source, installation and recovery

- Canonical preparation: `prepare-detection-phone-v39.py`, invoked against
  freshly staged Java sources from `ae547c163909940047a74fcada4a367a0cb972e1`.
  It calls guarded historical patchers; direct V37/V38 preparation refuses
  the current source tree. Do not compile the historical repository recorder
  classes directly or deploy the entire older branch.
- All 26 generated Java source hashes reproduced exactly after the final
  patcher guards. `Continuous4KEncoder`, `Encoded4KRing` and `MotionGrid`
  exactly match their pinned source hashes.
- Installed V39 APK SHA-256:
  `c8bddd3812964ce161cf5027d766303752bf0f45ba1aaf2c457ff2a3d9f75228`.
  Signing certificate, manifest, model assets and native libraries are retained.
- Actual live detector policy: `person_multicandidate_transport_v38`;
  review sampling: `native_4k_dense_small_people_v39`;
  counting: `anonymous_small_candidate_v39`.
- Hub receipts: `state/s9-visual-attributes-v36/detection-hub-v39-release.json`
  and `detection-pipeline-v39-verification.json`.
- Phone receipts: `build/s9-detection-review-v39/release.json` and
  `deployment.json`. The APK was built in RAM scratch to protect limited root
  storage; an exact copy is also retained in the operator's
  `work/detection-phone-v39-stage/s9-detection-review-v39.apk`.
- Phone rollback: `backups/s9-detection-review-v39/before-20261016T185019Z.apk`
  (V38); earlier V37 is retained under `backups/s9-detection-review-v38/`.
- Hub rollback source/SQLite manifests are under
  `backups/s9-detection-review-v38/20261016T184104Z/` and
  `backups/s9-detection-review-v39/20261016T184954Z/`.
  Later compact-layout backups are recorded in the final hub receipt.
- UI cache version: `detection-review-v39b-20261016`.
  HA entry backups are `/config/.storage/lovelace.c720p_hub.before-security-entry-v36-*`.
  Preserve original media and the current manual review database on rollback.

## Verification

35 catalog tests, nine phone-status tests and four playback lifecycle
regressions cover the changes. Seven Java suites also ran on the physical S9+,
including vehicle containment, adjacent pedestrians, multiple candidates,
duplicate/stale frames, small-person retention and queue safety. The temporary
device test jar was removed.

`verify-detection-pipeline-v39.py` checks both catalog services, all currently
verified native-4K jobs, original source digests, crop dimensions/checksums,
exact timestamps, original video byte ranges, default weak-candidate access,
authentication/manual intent, source receipts, APK hash and live capture.
Footage and descriptors remain on the phone/hub; browser proof uses synthetic
images in an isolated review database.

Final live acceptance: **16 checks passed**. All nine current positive Archive
verifications completed V39 processing: **287 native frames**, 58 follow-up
requests, 39 temporally supported candidate views and 39 weak views. The
largest job decoded 39 frames and took 50.537 seconds. These counts describe
candidate views and do not establish the number of people or detection
precision/recall. Production manual folders/actions remained zero; the
browser's example folder was created only in the isolated synthetic fixture.
Live capture was 30.02 fps, 36.7 °C, with zero dropped output frames and zero
review errors at the acceptance checkpoint.
