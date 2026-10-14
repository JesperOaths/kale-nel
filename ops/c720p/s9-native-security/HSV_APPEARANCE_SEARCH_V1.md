# S9+ HSV appearance search v1 — staged source, not deployed

## Scope

Native S9+ review already decodes sampled **original 4K microSD MP4** frames on its
serialized background worker. It now also extracts small, bounded HSV colour
histograms for isolated high-confidence upper/lower clothing observations and
detected vehicles. No additional Camera2 capture session, network upload,
continuous frame processing, or C720P video decoding is introduced.

The legacy coarse RGB outfit comparisons remain intact. This is a **distinct
appearance search module**, not facial identification, matching of persistent
visitor IDs, identity probabilities, body shape, posture, or gait signatures.
Equal colour distributions do not establish common identity.

## On-phone files and schema

- Code: `src/nl/kalenel/s9security/AppearanceSearchIndex.java`.
- Database: existing **S9+ microSD** `Security4K/appearance-hsv-v1.sqlite`.
- `clips`: `clip_name`, `start_ms`, `end_ms`, `scene`.
- `observations`: clip, frame offset, region category, rough garden/street zone,
  dominant OpenCV-compatible HSV bins, three primary RGB bins, and little-endian
  float32 L1-normalized 18×8×8 histogram blob.
- Derived index can be rebuilt; original MP4 and verified JSON are authoritative.
- Only completed `motion_<13 digit epoch ms>.mp4` clips are indexed.
- Missing/underexposed crops remain unindexed, not declared negative sightings.
- Upper and lower clothing intentionally exclude head regions; vehicle regions
  are indexed separately. Scene zone is a geometric approximation using the
  existing garden boundary, not a ground-truth location classification.
- Review manifest adds `appearance_search_version`,
  `appearance_search_status`, `appearance_search_observations`, and
  `appearance_search_claim`. Failure is nonfatal, preserves the MP4, and is
  marked `index_unavailable_original_preserved`.

## Ranking

`AppearanceSearchIndex.search(referenceBitmap, category, zone, fromMs,
untilMs, metric, limit)` ranks one result per clip by its best observed crop.
`searchByClip(referenceClip,...)` uses the first stored matching observation as
a search reference and avoids decoding further video.

Supported categories: `upper_clothing`, `lower_clothing`, `vehicle`.
Optional zones: `front_garden`, `background_street`, `unspecified`.
Metrics: `bhattacharyya` (default), `correlation`. Correlation maps [-1,1]
into [0,1]; Bhattacharyya similarity is 1 minus normalized distance.
**The score is colour resemblance, NOT probability of identical objects or
people.** Query returns 50 clips maximum; scanning is capped at 4,000 newest
observations, so very broad old-date searches may be incomplete.

Read-only local phone HTTP interface (bound to 127.0.0.1:8808):

```text
GET /appearance/search?clip=motion_1770000000000.mp4&category=upper_clothing&zone=front_garden&method=bhattacharyya&limit=20
```

Optional `from_ms` and `until_ms` are UTC epoch milliseconds. The response
contains ranked clips, local relative frame offsets, zones, scores, index
version, and `verified_same_person=false`. This interface is **not yet exposed
through the Home Assistant signed relay**. Do not expose the phone's loopback
service publicly. The HA UI needs an authenticated allowlisted read-only proxy
and source-thumbnail selection in a later stage.

## OpenCV reference and testing

`s9_hsv_search_reference.py` implements `cv2.calcHist`,
`cv2.compareHist`, SQLite insert, and parameterized time/attribute search
against the **same database schema** as Android. It is for parity testing on
sample crops and diagnostics, not for running routine S9 workloads on C720P.
`test-s9-hsv-search.py` covers synthetic blue/red/green crops, distinct object
types, zone/time filtering, best-per-clip scoring, idempotent indexing, and
non-biometric constraints. The dedicated CI workflow installs pinned OpenCV
headless/Numpy and runs these tests. Existing S9 CI compiles Android sources.

## Deployment guardrails (important)

1. Merge only after Android compilation and Python tests pass.
2. Do not run an automatic APK deployment. Preserve the currently signed and
   running 4K recorder APK for rollback.
3. Use the existing immutable-source build and guarded phone upgrade method.
   Validate that recording is idle before the upgrade.
4. On the actual S9+ verify: 3840×2160 native MP4, 5-second 4K pre-roll and
   10-second post-motion policy, healthy preview, phone GPU review, thumbnail,
   original manifest, `appearance_search_status=indexed_on_phone`, valid
   SQLite rows and search response, temperature, and available microSD storage.
5. Compare histograms/colour rankings against labelled day/night garden clips
   before treating thresholds as useful. Preserve all recordings on an indexing
   failure; the index must never decide deletion or alarms.

No on-device or Home Assistant release is claimed by this source change.
