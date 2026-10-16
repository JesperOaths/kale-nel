# S9+ night detection V41 — 16 October 2026

Installed directly on SM-G965F through C720P and ADB `192.168.178.250:5555`.
APK SHA-256: `cb46726931e46cd40088188d05828f0ac1e8f15cc68f3ab6077c12e5b14ce1bf`.
Signer, model, native libraries, manifest and capture assets are unchanged.

## Trigger changes

The V38 live policy could admit an unmoving person-like object when two
observations overlapped recently changed luminance cells. Those cells remained
eligible for five seconds. Headlights illuminating a parked object could therefore
corroborate a false person box. Strong model-box translation also admitted a
two-frame hypothesis without coarse-grid motion.

V41 preserves that daytime behavior but adds a separate night gate:

- Measured preview luma below 55 selects night. It takes 15 continuous seconds
  at luma 75 or higher to restore daytime policy, preventing headlight flashes
  from switching to the more permissive gate.
- At least three associated, independent JPEG observations, at least 350 ms
  apart and spanning at least 1.1 seconds; expired, duplicate and stale images
  cannot corroborate a detection. Minimum night person score is 0.46.
- Movement must translate the box coherently, with net displacement at least
  60% of its path length. Stationary boxes and oscillating jitter cannot use
  local luminance changes alone to start recording.
- Two observations need local motion no older than 1.2 seconds. A consistently
  strong person prediction (minimum 0.72) can instead use clear translation
  across three observations, retaining recovery from coarse-grid misses.
- A first night candidate opens a bounded faster follow-up window. This uses
  the existing 900 ms worker cadence and temperature guard, helping short walks
  obtain three observations while the original five-second video ring runs.
- Stronger, spatially coincident car-window and whole-cycle classifications
  can veto false person boxes. Adjacent people and independently localized
  riders above a vehicle remain eligible. The same conflict checks are applied
  to newly processed original 4K review frames using their actual dimensions.

No identity features, biometric matching, cross-recording tracking or automatic
folder assignment were introduced. Existing crop/catalog records and human
decisions were not regenerated. Generic luma motion still only requests person
inference; it does not start new production recordings on its own.

## Verification

Seven JVM suites and eight suites on the physical S9+ passed, including 115 new
night assertions, the 37 existing pedestrian-policy assertions, small-person
retention, multicandidate tracking, native-review scheduling and queue behavior.
Ten hub status/adapter tests passed. A fresh pinned-source reconstruction matched
all 28 release source hashes; 22 sources including both encoder/ring classes
are unchanged from V39.

Live acceptance checks original video hashes, all pre-existing manual review
rows, unchanged Security UI/folder backend assets, exact installed APK, both
catalog/status routes, camera controls and approximately three minutes of dark
scene inference/capture health. Results are stored in
`state/s9-visual-attributes-v36/night-v41-verification.json`.
All eight live acceptance groups passed: capture held at 30.02 fps and
32.8°C with zero dropped frames or inference errors. Ten original recordings
and the existing folder/three review decisions retained their hashes/state.

These are regression and operation checks, not a labeled night-walk benchmark.
Real-world precision/recall and the effect on very brief or very low-confidence
pedestrians have not been measured. Do not claim a false-positive reduction
percentage from rejected-observation counters or a quiet live interval.

## Reproduction and recovery

Use `stage-night-phone-v41.py <new-empty-directory>` from the repository, then
`build-night-phone-v41.py <directory>` on C720P. This reconstructs the pinned
V11 recorder and overlays V37–V41 helpers. Do not compile the historical
working-tree `CameraService.java` / `ClipClassifier.java` directly. The older
V39 preparation entry now refuses current sources.

The installer checks the exact V39 APK, saves and verifies a rollback, waits
for idle capture and restores the preceding APK if health fails. This release's
rollback is `backups/s9-night-detection-v41/before-20261016T203425Z.apk`, SHA-256
`c8bddd3812964ce161cf5027d766303752bf0f45ba1aaf2c457ff2a3d9f75228`.
The operator also holds verified copies of both APKs under
`work/night-phone-v41-stage/` outside the repository.

Compact receipts are durable at `build/s9-night-detection-v41/`; build APKs
and staging are in `/tmp` to protect root storage. The adapter's preceding
source, logical review backup and baseline hashes are beneath
`backups/s9-night-detection-v41/`. Never restore the review database over
subsequent human decisions when rolling back software.
`exact-release-source.zip` in the durable build directory preserves the exact
28 source files and tests independently of Git checkout line-ending settings.

Five obsolete build-output APKs were retained and SHA-verified in the operator
workspace and RAM scratch before removing their redundant hub build copies.
Their exact locations are in `build/retained-operator-builds-v41.json`. The
V11 build baseline, installed release, all hub rollback APKs, media and manual
state were preserved. Do not assume the relocated old build-output paths
still contain APKs; restore the exact verified operator copy if needed.

The V40 release manifest is historical: its status-adapter hash has been
superseded by V41. All other entries remain unchanged. The current adapter
SHA-256 is `1e1e5d286a86c55a305b5e5982c12f91c0522fd25bb2f79a9aa4776ad54cad59`.
