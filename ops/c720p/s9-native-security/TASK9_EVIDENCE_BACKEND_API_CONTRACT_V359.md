# Task #9 backend consumer contract (V359, source-only checkpoint)

Owners: **Task #9** maintains evidence admission, queue, V3 appearance provenance and revocation; **Playback relay deployed** owns authenticated relay/UI integration. **Storage repair status** owns root reserve, NTP and historical joiner. No shared UI, Camera2, manual review, identity or Save/Delete changes belong in this release.

## Downstream qualified original-4K gap evidence

Existing authenticated internal endpoint: `GET /new/api/evidence-quality` (inner C720P loopback 8795, externally only via existing authenticated relay; do not create public endpoints).

On HTTP 200, `ok: true`, `original_gap_benchmark` is an object with: `analysis_version: "s9_original4k_independent_gap_benchmark_v1"`; `detector_model_sha256` (64 lowercase hex), `source_binding_status: "source_qualified_active_queue_only"`, `source_bound_records_visible` (non-negative integer), `source_bound_records_not_current` (non-negative integer), `original_recordings_modified:false`, `identity_inference_performed:false` and `recordings` (array).

Each eligible recording contains `clip_no` (canonical `motion_<13digits>.mp4`), `source_sha256` (64 lowercase hex), `source_bytes` (integer bytes), `source_revision` (private native catalog revision, 64 lowercase hex), `model_sha256` (64 lowercase hex), `analysis_version`, `duration_ms` (milliseconds) and exactly three original-resolution `samples` (`time_ms` integer milliseconds, `state:"decoded"`, `original_resolution:[3840,2160]`, `face_candidates` array). This is anonymous detector evidence only, not a person or identity decision. The exact row must be returned from the **actual HTTP consumer** before the queue worker can mark `completed`. An internal file write or queue status alone is insufficient.

Eligibility depends on **fresh private original catalog SHA+bytes+revision**, same detector/model provenance, current native face-pass revision, zero new indexed face crops, and an active valid rescan lease or verified completed status. Revoked, stale, superseded or unsupported results **must not appear** in the qualified `recordings` array. Historical unqualified results can remain on disk solely for audit. Missing catalog, queue, model, status or source verification fails closed rather than returning positive eligibility. Exposed events require human review; they do not file or identify a person.

## Queue V304/V358

Private queue `state/s9-priority-rescan-v304/queue.json` schema `s9_priority_rescan_feedback_v304`: revision integer, rows with immutable SHA-derived ID, exact source digest/size/revision, native pass, analysis/model, state, retry count, deferral count, next-attempt UNIX seconds and lease-until UNIX seconds. States are **pending**, **processing**, **completed**, **blocked**, **rejected**, **dead_letter**. Same model non-detections remain explicitly `blocked`; no repeated unproductive rescan. Attempts bounded 3; transient deferrals bounded 8; request cannot proceed below 850 MiB free root or without native 4K/thermal/idle locks. Current source patch #1124 archives only **obsolete terminal revisions** in private 0600 `retired/<sha-id>.json` before removing from active 340-slot queue. Current completed and blocked rows stay in queue and remain visible to the reader. Capacity overflow is separately reported as `capacity_deferred`, not silently completed or dropped. These are source contracts until a real physical deployment is attested.

## V3 anonymous appearance — provisional, not identity-ready

Existing authenticated route: `GET /new/api/appearance-multivector-v3?clip=<canonical-MP4-name>`. It verifies the active V3 corpus ID, source-crop SHA, V2 historical baseline, visual model SHA `ee5717ad7a90cf0c915afa1fb6a5399b966562c5d42aa6f4a0c6c84a5349e47d`, uniform HSV32 method and on-phone ranking SHA. It **does not** currently bind each source crop to a freshly rehashed and revision-matched original video. Therefore it cannot certify a currently valid person reference or downstream identity/evidence admission.

V359 HTTP 200 success body retains `ok:true`, `corpus_id` (16 lowercase hex), `model_sha256` (64 lowercase hex), `metric:"osnet_75_uniform_torso_hsv32_25"`, `coverage.real_person_crops` and `coverage.qualified_recordings` (integers), `appearance_only:true`, `verified_same_person:false`, `identity_probability:false`, `automatic_person_assignments:0`, `human_review_required:true` and `results[]` with candidate source clip, similarity percent [0,100], and no identities. The **new explicit fail-closed fields** are:

```json
{
  "status": "provisional_appearance_only_original_revision_unverified",
  "source_binding_status": "crop_and_corpus_sha_valid_original_revision_unverified",
  "evidence_consumption_eligible": false,
  "person_reference_eligible": false,
  "source_current_at_utc": null,
  "revalidation_required": "fresh_original_sha_bytes_revision_and_human_review"
}
```

Consumer requirement: show this output **only as a provisional appearance comparison**, never as an approved person reference or an automatic filing recommendation. Do not translate the score into an identity probability. HTTP 400 errors are `one_clip_required` / `invalid_clip`; 404 `no_verified_v3_person_crop`; HTTP 503 `v3_appearance_index_not_ready`. All are `{"ok":false,"error":"..."}`. The 503 is unknown/not-ready, not a negative observation. No recording or video identity data should be logged in health or receipts.

## Real release and UI acceptance gates

The backend changes in #1107, #1115, #1117, #1124 and V359 need **separate source-pinned, preimage-checked authorized installation** with preserved rollback, no competing workers and coordination with Playback's shared relay; no source-only success is production acceptance. Verify current source hashes and camera safety before installing. Verify authenticated true end-to-end gap feedback, queue retry and archive retirement over restart, revocation on mutated source/model/native-pass, V3 flags at existing authenticated route, unchanged original media/human reviews/people groups, zero dropped Camera2 4K frames and adequate root/memory/SD headroom. Record deployed hashes and redacted job IDs. Do not bypass Tailscale/SSH access policy or media guards.

Live blocking facts measured 21 Oct 2026: cloud queue revision 14 = 277 rows (27 pending, 245 blocked same-model, 5 completed); at last physical receipt #12344 old evidence reader SHA `af06dad6e7b2ecb88feaedd0c81f898ef684a5e4678ce6d44054bcb9b38b663b` lacked new source attestation; #12345 found 5 qualified + 16 old unqualified secondary rows. Root storage around 829 MiB is less than the guarded 850 MiB worker admission requirement. Do not lower it.
