# Verified crop review correction — 15 October 2026

The V36 workbench incorrectly admitted every processed model detection, bypassing
the owner's Archive Person / People verification. Background fixtures and plants
could therefore appear under People & faces. A single sampled detection is not
proof of a person or a measured trajectory. The old status adapter also rejected
the installed v9 detector and allowed too little space for the expanded status.

## Deployed behavior

- Both catalog services and the crop endpoint now require a current, file-bound,
  explicitly human-confirmed Archive `person` or `people` decision. Clearing or
  changing verification removes access through this workbench. Media stays in
  Archive. Registry failure fails closed.
- Verification is read from the shared registry against current source rows.
  The LAN relay cannot depend on a handler callback initialized in the separate
  archive service process.
- Crops start as **Needs crop review**, including crops from verified recordings.
  **Person visible** confirms a crop; **Not a person** hides it from the default
  view. Rejected crops remain recoverable through the Crop review filter.
- Per-crop and bulk confirmation/rejection are explicit human actions. Folder
  assignment requires current crop confirmation. Geometry changes invalidate
  that confirmation. Existing labels, notes, folders and pins are preserved.
- Raw count diagnostics are removed from cards, repeated colour names are
  collapsed, and colour/movement details are expandable. Single-frame crops
  explicitly report that movement cannot be measured. The selection bar stays
  visible below the outer navigation header while scrolling.
- The status adapter accepts the verified installed
  `person_spatiotemporal_transport_v9` detector. Status reads remain bounded at
  64 KiB, with unknown detector and stale-frame checks retained.

These changes correct admission, presentation and manual curation. They do not
establish detector accuracy or implement automatic identity matching. Neither
the phone APK nor the recording pipeline was changed.

## Evidence

The final checkpoint contains **28 candidate crops from 9 verified original-4K
S9+ recordings**, out of 91 indexed 4K recordings. The unrestricted catalog had
182 crops before correction. The S9+ remained watching at 30.02 fps, 34.7°C, with
zero visual-review errors. No actual crop was manually confirmed by the agent;
production review revision stayed zero and no production folders were created.

Twenty-eight isolated catalog/review tests and eight status-adapter tests passed.
Browser checks used synthetic pixels only and exercised bulk rejection,
recovering rejected crops, confirmation, manual folder creation and assignment,
and the scrolling toolbar. Camera footage was not exported for UI testing.

Read-only live acceptance verified catalog parity on 8794/8795, current positive
Archive labels for all 28 crops, anonymous 401, invalid-filter 400, unverified
crop 404, private native crop hash integrity on the hub, unchanged production
review state, refreshed HA assets and healthy camera status.

Persistent final receipt:
`state/s9-visual-attributes-v36/verified-crops-v36c-release.json`.
Guarded deployment helper: `fix-verified-crops-v36c.py`.
Acceptance helper: `verify-verified-crops-v36c.py` (counts are checkpoint-specific).
HA cache key: `verified-crops-v36c-20261015`; nested JS key: `36c`.

## Rollback

The complete pre-correction source backup is:
`backups/s9-visual-attributes-v36/verified-crops-20261015T202538Z/restore.json`.
It includes a consistent private SQLite backup. Restore source entries only with
current-hash checks and restart the two catalog services. The added `presence`
column is backward compatible; preserve newer human decisions rather than
restoring an old database over them.

A second source backup at `verified-crops-20261015T202746Z` precedes the final
shared-registry correction; that intermediate version hid all crops and should
not be used as the normal rollback target.

HA entry backup:
`/config/.storage/lovelace.c720p_hub.before-security-entry-v36-20261015T202559Z`.
The refreshed HA configuration was verified healthy after restart. Existing
direct ADB, SSH, and outbound maintenance-agent access were preserved.
