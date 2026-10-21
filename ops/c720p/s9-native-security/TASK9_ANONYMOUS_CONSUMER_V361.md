# V361 — source-revalidated anonymous evidence consumer (Playback API handoff)

**Status: source-only; no C720P installation, HTTP route, verified runtime or user interface claim.** Owner: Task #9 backend. Playback alone may register the authenticated relay/handler and render it; no new public endpoint is authorized. The other Task #9 owner recently landed PR #1124's obsolete-revision archive and PR #1126's provisional V3 flags. This module does **not** modify either shared implementation.

## Proposed private method

`s9_anonymous_evidence_consumer_v361.consume(document, current, clip, appearance=None)` returns a tuple `(http_status:int, body:dict)`. The caller is an **already authenticated internal reader**, never an anonymous/public service. `document` is the live `GET /new/api/evidence-quality` payload, `current` the **fresh validated native phone rows** from the existing authenticated inner relay (not a caller-supplied query), `clip` a canonical `motion_<13 digit milliseconds>.mp4`. `appearance` optionally holds the read-only V3 appearance result for that same clip; it is *never merged into a person identity or eligibility decision*.

The method independently revalidates the entire admitted gap report against the current private catalog and durable queue, by invoking `s9_evidence_quality_v1.source_current_gap_report`. It hashes snapshots of the three authoritative metadata sources (original catalog, durable queue, **latest Evidence Quality priority report**) immediately before and after revalidation, and checks again after deriving the clip-scoped revision. A race, missing file, tampered reader assertion, mismatched original SHA/byte length/media revision, changed detector/native pass/crop or queue revocation prevents consumption. This is an additional downstream guard, not a replacement for the reader's own checks.

## Response schema `s9_anonymous_quality_consumption_v361`

On **200**:
- `ok:true`; `schema_version` exact string `s9_anonymous_quality_consumption_v361`.
- `clip_no` canonical identifier, `source_sha256` and `source_revision` 64 lowercase hex, `source_bytes` integer bytes, `model_sha256` 64 lowercase hex, `analysis_version` string.
- `evidence_revision_sha256` 64 lowercase hex derived from **this recording's** current original catalog record, qualified quality-priority row, exact processing/completed rescan row, original/model provenance and three-frame sample payload. It is **not** derived from whole-catalog/queue/report hashes; changing an unrelated recording or routine global report timestamp does not falsely invalidate this recording. Full-file hashes are still checked before/after every read to detect races. Consumers caching a 200 must invalidate when this revision changes and must still fetch fresh authorization on each use; a cache alone never grants eligibility.
- `evidence_revision_scope` exact string `"clip_current_catalog_priority_queue_and_samples_v367"`. Added in V367; previous clients accepting V361 output may ignore this field, but new clients should require it when relying on stable per-clip caching.
- `source_binding_status:"revalidated_original_and_queue_at_consumption"`, `eligibility:"anonymous_quality_manual_review_only"`, `sample_count:3`, `sample_times_ms` three integer offsets from the beginning of the original recording (not Unix wall times), `sampled_face_candidate_count` 0–96 (unreviewed detector outputs), `observation` one of `no_supported_face_in_three_sampled_frames` or `unreviewed_detector_candidates_present`. No candidate or absence is a person identity/absence judgment.
- `appearance_v3` `"unavailable"` or `"provisional_not_admitted"`; `appearance_evidence_eligible:false`, `pose_gait_measured:false`, `verified_same_person:false`, `automatic_person_assignments:0`, `human_review_required:true`, `originals_modified:false`, `review_decisions_modified:false`.

On **400**: `{"ok":false,"schema_version":"s9_anonymous_quality_consumption_v361","error":"invalid_clip"}`.

On **410** (revoked/ineligible source): `{"ok":false,"schema_version":"s9_anonymous_quality_consumption_v361","error":"source_revision_or_evidence_revoked","automatic_person_assignments":0}`. This means no usable *derived* evidence, **not** no person present. The prior cached 200 must not be used.

On **503** (source/reader inaccessible, drift/race, unsupported V3 claims, malformed samples): `{"ok":false,"schema_version":"s9_anonymous_quality_consumption_v361","error":"source_admission_unavailable","automatic_person_assignments":0}` or the fixed `qualified_reader_unavailable` / `source_admission_unavailable` error. Neither error grants eligibility. Do not expose file paths, original bytes, model vectors or private identities.

