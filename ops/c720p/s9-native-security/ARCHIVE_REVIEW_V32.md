# Human verification before person matching

**Later phase:** the owner subsequently said **“yes, done”**. The frozen set of
41 human-verified clips is now handled by [V33](VERIFIED_PEOPLE_V33.md).
The paused state and counts below describe the original verification rollout.

Deployed on 14 October 2026. The current phase is **awaiting_owner_done**.
The owner must review Archive recordings and then say **“yes, done”** in the
assistant chat before any matching experiment or person-folder rebuild starts.
Continuations alone do not release this gate.

## Owner controls

Each archive card has a selection checkbox and separate **Verify person** and
**Verify people** buttons. These mean one person or multiple people appear in
the recording, not merely in its thumbnail. Both microSD and historical Drive
recordings support review; microSD remains the default.

The selection bar supports all recordings in the current date filter, including
collapsed dates; verified recordings; clearing selection; bulk verification;
no people; unsure; clearing verification; copying filenames; and deletion.
Deletion requires an explicit confirmation listing sources and filenames and
uses the established per-file deletion protections. Successful deletions leave
the selection; failed or protected recordings remain selected. Nothing is
deleted as part of installation or tests against the live hub.

## Persistence and gate

`s9_archive_review_v32.py` stores decisions privately in
`state/s9-archive-recording-review-v32.json`, with an append-only audit and an
exclusive write lock. No old AI classification or thumbnail review is imported.
Only current archive entries with positive human labels appear on the People &
faces waiting page. That page shows the verified set and an Archive shortcut.
It performs no media analysis and creates no identities.

A decision is bound to source, filename, byte size and any available stored
digest/remote identity. Changed metadata requires re-verification. This is an
archive identity fingerprint, not a new physical hash scan of each original.
Batches validate every reference before atomic persistence; an invalid or stale
reference rejects that batch. The UI submits at most 25 references per batch
and reports partial completion if a later batch fails.

The outer proxy blocks previous person-folder writes with HTTP423 and returns
an empty paused report without calling the older matcher. The public API has
no operation for releasing the owner gate. After the owner's explicit signal,
implement and validate a matcher input filter that accepts only these current
positive human labels before enabling any matching workflow. Do not simply
switch on the old matcher: its broader dataset is not the approved test set.
Future Person #1, Person #2 folders and face/gait/posture comparisons are deferred.

## Live verification and rollback

- Hub deployment: `20261014T055038277845Z`; 374 microSD and 173 Drive recordings
  reviewable, zero human-positive decisions, no person folders, camera watching.
- Six negative write guards passed live; no successful production verification
  or deletion request was made. Assets served byte-for-byte as staged.
- Home Assistant's Security iframe now uses `archive-review-v32-20261014`.
  Its restart completed and HTTP health returned successfully.
- Rollback files: `/home/jespern/c720p-home-hub/backups/archive-review-v32/20261014T055038277845Z`.
  Dashboard rollback: `/config/.storage/lovelace.c720p_hub.before-security-entry-v32-20261014T055048Z`.
- This is a hub-only change. No phone package installation, camera settings,
  media enrichment, identity test or original-recording mutation was performed.
  A later read-only phone check found installed SHA256
  `881069d0c91616761a5e8cd4e321738e469cf1bd5e64432c1c7a6578db24e4c4`,
  watching at 36.7°C. Phone packages are being updated independently; do not
  deploy the older V31 APK from this branch over that current installation.
- The proxy was based on the exact live version, retaining newer face diagnostic
  fields and the receipt-verified complete-video playback route.

Validation: 13 isolated registry/gate tests on Linux; five relay routing/security
tests; four range/fallback proxy regressions; JavaScript syntax checks; browser
checks using synthetic thumbnails for persisted single review, bulk review in
25+3 batches, collapsed-date selection, corrections, source separation, cancelled
deletion, and the People & faces waiting page. Browser tests did not inspect or
analyze private recordings. Actual deletion was not exercised on production.
