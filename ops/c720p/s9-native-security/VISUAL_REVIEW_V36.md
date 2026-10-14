# Original 4K attributes and manual review V36

## Live result (14 October 2026)

The S9+ runs the visual attribute worker. C720P serves private crops, metadata,
manual review state and original byte-range video. The new workbench performs
no face/body embedding extraction, biometric comparison or automatic identity
grouping. Colour-distance results never create folder assignments.

Verified release checkpoint: **29 original 3840×2160 recordings, 417 native
decoded frames, 73 anonymous tracklets and 146 published exemplars**. The actual
decoder reported `OMX.Exynos.avc.dec`. Capture remained watching at 30.02 fps,
34.2°C, with zero dropped output frames and zero visual-review errors. This is
an incremental processing checkpoint, not a claim that the entire archive has
finished or that detection counts have been established as ground truth.

The active signed APK SHA-256 is
`5548aece5864cfb9bae96211aa4d15375e59892f822b186ce20cd0c223c74bb0`.
Its assets, native libraries, manifest, signing identity and recorder helpers
are preserved from unified v11. The encoded-presentation-timestamp stop clock,
5-second pre-event target, 10-second post-motion hold, garden ROI and
`person_spatiotemporal_transport_v9` remain in place.

## Processing and provenance

`Native4KFrames` seeks preceding H.264 keyframes with MediaExtractor and decodes
to full-resolution YUV images with the Exynos MediaCodec decoder. Every saved
crop carries its actual decoded presentation timestamp, original pixel box,
native crop dimensions, size, digest and JPEG quality 96. Crops are not enlarged
to 4K. Full-box and upper-region exemplars are selected independently by native
Laplacian variance, visible area, centrality and clipping penalties. An upper
region is a geometric review crop, not a detected/identified face.

`VisualAttributeReview` checks original MP4 dimensions and SHA-256 and checks
the source digest again before publication. It samples at most 16 frames per
clip within a 65-second budget. It runs on the existing serialized phone review
executor, after at least 15 seconds without garden movement, only while
watching, below 37°C, and with over 15 GiB available on microSD. Capture or heat
preempts between frames and during hardware decoding. Originals are immutable.

Metadata is stored beside the original as `motion_<timestamp>.mp4.visual-v36.json`;
`VisualCrops/` stores JPEGs. New-format completed reviews also register the
sidecar digest/reference in the existing verified manifest without overwriting
human fields. Initial V36 reviews remain readable with optional fields absent.

Upper clothing excludes the top 20% of the detector box; lower clothing uses
55–95%. Each has normalized 32-bin HSV and 32-bin LAB histograms and top-three
quantized colour palettes. Other fields describe garden entry/exit zones,
image movement, average detector-box aspect/height and garden depth. These are
camera-image observations, not physical body dimensions, posture, gait or
world-space speed. Nearby-object flags are spatial candidates from repeated
detector observations, not confirmed interactions. Parcel carrying is explicitly
unavailable because the preserved detector has no parcel class.

## Counting and clip-local deduplication

`AnonymousClipTracks` suppresses spatial duplicate boxes in confidence order,
preserves distinct nearby people, and associates detections within a recording
using bounded trajectory projection, box scale/overlap and coarse clothing tags.
IDs restart for every clip. Temporal gaps never establish cross-recording links.

Tracklet totals, raw peak detections and repeatedly concurrent detections are
separate fields. A group requires the same clip-local track pairs on at least
two observations separated by 500 ms, with all members actually seen together.
Two unrelated multi-box frames cannot corroborate a group. Fragmentation alone
cannot increase the repeatedly concurrent count. Weak group evidence stays
unreviewed. The live saved catalog overlays these bounded sampled counts after
successful visual review, without editing independent owner verification.

## Catalog and review interface

Authenticated endpoints on 8794 and loopback endpoints on 8795:

- `GET /new/api/visual-review`: colour, direction, entry/exit zone, timestamp
  window, manual folder and ordering filters; bounded pagination.
- Add `reference=<observation>` to order by upper/lower clothing histogram
  distance. No geometry-based identity scores or automatic groups are produced.
- `GET /new/api/visual-review/crop/<exact-basename>`: current-source membership,
  size and SHA validation, private headers and a RAM-backed cache capped at
  50 MiB / 100 files, with bounded phone reads.