Example synthetic response for consumer-side fixtures:
```json
{"ok":true,"schema_version":"s9_anonymous_quality_consumption_v361","clip_no":"motion_1800000000000.mp4","evidence_revision_sha256":"0000000000000000000000000000000000000000000000000000000000000000","evidence_revision_scope":"clip_current_catalog_priority_queue_and_samples_v367","source_sha256":"1111111111111111111111111111111111111111111111111111111111111111","source_bytes":1234567,"source_revision":"2222222222222222222222222222222222222222222222222222222222222222","model_sha256":"3333333333333333333333333333333333333333333333333333333333333333","analysis_version":"s9_original4k_independent_gap_benchmark_v1","source_binding_status":"revalidated_original_and_queue_at_consumption","eligibility":"anonymous_quality_manual_review_only","sample_count":3,"sample_times_ms":[1000,5000,11000],"sampled_face_candidate_count":0,"observation":"no_supported_face_in_three_sampled_frames","appearance_v3":"provisional_not_admitted","appearance_evidence_eligible":false,"pose_gait_measured":false,"verified_same_person":false,"automatic_person_assignments":0,"human_review_required":true,"originals_modified":false,"review_decisions_modified":false}
```
The SHA values above are **format examples, not actual source attestations**.

## V367 compatibility and failure semantics

The wire `schema_version` **remains** `s9_anonymous_quality_consumption_v361` to avoid surprising already staged Playback handlers; V367 adds `evidence_revision_scope` to successful 200 responses only and strengthens receipt provenance. This is a backend method, not a new public route. Responses 400, 410 and 503 and their error names remain unchanged. A switch between processing and completed evidence can legitimately change the clip receipt once, as can modification or revocation of the exact clip's priority, verified queue outcome, model or native pass. A changed `generated_at` on an unrelated report does **not** change this clip's reusable revision. Verification remains fail-closed if any authoritative private state disappears or changes during read.

## Producer/consumer tests and deployment gate

CI runs the fixture twice under independent hash seeds. Test real shape vs fabricated source SHA, changed revision, changed original bytes, changed native pass, new indexed face crop, revoked queue status, unsupported model, replayed cached response, source-race and V3 auto-identity flag. These are synthetic unit tests without MP4 reads, UI, Camera2, authentication changes or private media.

Physical production acceptance requires already-authorized access, root headroom >=850 MiB without lowering the guard, original Camera2 4K idle/zero dropped frames/thermal, legitimate reader #1107/#1117 bytes installed and Playback ownership coordination. Demonstrate at least one **new** actual 4K rescan -> qualified Evidence Quality GET -> V361 consumed 200, then safe stale-source/revision revocation to 410 without touching an original or user review. Record installed SHA/real job ID before claiming live. Historical blocked same-YuNet work remains unsupported. As of 21 Oct 2026 previous receipts #12344/#12345 proved an old reader and 5 current/16 unqualified historical derivatives; root <850 MiB, private SSH OAuth `tag:ci` permission unresolved.

## V365 current-priority reader-time revocation (PR #1135)

This is a **source-only addendum, not a deployed API claim**. The independently
generated Evidence Quality `state/s9-evidence-quality-v1/report.json` now
participates in each actual evidence reader admission and V361 downstream
revision. Even an exact SHA/bytes/revision/model-matched **completed** queue
row is no longer eligible if the latest quality report withdraws
`targeted_rescan_priority`, changes `extraction_status` away from the
queue's `priority_reason`, or loses
`native_face_pass_complete:true`. Missing, oversized, wrong-model,
invalid/duplicate current priority rows cause source admission to fail closed.

**Consumer-visible behavior remains the V361 schema:** 200 means currently
source-revalidated anonymous quality for human review, 410 means a previously
served clip has become ineligible/revoked (not negative person evidence), 503
means any attestation source/reader is unavailable or malformed, 400 invalid
clip. The `evidence_revision_sha256` now changes when the quality report
changes, even when original MP4 and queue revision do not. It is a fresh
readback token **not** an authorization to reuse cached evidence after a
subsequent change. Timestamps in the existing API remain UTC for generated
metadata and milliseconds **relative to the start of original video** for
sample offsets. This change adds **no** public route and does not authorize
the Playback owner to infer identity, pose/gait or auto-file a person.

**Required deployment ordering:** with camera, thermal, worker locks and
>=850 MiB root reserve verified, install source-qualified reader #1107/#1117
**plus V365** before any V356/V304 rescan consumer-acknowledgment upgrade.
Install the matching V361 consumer module only through an owner-approved
authenticated private route; request fresh GET and retain sanitized revision
receipts. The Playback owner alone registers shared UI/relay integration.
Existing historical unqualified gap rows stay historical and ineligible.
Synthetic CI does not prove a physical deployment.
