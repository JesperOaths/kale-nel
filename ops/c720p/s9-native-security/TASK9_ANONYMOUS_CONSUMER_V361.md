# V361 — source-revalidated anonymous evidence consumer (Playback API handoff)

**Status: source-only; no C720P installation, HTTP route, verified runtime or user interface claim.** Owner: Task #9 backend. Playback alone may register the authenticated relay/handler and render it; no new public endpoint is authorized. The other Task #9 owner recently landed PR #1124's obsolete-revision archive and PR #1126's provisional V3 flags. This module does **not** modify either shared implementation.

## Proposed private method

`s9_anonymous_evidence_consumer_v361.consume(document, current, clip, appearance=None)` returns a tuple `(http_status:int, body:dict)`. The caller is an **already authenticated internal reader**, never an anonymous/public service. `document` is the live `GET /new/api/evidence-quality` payload, `current` the **fresh validated native phone rows** from the existing authenticated inner relay (not a caller-supplied query), `clip` a canonical `motion_<13 digit milliseconds>.mp4`. `appearance` optionally holds the read-only V3 appearance result for that same clip; it is *never merged into a person identity or eligibility decision*.

The method independently revalidates the entire admitted gap report against the current private catalog and durable queue, by invoking `s9_evidence_quality_v1.source_current_gap_report`. It hashes snapshots of both authoritative metadata sources immediately before and after revalidation. A race, missing file, tampered reader assertion, mismatched original SHA/byte length/media revision, changed detector/native pass/crop or queue revocation prevents consumption. This is an additional downstream guard, not a replacement for the reader's own checks.

## Response schema `s9_anonymous_quality_consumption_v361`

On **200**:
- `ok:true`; `schema_version` exact string `s9_anonymous_quality_consumption_v361`.
- `clip_no` canonical identifier, `source_sha256` and `source_revision` 64 lowercase hex, `source_bytes` integer bytes, `model_sha256` 64 lowercase hex, `analysis_version` string.
- `evidence_revision_sha256` 64 lowercase hex derived from **both current catalog+queue file hashes**, exact original/model provenance and sample payload. Consumers caching a 200 must invalidate it when this revision changes; a cache alone never authorizes current eligibility.
- `source_binding_status:"revalidated_original_and_queue_at_consumption"`, `eligibility:"anonymous_quality_manual_review_only"`, `sample_count:3`, `sample_times_ms` three integer offsets from the beginning of the original recording (not Unix wall times), `sampled_face_candidate_count` 0–96 (unreviewed detector outputs), `observation` one of `no_supported_face_in_three_sampled_frames` or `unreviewed_detector_candidates_present`. No candidate or absence is a person identity/absence judgment.
- `appearance_v3` `"unavailable"` or `"provisional_not_admitted"`; `appearance_evidence_eligible:false`, `pose_gait_measured:false`, `verified_same_person:false`, `automatic_person_assignments:0`, `human_review_required:true`, `originals_modified:false`, `review_decisions_modified:false`.

On **400**: `{"ok":false,"schema_version":"s9_anonymous_quality_consumption_v361","error":"invalid_clip"}`.

On **410** (revoked/ineligible source): `{"ok":false,"schema_version":"s9_anonymous_quality_consumption_v361","error":"source_revision_or_evidence_revoked","automatic_person_assignments":0}`. This means no usable *derived* evidence, **not** no person present. The prior cached 200 must not be used.

On **503** (source/reader inaccessible, drift/race, unsupported V3 claims, malformed samples): `{"ok":false,"schema_version":"s9_anonymous_quality_consumption_v361","error":"source_admission_unavailable","automatic_person_assignments":0}` or the fixed `qualified_reader_unavailable` / `source_admission_unavailable` error. Neither error grants eligibility. Do not expose file paths, original bytes, model vectors or private identities.

Example synthetic response for consumer-side fixtures:
```json
{"ok":true,"schema_version":"s9_anonymous_quality_consumption_v361","clip_no":"motion_1800000000000.mp4","evidence_revision_sha256":"0000000000000000000000000000000000000000000000000000000000000000","source_sha256":"1111111111111111111111111111111111111111111111111111111111111111","source_bytes":1234567,"source_revision":"2222222222222222222222222222222222222222222222222222222222222222","model_sha256":"3333333333333333333333333333333333333333333333333333333333333333","analysis_version":"s9_original4k_independent_gap_benchmark_v1","source_binding_status":"revalidated_original_and_queue_at_consumption","eligibility":"anonymous_quality_manual_review_only","sample_count":3,"sample_times_ms":[1000,5000,11000],"sampled_face_candidate_count":0,"observation":"no_supported_face_in_three_sampled_frames","appearance_v3":"provisional_not_admitted","appearance_evidence_eligible":false,"pose_gait_measured":false,"verified_same_person":false,"automatic_person_assignments":0,"human_review_required":true,"originals_modified":false,"review_decisions_modified":false}
```
The SHA values above are **format examples, not actual source attestations**.

## Producer/consumer tests and deployment gate

CI runs the fixture twice under independent hash seeds. Test real shape vs fabricated source SHA, changed revision, changed original bytes, changed native pass, new indexed face crop, revoked queue status, unsupported model, replayed cached response, source-race and V3 auto-identity flag. These are synthetic unit tests without MP4 reads, UI, Camera2, authentication changes or private media.

Physical production acceptance requires already-authorized access, root headroom >=850 MiB without lowering the guard, original Camera2 4K idle/zero dropped frames/thermal, legitimate reader #1107/#1117 bytes installed and Playback ownership coordination. Demonstrate at least one **new** actual 4K rescan -> qualified Evidence Quality GET -> V361 consumed 200, then safe stale-source/revision revocation to 410 without touching an original or user review. Record installed SHA/real job ID before claiming live. Historical blocked same-YuNet work remains unsupported. As of 21 Oct 2026 previous receipts #12344/#12345 proved an old reader and 5 current/16 unqualified historical derivatives; root <850 MiB, private SSH OAuth `tag:ci` permission unresolved.
