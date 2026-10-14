> Superseded by [V35](ENSEMBLE_PEOPLE_V35.md). Its audit found unsupported interval-based conflicts and invalid use of presence labels as identity examples. Preserve the V35 policy and evidence gallery; do not restore V34 grouping.

# Best-fit person profiles

V34 replaces the overly fragmented V33 grouping for the owner's existing frozen
set of 41 verified recordings. The owner requested a best-fit algorithm on
14 October 2026. No additional media, labels or face templates were collected.

The live result is **33 candidate person folders, down from 64**, covering all
108 extracted sightings. Fourteen folders contain multiple recordings, up from
two. Thirteen folders still contain a single sighting. Fifty-two appearances
are explicitly marked **Tentative person match**. These are proposed identity
assignments requiring review; the number of distinct real people is unverified.
The original clearer-view recording remains available. Existing 42 face crops,
93 posture measurements and unavailable gait measurements are preserved.

## How fitting works

`s9_best_fit_people_v34.py` first joins compatible, non-overlapping views inside
recordings the owner marked as one person. It compares multiple body/face
descriptors and clothing views, uses relative errors for measured body ratios,
and includes cadence only when both appearances actually have it. Positive-ratio
cosine similarity is not treated as convincing body-proportion agreement.
Missing gait no longer prevents a cross-visit appearance fit.

The existing approved set supplies 85 within-recording positive comparison
examples and 53 simultaneous-view separation examples. These calibrate observed
appearance variation, the review threshold and the cost of opening another
folder. They do not provide cross-recording identity ground truth. On this set,
the learned new-profile cost is 0.4932 and the review threshold is 0.5909; these
are composite similarities/costs, not identity probabilities.

The dataset-wide objective minimizes each recording unit's distance to a real
central view, plus the learned cost of creating another profile. Greedy merges
and local reassignment approximate that objective; no global-optimum claim or
target person count is made. A central view must directly fit every unit in its
profile, preventing an arbitrary chain of increasingly unrelated views.
Simultaneously visible people and contradictory independent face evidence are
hard constraints throughout merging and reassignment. A single comparable face
can contribute when body/clothing corroborate it; multiple clear face samples
can link changed outfits.

Weaker or closely competing assignments stay inside their proposed best-fitting
folder with a tentative label. The page exposes the grouping explanation and
retains confirm, combine, separate and rename controls. Confirmation clears
tentative labels; separation is preserved on later regrouping. Existing named
and confirmed folders are protected. Raw descriptors remain on the hub.

## Provenance and verification

The V33 approval and current-positive-label intersection remain mandatory.
Deleted, revoked, changed or newly verified clips outside that frozen snapshot
cannot enter this batch. Private `grouping-policy.json` enables V34; the public
API cannot change it. A private preview binds the algorithm, feature bytes and
approved set to SHA256 receipts before activation. API suggestions explicitly
whitelist summary fields so cached comparison evidence is never exported.

All 88 isolated tests passed: 20 best-fit math/grouping tests, 28 provenance and
owner-review integration tests, plus the existing 40 archive/relay/motion/face/
playback regressions. Tests cover simultaneous people, face contradictions,
ambiguous assignments, changed outfits, central-view constraints, malformed
vectors, deterministic fitting, preserved names/splits, tentative confirmation,
revocation and exact registry rollback receipts. JavaScript syntax and synthetic
browser checks passed for the new folder labels, tentative appearance labels
and explanations.

Live checks confirmed 41 approved/processed clips, all 108 sightings, zero
within-folder co-occurrence conflicts, authenticated private JPEGs, original
HEAD/byte-range playback, anonymous-request rejection and a watching camera at
36.1°C. All six deployed source assets matched staging. No original recording,
human clip label, real person's name, phone package or access route was changed.
Cross-recording identity accuracy cannot be measured from presence labels.

## Deployment and rollback

- Guarded installer: `deploy-best-fit-people-v34.py`; stage manifest must match
  exact before/after hashes for six fixed source paths.
- Successful source backup:
  `backups/best-fit-people-v34/20261014T125605198718Z`.
- Private registry rollback:
  `registry-before-final-grouping-20261014T125610985609Z.json` in the V33 state
  directory; its exact after-write hash is in `best-fit-release-v34.json`.
- Security cache entry: `best-fit-people-v34-20261014`.
- HA backup:
  `/config/.storage/lovelace.c720p_hub.before-security-entry-v34-20261014T125713Z`.

The first activation rolled back cleanly when validation reached the restarting
archive service too early. The final installer waits for readiness before live
validation. Home Assistant was healthy after its cache refresh. Rollback guards
avoid overwriting intervening operator edits. No inference timer was added.
