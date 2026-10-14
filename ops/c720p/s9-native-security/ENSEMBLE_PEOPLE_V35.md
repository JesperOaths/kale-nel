# Verified person grouping V35

This supersedes the V34 grouping algorithm. The owner rejected the fragmented sightings and requested a better best-fit grouping. The source remains the frozen **41 owner-verified recordings**, released by the explicit **“yes, done”** instruction. A presence label is eligibility to process a clip, not an identity label or a guarantee that every person in it is the same individual.

## Deployed result, 14 October 2026

V35 was activated and verified on the live hub at approximately 17:10 Amsterdam time. It covers all 108 existing sightings. **89 sightings occupy 26 candidate person folders; 19 unresolved sightings appear separately.** Sixteen person folders span multiple recordings. Twenty-one assignments retain tentative markers, compared with 52 in V34. The private registry has 45 collections in total, including the 19 unmatched singles; do not compare the 26 visible person folders directly with V34's 33 mixed collections or interpret either count as a proven number of people.

The completed passes added **170 native body views**, providing a multi-view second-model gallery for 103 tracks. The result contains 43 face crops, 15 comparable face templates across 10 tracks, and 93 posture measurements. Dense head review performed 935 scans on stored observation frames. Calibration used 67 independent native-view comparisons from 35 recordings and 41 shared-frame separation examples. No reliable gait cadence was available in this verified set.

All 41 original-view and dense-head work items completed with zero errors, including explicit skips where no safe observed head association existed. **120 isolated regressions passed**, alongside Python/JavaScript syntax, numerical model-parity checks, the unpublished private trial and synthetic browser checks. The browser verified that three sightings across two recordings produce two recording cards, with match details and per-sighting controls.

Live verification checked seven exact application source hashes, all 108 unique sightings, absence of co-frame conflicts inside groups, private descriptor filtering, authenticated images, original HEAD/range playback and anonymous HTTP 401 rejection. The camera was watching at 35.3°C. HA loaded `ensemble-people-v35-20261014`; subsequent API responses took 3.671, 2.726 and 1.341 seconds. The final receipt and source manifest persist privately beyond tmpfs cleanup.

Source/data rollback: `~/c720p-home-hub/backups/ensemble-people-v35/20261014T150542146479Z/restore.json`. Registry rollback: `state/s9-verified-people-v33/registry-before-final-grouping-20261014T150553686593Z.json`, subject to its exact post-activation digest guard. HA dashboard backup: `/config/.storage/lovelace.c720p_hub.before-security-entry-v35-20261014T150649Z`.

## Corrections

- V34 used overlapping track lifetimes as proof of simultaneous visibility. The audit found 12 of its 53 conflicts lacked a shared observed detection frame. V35 uses actual trajectory timestamps, or genuine detection endpoints for older tracks. Real shared-frame constraints still prevent automatic or manual combination.
- Presence labels no longer supply positive identity examples or automatically join all sequential people in a clip. Track-break links require short, spatially plausible motion and corroborating appearance.
- The body gallery now includes a second model and multiple original-resolution views. Matching uses both body models, available face evidence, clothing and projected proportions, with measured cadence only when it exists. Clothing has less influence than the body models.
- Camera-specific calibration uses temporally separated original views of actual tracks and observed co-frame negatives. It never fits a target number of people. These are internal consistency probes, not identity-labeled accuracy tests.
- Independent face support requires different temporal probes on both sides of a comparison. A single lucky face pairing cannot supply two votes. Contradictory independent face samples remain a veto.
- A real central view must support a person profile; long chains of weak similarities cannot drift into one identity. Competing or weak assignments retain tentative markers.

## Original evidence review

`refine-body-ensemble-v35.py` checks the SHA-bound existing body crop for each approved sighting, adds an OSNet-AIN descriptor, and runs an independent YOLOX person check. A horizontal reflection is an augmentation of one view, never a separate observation. A missed secondary detection does not delete a human-verified recording or invent a person.

`refine-independent-faces-v35.py` adds bounded original-resolution probes at intervals that can actually satisfy the independent-template requirement. `refine-original-views-v35.py` then reviews further original body/face views with association checks. It fetches one original at a time into hub tmpfs, checks its entire SHA-256 against the original receipt, preserves existing descriptors and associates new detections before attaching them to an old sighting.

