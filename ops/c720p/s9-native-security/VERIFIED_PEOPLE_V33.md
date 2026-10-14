# Verified recordings → person folders

**Current grouping:** [BEST_FIT_PEOPLE_V34.md](BEST_FIT_PEOPLE_V34.md) supersedes
the V33 matching rules and 64-group result below. Extraction receipts, approved
inputs and stored evidence from this release remain in use.

The owner released the review gate with **“yes, done”** on 14 October 2026.
The approved snapshot contains **41 human-verified historical Drive clips**.
No microSD clip was positively verified in that snapshot. Newly verified clips
outside the snapshot are not silently added to this test.

The main pass processed all 41 original recordings without errors. Each
download was checked against its indexed byte size and Drive MD5 and received
a private SHA256 receipt. The camera continued watching normally. Original
videos, source sidecars and the installed phone package were not modified by
this work.

## What the page contains

People & faces has anonymous **Person #1**, **Person #2**, etc. folders containing
actual linked appearances and source recordings, person crops, available face
crops, and measured movement information. Each appearance plays its original
recording at the corresponding time. Face crops have their own capture times.
The page supports search, rename, group confirmation, combining folders, and
separating an appearance. Missing face or gait evidence remains unavailable.

Automatic groups are suggestions, not established identities. Verifying that a
clip contains a person supplies presence/count labels, not cross-clip identity
ground truth. Identity accuracy cannot be measured from those labels alone.
Named or confirmed folders are protected when the dataset is regrouped.

## Evidence and matching

| Evidence | Extraction and use |
| --- | --- |
| Individual appearances | Existing YOLOv5n person model, spatial/appearance tracking, bounded samples across the entire recording; weak tracks need additional pose or face support. |
| Face evidence | Checksum-pinned YuNet scans the head region throughout an appearance, including brief views outside the largest body samples. A final bounded pass reads original-resolution frames, confirms person detections and associates them with saved trajectories; ambiguous associations are skipped. Actual crops retain their source times. |
| Face comparison | Existing paired MobileFaceNet, aligned 112px RGB inputs; tensor contract, finite normalized outputs and paired self-consistency checked. Only sufficiently clear and frontal samples produce comparison descriptors. |
| Body appearance | Checksum-pinned YoutuReID, normalized 768D descriptors from multiple usable views; upper/lower clothing histograms provide separate supporting information. |
| Posture and proportions | Existing pinned MoveNet Lightning model; projected torso lean, body proportions and visible-joint checks. These are camera-view estimates, not physical measurements. |
| Walking and arm movement | Bounded eight-frame-per-second pose review, two-axis ankle cycles, relative wrist motion, normalized travel speed and torso variation. Full-frame duplicate rejection, coverage, displacement and visibility checks protect against invented cadence. |
| Human single-person clips | Non-overlapping fragments within a recording marked Person may be linked. Simultaneous appearances and strong contradictory face evidence remain separate. The page identifies this support explicitly. |

Cross-recording face matches require multiple comparable samples. Clothing/body
matches remain provisional and require strong appearance and colour support;
cross-day use additionally needs measured proportions and cadence agreement.
Posture, speed and arm movement can support comparisons but do not independently
establish identity. No emotion, health, demographic or threat inference is made.

Grouping requires independent support between recording groups and rejects
co-occurrence conflicts. Human single-person fragments can share a clear face
anchor without treating an obscured fragment as contradictory evidence. Weak
transitive chains across unrelated recordings do not create identities.

