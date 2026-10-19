# S9+ Automatic Person — strict face alignment handoff (2026-10-19)

## Verified live baseline (do not extrapolate)

- C720P diagnostic job **#11989**: 221 S9+ archive originals, 94 Drive originals,
  745 saved face candidates; 545 are non-padded, but **all 745 are tagged
  inspection/manual-review-only**. Exactly **zero** validated five-point
  alignments, zero human face-to-person confirmations, zero trusted identity
  reference pairs. Manual filing covers 20 S9+ recordings / 9 saved-person
  groups. Group clip filing is not face-level identity confirmation.
- V3 appearance index job **#11975** published 58 source-qualified real OSNet
  plus HSV32 descriptors; UI/API jobs **#11981** and **#11984** verified live,
  and E2E job **#11987** returned 5 and 4 provisional comparisons.
  **These are full-person appearance rankings, not face-recognition vectors.**
- Capture audit **#11991** observed 35.2°C, ~8995 ms native 4K buffer,
  zero reported dropped output frames. Seven-second rollout state file exists,
  but the *saved* preroll and 10-second tail proof file had not appeared.
  8995ms in-memory ring history is not proof of saved timing.

## What PR #949 adds

1. **Strict native five-point geometry:** never fabricate the eye locations,
   nose or mouth landmarks from Android's eye midpoint or a generic person box.
   The image must have five actual detector outputs, original at least 22px
   eye span, high confidence, plausible facial symmetry, unmirrored geometry
   and a bounded, verified similarity alignment to 112x112.
2. **OpenCV Zoo YuNet MIT model** for *detecting* five landmarks. Official
   2023mar LFS artifact 232589 bytes, SHA256
   `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4`.
   Staging is confined to isolated phone microSD model directory. This
   operation does not infer on human images or change the camera APK.
3. **Twelve-output YuNet decoder**, real BGR/no-normalization ONNX model
   specification and strict bounded per-snapshot geometry with only
   synthetic test data. An independent S9 Android ONNX Runtime synthetic
   shape smoke checks its actual tensor contract after staging.

## Strict next physical milestones

1. Validate PR #949's Python and Java synthetic CI. Source-only status is
   not equal to running the model on the phone.
2. Confirm the phone model hash and cool native 4K camera at the time of
   staging. A deferred stage means no model was installed.
3. With separate, explicitly bounded offline on-phone execution, run one
   **synthetic black-image** YuNet ORT smoke and verify all 12 heads/shape,
   without touching saved media. Do not execute inside Camera2 or C720P.
4. Only after that, test **one** private snapshot on the S9+ itself: hash
   the original JPEG, measure authentic five landmarks in **native source
   pixels**, reject mirrored/multiple/blurred/clipped or tiny faces, create
   a separate SHA-verified aligned crop sidecar. No camera APK restart,
   no overwriting original snapshots, no bulk scan.
5. Show trustworthy aligned faces for explicit per-face person confirmation
   (clip-level group approvals must not auto-label faces). Require two
   distinct verified snapshots from different clips per named person, plus
   cross-person conflict screening. Denial and manual approval stay final.
6. Only then evaluate the separate ArcFace 512-D model against confirmed
   references and false-match controls. The Automatic Person tab must remain
   human-review-only; never infer identity from clothing similarity or
   automatically reassign old recordings.

## Non-negotiable protection

Original MP4s, historical Google Drive archive, manual review/denial registries,
V1/V2/V3 appearance references and the live Camera2 APK must remain unchanged.
No bulk inference if camera is hot, 4K fallback, recording, frame dropping, or
storage reserve is low. Any unknown model, ADB transport error, broken
provenance, duplicate face SHA, or ambiguous person mapping fails closed.