`refine-dense-headfaces-v35.py` checks head regions on actual stored detection frames, using the same fps-filter phase as the original tracker. It does not interpolate identities between detections. Ambiguous overlapping person boxes are skipped. Older tracks without stored boxes are not assigned guessed head regions. This pass can find a brief clear face missed by sparse sampling.

All staged features, crops and model descriptors remain on the hub. No private image, recording or descriptor is uploaded to the operator workspace or committed. The browser preview uses synthetic mannequins only.

## Person folders

Matched appearances share a person folder. A lone unresolved appearance stays in **Unmatched sightings**, rather than being presented as an additional identified person. Named, confirmed and manually separated folders are protected. Friendly Person # labels survive confirmation and manual corrections.

Inside a folder, each recording appears once. Its individual body views and face captures open playback at their respective times. Per-sighting evidence and separation controls sit in the recording's match details. Repeated unavailable-gait messages and the duplicate aggregate analysis strip have been removed.

Automatic folders remain candidate visual groupings. Neither a lower folder count nor the number of passed tests establishes identity accuracy. Sparse or unclear gait/face footage cannot supply a reliable measurement.

## Public model provenance

The second body model is the authors' **OSNet-AIN x1.0 MSMT17** checkpoint from the [official project](https://github.com/KaiyangZhou/deep-person-reid), whose README links the [author's model repository](https://huggingface.co/kaiyangzhou/osnet). Source revision, weight revision, licenses, hashes and export checks are in `public-reid-models-v35.json`. The independent detector follows the [OpenCV Zoo YOLOX implementation](https://github.com/opencv/opencv_zoo/tree/main/models/object_detection_yolox).

The checkpoint loads strictly with no random unmatched layers. Public weights are exported in isolated operator build space with PyTorch 2.6 CPU, opset 12. Synthetic outputs are checked against PyTorch and ONNX Runtime, then checked again on the hub's OpenCV backend using normalized vectors. Instance-normalization rounding on constant input is checked in the same normalized representation used for matching. Torch is not installed on the hub. The release needs the stored descriptors, not the temporary export runtime.

Reproduction: run `fetch-public-reid-v35.py --work-dir <build-directory>`, then `export-public-reid-v35.py --work-dir <same-directory>` with the isolated public-model dependencies in `<build-directory>/osnet-export-runtime`. The fetcher verifies the pinned input digests. Review a changed export manifest explicitly if rebuilding in a different environment; do not bypass deployment hashes.

## Guarded activation and rollback

`preview-ensemble-people-v35.py` writes an unpublished trial bound to the exact algorithm, baseline features, ready features and current approval digests. All sightings must occur exactly once, and no automatic group may violate a co-frame or independent-face conflict.

`deploy-ensemble-people-v35.py` requires completed error-free original-view and dense-head passes, obtains the worker lock, checks seven exact before/after source hashes, and validates every private candidate image's per-track binding and digest. It backs up source, feature data and policy; reconciliation separately records a private registry rollback. The archive must become ready and pass authenticated playback/image checks. Concurrent owner reviews are preserved instead of blindly overwritten during rollback.

The private state directory is `~/c720p-home-hub/state/s9-verified-people-v33/`. Relevant receipts are `ensemble-evaluation-v35.json`, `independent-face-evaluation-v35.json`, `original-views-evaluation-v35.json`, `dense-head-evaluation-v35.json`, `best-fit-preview-v35.json`, `best-fit-release-v35.json`, `release-manifest-v35.json` and `final-verification-v35.json`. Staged data is separate from `features.json` until activation.

Only the HA Security iframe cache key changes to `ensemble-people-v35-20261014`. Its dashboard backup is separate. Preserve newer phone firmware/APKs, live camera controls, SSH, the outbound maintenance agent and the existing direct phone access routes. This release never installs a phone package or reopens the legacy unfiltered matcher.

Use the exact private release receipt and `restore.json` to review a rollback. Restore a registry only if no later owner edit has occurred. Do not rerun the older V34 installer or replace newer independent camera work from this branch.