Model contracts and public assets:
[OpenCV face detection](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet),
[OpenCV YoutuReID](https://github.com/opencv/opencv_zoo/tree/main/models/person_reid_youtureid),
[MoveNet](https://www.tensorflow.org/hub/tutorials/movenet).
Public model downloads send no private media. Inference, crops and descriptors
stay on the hub; no security footage was exported to this workspace.

## Provenance and persistence

Private state is under
`/home/jespern/c720p-home-hub/state/s9-verified-people-v33/`:

- `approval.json`: frozen source/revision references and the owner signal.
- `features.json`: source receipts, observations and private descriptors.
- `registry.json`: stable folder references, review state and comparison support.
- `images/`: generated person/face crops; no originals are stored here.
- `status.json`, `motion-evaluation.json`, `native-face-evaluation.json`: progress and final measurement coverage.
- Review audit and private pre-regrouping backups preserve operator changes.

Every read revalidates positive human labels, the approved revision, and the
source/name tuple. Deletions, source changes and revoked verification remove
clips and crops from the page. File-signature caches invalidate immediately on
label or source-index changes; twelve live private previews averaged 71.3ms in
the bounded cache check. Images are bound to their own observation/kind and
SHA256. Unindexed images return404; anonymous LAN access returns401.

Only public summaries and image identifiers cross the authenticated relay.
Raw face/body descriptors, trajectories and pose sequences are excluded from
the API. The old unfiltered person-folder mutation route stays locked. The
approval snapshot has no public release/replace operation.

Stored folders and crops survive a hub restart and do not require a model
runtime to display. The offline model runtime is an isolated temporary
environment restored from the verified existing library archive. No new
recurring timer or camera-side inference loop was added.

## Execution and validation

`verified-people-worker-v33.py` performs the main pass and incrementally publishes
observations. `refine-verified-motion-v33.py` performs the final pose-only review,
reusing face/body results and range playback where possible. Earlier recordings
without saved trajectories use a bounded reacquisition window and reject
ambiguous multi-person associations. Remote size/hash checks or a repeat
original SHA256 check protect those reads. `refine-native-faces-v33.py` repeats
the original SHA256 check before decoding native-size frames and saving genuine
face crops. Separate capture times and conflicting-template checks prevent
duplicate frames from inflating face support. `finish-verified-people-v33.py`
finishes these stages for this one approved batch, retries failures, and runs the
read-only live verifier. It does not approve or schedule new datasets.

The workers were limited to one CPU core, low scheduling priority and bounded
memory. The main and final motion passes both completed 41/41 recordings with
zero errors. They produced 108 individual appearance tracks, including 93 with
usable projected posture. No track supported reliable walking cadence or arm
swing. One positively verified recording had no usable individual track; it
remains playable in the page's clearer-view list. These are evidence-coverage
counts, not identity-accuracy measurements.

The original-resolution face pass also completed 41/41 recordings with zero
errors at **10:37:28 UTC on 14 October 2026**. The final page contains **64
provisional appearance groups**, not 64 established people. Twenty-eight folders
contain multiple appearances; two span multiple recordings through appearance
support. Forty-two face crops are available, including 29 from original-size
frames. Nine appearance tracks have comparison-quality face evidence (12 stored
descriptor samples). No folder is marked face-supported. The current set does
not establish reliable cross-recording identity accuracy.

Walking exclusions comprise 96 stationary/short appearances, eight without a
clear continuous walking sequence, three ambiguous multi-person associations,
and one without sufficient continuous person boxes. The final read-only live
check confirmed all 41 approved references, authenticated JPEG previews,
original HEAD and byte-range playback, anonymous-request rejection (401), and a
watching camera at 36.3°C. All fifteen deployed source files matched the final
workspace checksums. No real folder was named or confirmed by the tests.

Validation: 22 isolated provenance/grouping/review tests, nine synthetic dense
motion tests, four duplicate/ambiguous-window tests, four original-resolution
face-association/template tests, six relay tests, thirteen archive verification
tests and four native range/fallback regressions (62 total),
plus JavaScript syntax and synthetic browser checks. Browser checks cover folder
navigation, search, naming, confirmation, splitting/combining, face capture
positions and playback-dialog routing. Live checks cover source eligibility,
private JPEGs, original HEAD/byte-range playback, rejected writes and camera
health. Tests did not assign real people, change owner labels or delete clips.

## Deployment and rollback

- Initial V33 source backup: `backups/verified-people-v33/20261014T075830236806Z`.
- Preview cache backup: `backups/verified-people-v33/cache-20261014T081005Z`.
- Final source backup: `backups/verified-people-v33/20261014T094529064450Z`.
- Current HA Security entry: `verified-people-v33d-20261014`.
- Dashboard backup: `/config/.storage/lovelace.c720p_hub.before-security-entry-v33d-20261014T094706Z`.
- Main completed unit: `c720p-verified-people-v33c.service`.
- Final one-shot unit: `c720p-verified-people-final-v33.service`.
- Original-resolution face unit: `c720p-verified-native-faces-v33.service`.
- All three analysis stages completed successfully; no recurring inference job was added.
- Completion-wrapper backup: `backups/verified-people-v33/finish-before-native-v33.py`.

The guarded installer rejects unexpected live file hashes, saves private
rollback copies, validates served assets and rolls back failed source changes.
Archive thumbnail mounting and verified combined-video playback improvements
present in production were preserved. SSH, the maintenance agent, camera
controls and the existing camera package remain independent of these changes.
