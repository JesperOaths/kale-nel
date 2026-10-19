# S9+ auxiliary-video preservation policy (2026-10-19)

This is a **report-only policy**, not authorization to delete, relocate, repair or quarantine footage. Original 4K recordings, historical Drive videos, their digests and human person decisions remain protected.

## Why the old inventory was ambiguous

The old "preroll_without_verified_primary" counter does not mean the raw primary MP4 is physically absent. It also counts present raw originals whose manifests are missing or unverified. A recoverable original must not be mistaken for a deleted original.

The new isolated-worker inventory splits prerolls, completed companions and partial companions into three states: paired to a verified original; paired to a raw-but-unverified original; and no raw original physically present. These are filename-presence observations, **not media-decoding or integrity verdicts**. Legacy aggregate counters remain for backwards compatibility.

Old or future filesystem modification times alone never justify disposal, even for partial MP4s or orphaned prerolls.

## Protected without exception

1. Every original 4K MP4, including any originally SHA-256 verified clip.
2. Every raw-but-unverified MP4 and its preroll, completed copy, partial companion and thumbnail.
3. Every file referenced by a manual person assignment, reviewed/approved clip, playback, export or pending review.
4. Every standalone preroll even when no raw primary exists: it may contain recoverable evidence.
5. All historical Drive originals and human review decisions.

No automatic quarantine, deduplication, moving, cleanup or deletion is enabled by this change.

## Gates before any future quarantine proposal

1. Capture must be stable and healthy both before and after the inventory, with a trusted clock and stable source generation.
2. Physically reconcile original media and manifests; independently confirm exact original byte size and SHA-256, without using detector output as integrity proof.
3. Decode/inspect each candidate independently to classify whether it is playable, partial, still being written or recoverable. Filename and mtime are never sufficient.
4. Reconcile people, approvals, pending manual reviews, export references, retention protections and historical archive references. Missing or ambiguous metadata protects the file.
5. Generate an immutable per-file manifest of proposed actions, sizes, hashes, linked originals, reasons and rollback paths, with no side effects.
6. Quarantine only through a **separate approved** implementation, into adequately sized reversible storage with at least 30 days rollback, independent audit logs and a fail-closed restore path. Never alter or delete during live recording.
7. If any gate fails, leave everything in place and report the reason. Original integrity and camera capture always take priority over space savings.

## Deployment status

These code changes are additive, source-only, and do not modify the live Camera2 APK. After CI, stage the isolated worker, run the on-device pairing inventory, compare all verified original recordings with the prior catalog, and check continuous 4K camera health before/after. Until physical S9 testing, the newly split live counts are **unknown** and must not be claimed as measured.
