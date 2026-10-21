# Human-in-the-loop folder suggestion ranking (v1)

Scope: additive candidate **appearance** ranking only. Not an automatic
person-identification system. No training, saving, moving or deleting original
recordings. All proposed matches and provisional groups are pending human
review.

## Components

- `folder_suggestion_engine.py` consumes explicit, source-qualified
  `PersonFeatureExtractor`-compatible feature dictionaries, human-reviewed
  media-bound decision rows, and named folders. It returns JSON-safe cards
  with `upper_crop_score`, `visual_score`, `color_score`,
  `centroid_score`, `exemplar_score`, `negative_penalty`,
  `suggestion_confidence` and `state: pending_review`.
- `folder_suggestion_api.py` is an **opt-in** route adapter. It will not
  install without three trusted callbacks: verified feature snapshot,
  authenticated original-open attestor, and authoritative reviewed-action
  writer. It does not emit any raw embeddings to the browser.
- `folder-suggestion-cards-v1.js` renders pending matching cards and
  `Awaiting Review` complete-linkage clusters. The connection helper
  `FolderSuggestionCards.connect(host, opts)` calls the authenticated
  `/new/api/folder-suggestions` and POST
  `/new/api/folder-suggestions/review`. Its Approve and Reject buttons
  remain locked until the exact original has been opened and verified.
- `security-people-v45.html` and `security-people-v45.js` contain a
  **source-only, opt-in** button within the folder Suggestions tab. They
  reference the separately deployed renderer and a real playback
  `window.S9SignedOriginalReview.openAndAttest` hook. If this hook is
  absent or the backend is unavailable, existing manual review continues
  unchanged, with no approvals possible from ranked cards.

## Feature schema and source binding

Provide each clip to `rank_folders(clips, folders, decisions)` with:

```python
{
  "source": "sd",                # or drive: NEVER key by basename only
  "clip_id": "motion_1790000000000.mp4",
  "media_sha256": "<64 lowercase hex characters>",
  "media_revision": "<attested original revision>",
  "visual_embedding": [0.0] * 512,
  "visual_model_id": "<immutable model hash or ID>",
  "structural_crop_embedding": [0.0] * 512,  # optional
  "structural_model_id": "<immutable model hash or ID>",
  "structural_aligned_verified": False,        # never infer this from crop size
  "color_histogram": [0.0] * 32               # optional verified HSV32
}
```

The structural + visual descriptors from `PersonFeatureExtractor.extract`
are immediately compatible after supplementing *verified original SHA/revision,
source and color provenance*. A plain `PersonFeatureExtractor` upper-quarter
crop is **not** proof of aligned-face/structural eligibility; PR #808's
structural 70% path requires independently verified alignment and matching
model versions. Otherwise the 75% visual + 25% measured **pairwise** HSV color
fallback is used. Missing/malformed fallback color is not silently replaced.

Only independently saved, explicitly human-approved decisions with matching
`media_sha256`, `media_revision`, and `source` enter folder centroids.
Never reinterpret old unlabeled/missing-revision approvals as newly verified.
The latest decision for a folder and source-qualified clip wins. Revocation
and media changes remove eligibility. Rejected same-folder examples penalize
new lookalikes by 0.25 when pairwise similarity exceeds 0.55; exact rejected
clips are excluded from that folder's list without globally rejecting them.

Centroid and closest-approved-exemplar similarities use 0.40/0.60 weights.
The display confidence is `100 * sigmoid(10 * (score - 0.42))`; it is an
uncalibrated **display index**, not a percent probability of identity.
Below-threshold unmatched clips are grouped using **complete-linkage**
agglomerative similarity >=0.45, so no cluster is merged via a weak bridge.
The 400-unmatched-record ceiling is deliberate to protect the small C720P.

### Historical review suppression (mandatory provider contract)

The verified provider must include
`historic_review_index_verified: true` together with the complete
`historic_reviewed_keys` array of source-qualified clip IDs (for example,
`sd:motion_1790000000000.mp4`) from the existing approved/rejected/manual
review registries. That list is **exclusion-only**: it prevents re-review
prompts, does not supply positive references or rejected-lookalike exemplars,
and does not rewrite any historical human decision. The API must fail closed
if the historical index has not been completely verified or if it changes
during a review transaction. The response exposes
`historic_review_index_verified` so the UI and activation gate can refuse
unprotected review cards.

## Secure activation contract

The server must provide:

1. A verified feature snapshot of the same original recordings the
   authenticated review player serves (not stale sidecar guesses).
2. An authenticated original playback workflow that returns a session-bound,
   server-verifiable `opened_ticket` for the exact source, SHA and revision.
3. An authoritative persistence callback for Approve and a **folder-specific**
   Reject (NOT the existing global Skip/Reject action), reporting
   `persisted: true`, `media_verified: true` and the exact source, clip,
   folder and reviewed status.

The API revalidates all of this and serializes review transactions. A
positive server receipt is journalled atomically with optimistic revision
checking; the journal never edits underlying video, snapshots or model
assets. The host must recover any partially completed external-review write
before treating that candidate as an approved training reference.

Install by passing those three trusted callbacks plus a private
`ReviewJournal` to `folder_suggestion_api.install(H, provider, journal,
opened_attestor, authoritative_commit)` inside the **authenticated** Security
Hub relay. This must not be mounted on an unauthenticated server.

## Cold-start first-reference workflow

The existing manual-link index contains no original-byte digests independently
bound at the time of those historic reviews. Existing decisions remain visible
in the established UI, but **cannot** silently become verified model references
or reappear as newly unreviewed originals.

Each `Awaiting Review` group now carries its members' source-qualified clip
IDs, exact original SHA and revision. A user can select a **named folder**,
inspect a specific original through authenticated playback, then explicitly
Approve or Reject. The first approved recording seeds the folder's verified
reference pool; subsequent suggestions use 40% centroid and 60% exemplar.
Rejection excludes only that folder, not the recording or other folders.
A user can create a new folder in the existing editor before reviewing it.

The server enforces actual original-open attestation, revision consistency,
the current feature snapshot and authoritative persistence. The client cannot
turn a fake or stale playback ticket into a reference. The activation audit
permits the legitimate **zero-reference cold start**, but requires real media
digest binding, feature provider, signed player integration, authenticated
review endpoint and reconciled live UI. Passing isolated unit tests does not
establish that these production hooks exist.

## Current deployment gate (21 October 2026)

Read-only live inspection on the C720P found **48** native manual-link
entries, **zero** with a `media_binding`. Existing history therefore must not
be copied to the journal as authenticated training references. The active
security page is the newer `security-people-v50.html` loading
`security-people-v320.js`; do **not** overwrite it with the older V45
source. The new module and source UI integration are ready for deployment
once the separately operated original-byte attestor, playback open ticket,
feature snapshot and v320 UI reconciliation have been physically verified.
Nothing in this branch changes Camera2, the S9+ recorder, clips, existing
folder decisions, or the production replay relay automatically.

Run synthetic acceptance:

```sh
cd ops/c720p/s9-native-security
python3 test-folder-suggestion-engine.py
python3 test-folder-suggestion-api.py
node --check folder-suggestion-cards-v1.js
node --check security-people-v45.js
node test-folder-suggestion-cards.js
```

The workflow `.github/workflows/s9-folder-suggestion-engine.yml` runs
these checks on changes to the ranking and source UI.