- `POST /new/api/visual-review/review`: manual create/edit folder, assign,
  unassign, label/note/pin; requires trusted HA Origin,
  `X-S9-Visual-Review-Intent: manual-attributes-v36`, human confirmation and the
  current revision. Bulk operations are transactional and limited to 100 views.

SQLite at `state/s9-visual-attributes-v36/review.sqlite3` stores manual labels,
folders, notes, pins and audit history independently of model sidecars. Source
or geometry changes require recheck; earlier notes remain available. Deleted or
changed source media disappears from the active catalog even if a crop is cached.

The People & faces and Tracks destinations, including `face-appearances.html`,
use the shared workbench. Archive, Recordings and `clips.html` retain their
existing playback, verification and deletion tools and add manual-folder/4K
review entry controls. Crop clicks open the original MP4 at the crop timestamp;
comparison, checkbox bulk assignment and drag-to-folder are available. No lower
resolution playback substitute is selected by this workbench. Older approved
Drive videos that are 1080p are retained in Archive and are never labelled 4K.

The index timer is `c720p-s9-visual-index-v36.timer` (30 seconds after each run).
Only JSON metadata is indexed on the hub; no hub inference or video decoding is
part of this worker. The HA Security cache key is `visual-review-v36b-20261014`.

## Validation and recovery

Seventeen Python regressions cover provenance, native crop bounds, histogram
validation, source removal, manual-review persistence/recheck, revision races,
manual-only colour sorting and count semantics. Java track tests and eight
focused count regressions pass; the count regressions also ran on the physical
S9+ with `app_process`. Synthetic browser testing verified comparison, manual
folder creation, bulk assignment, notes/pins surviving reload, and colour
filtering/sorting. No private camera image was exported for browser testing.

Live checks passed on both API ports, including anonymous 401, missing-intent
403, invalid-filter 400, actual crop checksum/native JPEG dimensions and
original video HEAD plus 206 byte-range delivery. Raw crop dimensions in the
sample were 285×321 and 285×177; these are native crops from 4K originals.
Detection accuracy cannot be inferred from these checks without human labels.

Persistent receipts:

- `build/s9-visual-attributes-v36/release.json` and `deployment.json`.
- `state/s9-visual-attributes-v36/hub-release.json`, `pipeline-verification.json`.
- Signed pre-update APKs:
  `backups/s9-visual-attributes-v36/before-20261014T172804Z.apk` (unified v11),
  `before-20261014T173836Z.apk` (first V36). The v11 copy shares storage with its
  identical build APK after digest verification; either pathname remains usable.
- Initial 14-file hub rollback:
  `backups/s9-visual-attributes-v36/20261014T173250Z/restore.json`.
  Final source rollback manifests are in the sibling `final-*` directories.
- HA dashboard backup:
  `/config/.storage/lovelace.c720p_hub.before-security-entry-v36-20261014T182639Z`.

Stop the visual index timer before a hub rollback. Restore the exact files from
the chosen manifest, restart the relay and archive user services, and preserve
the independent review database. Phone rollback uses a verified saved APK with
`adb install -r -g`, then launches the exported CameraActivity and checks live
4K/GPU/temperature/status health. Keep the established direct ADB, SSH and
outbound maintenance-agent routes intact.

## Rebuild contract

Do not compile this branch's historical camera sources as a phone replacement.
Stage the **21 Java sources from immutable unified-v11 revision
`ae547c163909940047a74fcada4a367a0cb972e1`**. The public
`visual-phone-v36-base-sources.json` pins each file. Run
`prepare-visual-phone-v36.py <fresh-stage>` to apply only the V36 changes and
add two helpers; stage the two Java test classes too. Transfer that stage and
run `build-visual-phone-v36.py <stage>` on the hub. It validates TFLite dependency
digests, runs Java regressions, preserves the v11 APK's non-code entries and
signer, and records all 23 source hashes. `deploy-visual-phone-v36.py` separately
guards the installed hash, backs it up, waits for a safe idle window, installs
and verifies capture with rollback on failure. Never bypass its newer-version
guard. The previous broad PR remains a draft because its legacy Android changes
must not replace independently upgraded phone software.
