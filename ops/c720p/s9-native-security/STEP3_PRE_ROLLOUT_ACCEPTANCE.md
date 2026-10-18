# S9+ Step 3 pre-rollout acceptance record

**Status (18 Oct 2026): BLOCKED for automatic person identification/grouping.**
This file is an acceptance protocol, not proof of legal compliance or model accuracy.
The authoritative current result is `S9_STEP3_PRE_ROLLOUT_GATE` from
`validate-s9-step3-pre-rollout.py`. Run after each new camera version,
original-archive change, or identity model/threshold change.

## Conditions already demonstrated

- S9+ signed APK matches the current pinned package; C720P timer has a finite next run.
- Original 4K video remains healthy, with no dropped output frames or face-review errors in the latest live audits.
- V5 deep review has completed for 171 of 171 original 4K clips at the latest audit, with zero remaining then. New recordings must always be counted.
- 596 original S9+ face-image links are indexed. A full audit of the preceding 594 images verified all 594 JPEGs and all 170 corresponding video HEAD responses; the next clip's two images also passed a separate check.
- Human review UI and clip-local evidence can be used without asserting identity. No biometric vectors are exported by the catalog.

## Rollout blockers

1. **Actual face-comparison ground truth**: zero independently confirmed positive and zero negative face pairs. Only real human-reviewed examples tied to **two exact original face crops**, their SHA-256 values, and a phone-measured score may enter V2 calibration. Manually approved folders, self-similarity, synthetic CI cases, and appearance-based matches are *not* ground truth.
2. **Image quality**: a full image audit of the preceding 594 JPEGs measured 208 smaller than 112 pixels on a side and 410 smaller than 200. JPEG file size is not a corruption test. Treat small or weak crops as manual evidence, not reliable automatic identity input; independently test detector and matcher performance by image quality and scene lighting.
3. **Statistics**: at least 40 independently verified same-person and 500 different-person test pairs from at least 60 original clips on at least 3 days. The fixed version-pinned acceptance scores must yield a 95% Wilson **upper** confidence bound for false-acceptance rate <=1% and a 95% Wilson **lower** confidence bound for true-positive rate >=90%. Do not tune thresholds on the held-out test set. Correlated near-duplicate pairs must not be treated as independent evidence.
4. **Tracking and movement**: track IDs are clip-local; gait and posture do not identify anyone. Assess person-vs-object false positives with independently reviewed pedestrian, cyclist, animal and vehicle examples, including darkness and occlusion. Do not use an unvalidated person track to link a face or visitor across clips.
5. **Privacy**: independently verify the camera's field of view, masking of public pavement and neighbouring property, notices, secure local access, retention/deletion, and lawful basis for any biometric identification. Home CCTV and biometric identification have distinct privacy requirements. Keep third-party passersby out of any identity enrollment/benchmark.
6. **Field pilot and human authorization**: test the signed, version-pinned model on opt-in/otherwise lawfully verified subjects, first in shadow/observation-only mode. Record errors, evidence provenance, thermal impact, uninterrupted 4K, rollback success and reviewer sign-off before considering any automatic suggestion. Explicit approval must be separate from merely passing offline statistics.

## Release discipline

- Do not merge the unfinished V48 comparison backend/UI into production before its safe workflow and audit checks are approved. Its pinned staging tests are not a live deployment.
- Never enable permanent identity folders, automatic matches, or consequential surveillance actions just because V5 scanned a clip or an embedding model passed a self-test.
- Keep the signed S9+ capture system, 4K originals, C720P review decisions and private identities unchanged during preflight. Preserve offline backups and roll back failing revisions.
- Report a rollout as *blocked* whenever any acceptance evidence is missing; do not fill missing labels with guesses.
