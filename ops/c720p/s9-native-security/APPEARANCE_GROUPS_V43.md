# Provisional clothing-appearance folders — 17 October 2026

UI cache: `appearance-folders-v43-20261017`. Feature switch:
`state/s9-visual-attributes-v36/appearance-groups-v43-enabled.json`.

Three automatic provisional folders were created from the six currently
unassigned Archive-verified recordings: initial sizes 3, 2 and 1. Existing
Jesper folder records and its three approved clips were preserved. No clip was
automatically approved or assigned a person's name.

## Grouping and human review

`s9_appearance_groups_v43.py` groups solely by the normalized upper/lower HSV
colour histograms already extracted on the S9+. The hub does metadata work,
not image decoding or biometric analysis. Distance is one minus the
Bhattacharyya coefficient; each region must be at most 0.30 and their mean
at most 0.20. Complete-link admission checks every retained group reference,
preventing a chain of intermediate colours from joining incompatible ends.

Only current Archive Person / People verifications are eligible. Previously
approved recordings and global inbox skips are excluded from new proposals.
Each clip has at most one automatic proposal. Work is bounded to 256 unseen
recordings per refresh; later refreshes continue with remaining unseen clips.

Generated folders are named Appearance #N and visibly contain clips awaiting
approval. The owner may use Name this group to give a folder a human label.
Green Approve uses the existing source/signature/revision guarded human review
action; red Reject excludes that recording from the group and remains
reversible. Rejected references are not used to admit future clips. An owner's
approved view supersedes its original automatic reference for colour comparison.

There are no face/gait/body embeddings, identity probabilities, inferred names
or biometric identity matching. Clothing similarity does not establish that
recordings depict the same person.

## Persistence and interface

New tables `appearance_groups_v43` and `appearance_candidates_v43` record
provenance and provisional membership. Existing `folders` stores the display
names; existing manual ledgers store approvals and rejections. No schema is
rebuilt and no existing manual record is rewritten by proposal generation.
The shared revision advances when new proposals are generated; human audit
entries are created only by actual human review actions.

When enabled, folder report refreshes discover newly eligible recordings and
persist proposals. Folder IDs are derived from source clip/hash and remain
stable across refreshes. Pending previews are clearly distinguished from
approved references. `automatic_appearance_groups` reports generated groups;
`automatic_approvals` stays false. The legacy `auto_assignments=false` flag
continues to mean that approved folder membership requires human action.

## Deployment and verification

Nine new grouping tests and nineteen existing folder tests passed, together
with JavaScript syntax checks. Tests cover distinct/similar colours, prevention
of colour chaining, persistence, explicit approval, rejection/undo, human
rename, verification scope and preservation of existing human approvals.

An isolated metadata/SQLite preview on C720P produced the same three cohorts
before production activation. Eight live check groups passed after activation,
including both API ports, stable folder IDs, all pending clips remaining
unapproved, unchanged original catalog and human decisions, exact served UI
and healthy unchanged recorder policy. No production review button was pressed
by the agent.

Receipt: `state/s9-visual-attributes-v36/appearance-groups-v43-release.json`.
Backup: `backups/s9-appearance-groups-v43/20261017T004551Z/`.
The guarded installer is `deploy-appearance-groups-v43.py`.

The root Security entry had acquired a separately deployed
`s9-night-visibility-v1.js` link. Its exact source was inspected; only cache
markers were changed, preserving that addition and the script itself. The
installer contains the explicit inspected entry hash and refuses other changes.
The phone APK and detector policy were not changed by this upgrade.

The Home Assistant Security iframe still referenced the V40a cache URL, while
static HTML responses had a 31-day cache lifetime. `refresh-security-entry-v43.py`
updated only that iframe URL to V43 and verified HA after restarting it. Other
dashboard views were preserved. Its private configuration backup is
`/config/.storage/lovelace.c720p_hub.before-security-entry-v43-20261017T014654Z`.
The final result was `SECURITY_ENTRY_V43_REFRESHED_HOME_ASSISTANT_HEALTHY`.

## Recovery

Restore software from `restore.json` and restart the archive/relay user
services if Python sources are restored. Do not overwrite the live SQLite
database with the pre-deployment snapshot after the owner starts reviewing.
Keep the additive proposal tables and any new folder records: they may now
contain human approvals, rejections or names. Disabling/removing the feature
switch stops proposal generation; older code can still read manual approvals.
No original recording or crop files were moved or deleted.
