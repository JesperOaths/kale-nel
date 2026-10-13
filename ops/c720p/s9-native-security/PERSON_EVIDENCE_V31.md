# S9+ person evidence and folders V31

## Behavior

Face capture searches bounded head regions from the existing person detector at native detail, plus a whole-frame fallback. Detector-confirmed crops with limited recognition quality remain evidence without receiving an identity score. Face-to-track links require an unambiguous spatial owner. Existing face enrollment version, weights and gallery survive the update; a model/index epoch prevents aliases being reused across unrelated galleries.

The serialized phone review worker enriches person-positive original 4K recordings while the camera is watching, the garden has been quiet for 60 seconds, battery temperature is below 33.5°C and SD space exceeds 20 GiB. It stops between decoded frames if capture resumes, movement returns or thermal guards fail. One recording is attempted per 90-second pass, with a 45-second budget and at most 64 pose inferences. It does not run on Camera2 callbacks. Periodic live detector checks do not cancel a review merely because their independent inference worker is briefly busy.

MoveNet Lightning supplies 17 projected joints. Summaries describe visible posture, projected torso lean/knee bend, shoulder/hip proportions, apparent movement in body heights per second, and (only when measurable) cadence and ankle/arm swing. Sparse classification keyframes cannot establish gait. The dense pass requires an isolated track, unique decoded frame fingerprints, full-body visibility, at least 22 observations over 2.5 seconds at >=8 fps, bounded gaps and reliable alternating motion. Camera perspective and occlusion limit these measurements. These are supporting observations, not an independent identity model or world-space height/speed estimates.

The archive index accepts only bounded summaries; raw landmarks and face embeddings stay off the hub API. Original MP4s are unchanged. Enrichment keeps a pre-V31 sidecar and preserves earlier useful face evidence when a new pass finds none.

Person folders contain reversible references to verified native clip tracks. Users create/name a folder and explicitly link appearances. Comparable on-phone face aliases with the same gallery epoch form provisional candidate folders automatically. Measured posture, motion, clothing and cadence can suggest links to reviewed profiles. Suggestions never train the profile or silently confirm a person. Overlapping people cannot join the same confirmed profile, and changed source track signatures require another review. Historical Drive visitor review remains independent. Legacy recordings without separate tracks remain visible.

## Interfaces

- Authenticated GET `/new/api/person-folders` returns profiles, candidates, suggestions and unassigned appearances.
- Authenticated POST `/new/api/person-folders/review` requires `X-S9-Person-Folder-Intent: explicit-review-v31`, a permitted Home Assistant origin and exact JSON keys `action, observation_key, profile_id, name, human_confirmed`. Actions: create/link/unlink/reject/rename. No media is moved or deleted.
- Private state: `state/s9-person-folders-v31.json` and an append-only audit. Writes are atomic and audit failures restore the preceding registry.

## Models and build

`prepare-s9-pose-model-v31.py` downloads only the pinned public [MoveNet Lightning model](https://www.tensorflow.org/hub/tutorials/movenet). Expected SHA-256: `cd7cc22fa946e5d146a7b98d496853e1923e22828d3972d579973f27f91bb105`; 2,894,840 bytes, uint8 `[1,192,192,3]` input and float32 `[1,1,17,3]` output. It is used for projected pose measurements, not as a person-identification model.

On the hub, stage this source directory in `/tmp`, plus a `source-sha256.json` mapping each Java relative path to its transferred byte hash. Run `package-s9-person-evidence-v31.py --commit <full-commit> --sources <staged-directory>`. It compiles in tmpfs, runs the live-gate and pose regressions, preserves the original object/face assets byte-for-byte and signs with the existing app certificate. Artifacts are retained per source commit; `build/s9-person-evidence-v31/release.json` identifies the newest package.

`guarded-upgrade-person-evidence-v31.py --commit <full-commit>` is the separate phone cutover. It requires healthy, idle authorized S9+ ADB access; backs up the actual installed APK; verifies signing identity and original model hashes; installs in place; checks 4K, GPU detector, periodic scans and V31 status; and restores the original APK on failed post-install checks. It never uninstalls the app or resets settings. Do not substitute another phone or install before these guards pass.

## Validation and deployment state

Hub UI/private APIs deployed and verified on 13 October 2026 at 22:46 UTC: 338 indexed recordings retained, 82 native person-track appearances, 0 confirmed person profiles and 0 usable saved face crops. Backup: `/home/jespern/c720p-home-hub/backups/person-folders-v31/20261013T224607284538Z`. A later independent complete-recording playback route was preserved. Visual checks used a read-only local preview of retrieved archive metadata, including the assignment dialog and newest-first order; no invented person was added to production.

Offline checks: 19 person-folder tests, 3 pose-summary tests, 8 existing face-review tests, executable face geometry, 25 live-gate regression checks, pose motion/occlusion/duplicate-frame regressions and actual pose-model inference on the hub. Browser/controller checks cover legacy media, candidate deduplication, explicit folder assignment and actual observation-time playback.

**Phone deployment remains pending:** the saved S9+ ADB address refuses connections, no authorized S9+ USB transport is present, and the existing bridge recovery service reports `S9_USB_NOT_CONNECTED_OR_UNAUTHORIZED`. The S3 and S5 are reachable and were deliberately excluded. The signed APK is staged; posture/cadence extraction performance, real face-crop yield and live 4K performance have not been verified on the phone. Restore the S9+ authorized USB/ADB connection, then run the guarded cutover and inspect real enriched sidecars before claiming this algorithm is live.
