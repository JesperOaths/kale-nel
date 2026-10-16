# People & faces: persistent manual clip folders

Deployed 16 October 2026. UI cache: `manual-folders-v40a-20261016`.

The old People page is replaced by a recording-level approval workbench.
There is one card per recording, with alternative detection views when needed.
Green **Approve** saves an explicit manual folder assignment. Red **Reject**
in a folder rejects that recording from that folder, without changing its
Archive Person / People verification. Inbox rejections are separately saved.
Both types of rejection can be undone. A later approval clears an inbox rejection.

The first approval can create a human-named folder (default Person #1, etc.).
There is no automatic same-person grouping, biometric matching, identity
probability, or identity learning. Folder suggestions compare only upper/lower
clothing HSV histograms against approved examples, with optional entry/exit
zone filters. More approved examples expand the available colour references;
rejected recording/source pairs are not suggested again in that folder.
Every addition still requires a new human approval.

## Persistence and boundaries

`folder_clips_v40` stores folder, original recording name, original SHA-256,
decision, exact reviewed-view snapshot and timestamp. It is independent of
temporary track numbers. Reanalysis can change boxes/track IDs without losing
an approved recording or silently substituting a different crop. Original
source changes or revoked Archive verification hide the unavailable media;
the saved decision is retained. Verified source hashes can keep approved views
available during a catalog rebuild.

`inbox_skips_v40` stores reversible inbox decisions. Additive migration imports
only current, explicitly human-confirmed legacy assignments. Labels and notes
are preserved. Revisions prevent concurrent edits from overwriting each other;
source hashes and exact view signatures also guard against approving a stale
page after a detection changes. All actions are audited.

The existing signed relay, trusted Origin and manual-intent checks remain.
Crop reads retain source verification and checksum checks, including pinned
historical review images. Actual footage/descriptors remain on S9+/hub.
No recorder, model, APK, camera settings or recording timing changed.

## Backup and recovery

The complete previous Security UI assets, catalog snapshot, consistent review
SQLite database and receipts were backed up before deployment:

`/home/jespern/c720p-home-hub/backups/s9-folder-review-v40/20261016T192043Z/`

`restore.json` contains original paths, backup paths and hashes. Deployment,
final UI, feedback and archive-initializer changes have separate rollback
manifests underneath that directory. The independently replaced legacy Tracks
page was captured and preserved; this release did not overwrite it.

Restore source/UI files from the relevant manifest, then restart the existing
archive/relay services and refresh the HA Security iframe cache. **Keep the
current review database if anyone has reviewed clips since the backup.** Old
code safely ignores the additive V40 tables; overwriting the database would
discard later human decisions. No original recordings are removed by rollback.

The archive entry point can be regenerated without the old explicit visual
review installer. `repair-folder-route-v40.py` mounts the review routes in the
existing playback initializer, preserving local/LAN authentication behavior.
Registration is idempotent and refuses an authentication-mode downgrade.
The original initializer is backed up in `archive-route-20261016T194335Z/`.

## Packaging and verification

`stage-folder-review-v40.py` creates a fresh hashed package. For the guarded
V39b-to-V40a migration, back up first, deploy the package, apply the archive
initializer repair if needed, update the HA entry with
`refresh-security-entry-v40.py`, then run `verify-folder-review-v40.py`.
The extra `finish-*` and `refresh-security-entry-v40a.py` scripts record the
intermediate production rollout; fresh packages already contain final assets.
All migration scripts refuse unrecognized live sources rather than overwrite
newer changes. Subsequent releases should use their own inspected guard.

36 existing catalog tests and 15 folder-workflow tests passed, plus four
playback lifecycle checks. Browser testing used an isolated synthetic database:
first approval/seed, folder approval, rejection, undo, comparison, selected-view
preservation on refresh, reload persistence, prominent green/red controls and
430-pixel responsive layout were exercised. No real recordings were approved
by the agent.

Live acceptance: both catalog endpoints, recording deduplication, explicit
approval guards, invalid filters, backup hashes, replacement assets, original
recording hashes, native crop checksums/dimensions/timestamps, playback byte
ranges, camera controls, installed APK hash and live capture health are checked
by `verify-folder-review-v40.py`. Results are in
`state/s9-visual-attributes-v36/folder-review-v40-verification.json`;
source/rollback receipts are in `folder-review-v40-release.json`.

Final acceptance: all **20 live checks passed**. The nine currently verified
recordings appear as nine recording cards rather than 78 detection-view cards.
Production manual folders/actions were still zero. Capture remained 30.02 fps,
33.3 °C, with zero dropped output frames and zero review errors. The installed
phone APK remained `c8bddd3812964ce161cf5027d766303752bf0f45ba1aaf2c457ff2a3d9f75228`.
