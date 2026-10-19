# S9+ isolated offline multi-vector worker status — 2026-10-19

## Confirmed on the actual phone

Read-only C720P management diagnostics #11562 and #11563 inspected **Samsung
SM-G965F, Android 10 / SDK 29, arm64-v8a**, reachable over ADB.
The phone has roughly 83 GiB free on microSD and ~2.3 GiB MemAvailable.
Camera process `nl.kalenel.s9security` was running (PID 1833 during audit).
**No Termux, Python, Torch, torchvision, torchreid, or ONNX Runtime executable
was present in the shell environment.** Android `app_process` and
`dalvikvm` are available, but neither supplies model execution libraries.

The user requested **all inference on S9+, not C720P**, without any Camera2
APK/service changes. Therefore do **not** `pip install` Linux PyTorch wheels
on Android; OSNet must first be exported to ONNX on a build host and run by a
SEPARATE, isolated Android-compatible ONNX Runtime companion process.
Android ORT uses arm64 native shared libraries and Java/C/C++ entrypoints.
No untrusted native package, camera APK replacement or runtime reconfiguration
is authorized by the mere presence of model files.

## Implemented and protected in this stage

- `PhoneOfflineSimilarity.java`: phone-compatible, package-independent
  512-D cosine scorer; requested 0.70 structural + 0.30 visual formula **only**
  when both vectors are finite, nonzero, from matching model revisions AND
  structural vectors are marked as produced from properly aligned faces.
  Otherwise use 0.75 visual + 0.25 valid pairwise HSV histogram comparison
  supplied at comparison time, not stored in either per-crop record.
  No reliable fallback -> no ranking. Scores are similarity indicators,
  **never percentages of probability of a person's identity**.
- `stage-s9-offline-models.py`: pinned, bounded, stream-only transfer of
  the requested 174,383,860-byte ONNX ArcFace artifact from Hugging Face
  through C720P ADB transport into **separate** phone microSD directory
  `/storage/9C33-6BBD/S9OfflineModels`. Verifies upstream LFS SHA-256
  `4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43`
  on sender AND S9 before marking installed. No local C720P copy and
  no modification to `Security4K` recordings, camera APK or live service.
  Installing a model file is **not** proof it runs on device.
- Dedicated Java and Python static CI tests, with separate model staging
  gate and no automatic phone deployment.

## Critical model compatibility and privacy

**ArcFace `w600k_r50` is a 512-D face-recognition model.**
Its real input is an *aligned face* at NCHW 1x3x112x112, normalized
`(RGB-127.5)/127.5`. The top quarter of a general person bounding box
is **not** a valid aligned face. Sending such crops produces 512 floats,
but not validated structural appearance similarity. Do not mark those
vectors usable with `structuralAligned=true`.

The `PersonFeatureExtractor` from PR #793 defaults to ImageNet normalization.
For the specific ArcFace model the caller would need
`InputSpec(112,112,mean=(.5,.5,.5),std=(.5,.5,.5))` **and** a separately
detected/aligned *face*, not a body subcrop. We do not enable a face-based
cross-clip identity system across the existing general-surveillance archive.
A responsible future evaluation requires a documented lawful basis,
appropriate scope/exclusions, independent matching ground truth, and real
false-match tests before any automatic person-folder recommendations.

OSNet pretrained ImageNet weights normally download through upstream
`torchreid`'s Python/GDrive mechanism; a separate host-side export to a
versioned ONNX artifact is required. Its SHA and ONNX numerical equivalence
must be verified before the phone runtime can consume it.

## Not complete — cannot falsely declare live 512-D inference/backfill

1. Android-compatible ORT companion process or standalone `app_process`
   packaging, with independently tested JNI classpath, permissions, storage
   isolation and thermal/CPU budgeting.
2. 512-D pretrained OSNet exported ONNX file with pinned digest and real
   test-vector equivalence.
3. Actual 512-D shape + normalization test **on S9** for both models.
4. Reversible, append-only, source-qualified clip/crop indexing across SD and
   historical Drive (the Drive archive is not stored on S9 microSD).
5. An evidence provenance / applicability gate for inspection-only crops,
   and lawful inclusion scope. Preserve original review and crop records.
6. Integration into Appearance Search and provisional folders after validating
   no public visual identity claims and meaningful similarity calibration.

Do not claim either phase deployed or full archive backfilled solely because
the standalone similarity Java test passes. Never touch the live recorder or
restart/install its APK to bootstrap this worker.

## Actual S9+ synthetic execution result

C720P diagnostic job **11573** compiled these Java sources with `javac`,
converted them to Android DEX using `d8`, temporarily copied the tiny DEX
package to `/data/local/tmp` on the S9+, and executed
`nl.kalenel.s9offline.PhoneOfflineSimilarityTest` via
`app_process`. Result: **exit 0**, `S9_PHONE_MULTIVECTOR_SCORE_TEST_PASS`.
The temporary test package was removed. This establishes genuine on-phone
execution of the cosine-score module **only**, not model inference or 4K
backfill. The test did not read any person/face recordings and did not modify
the camera service.

The Hugging Face ArcFace HTTPS source returned HTTP 200 with the expected
174,383,860-byte size (C720P probe #11565), and model-staging dry-run
**11570** passed. **Actual ONNX weight download/install on phone was not
confirmed**; do not claim either backbone provisioned or any embeddings
populated. The ORT runtime and OSNet export are still absent.
