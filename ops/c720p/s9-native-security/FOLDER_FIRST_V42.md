# People & faces folder-first review — 17 October 2026

Current UI cache: `folder-first-v42b-20261017`.
Page: `people-folders-v42.html/js`; People aliases and Archive review entry
open this version. The earlier workbench and complete source/SQLite backups
remain available for rollback.

## Behavior

- The opening view is a grid of human-created folders with approved cover
  images, approved counts and counts of clothing-colour suggestions.
- Opening a folder puts approved reference clips beside the pending review
  cards. Every card has a green Approve and red Reject control above its view.
  Approved clips stay in the folder; rejected clips leave its pending list.
- Rejections can be undone. Separate Approved and Rejected views remain
  available, along with original 4K playback and timestamped crop seeking.
- Add clips opens all eligible unassigned clips **within the chosen folder**.
  Its rejection excludes the clip from that folder, leaving it available for
  another folder. The choice survives refresh. This is a manual browse mode;
  it does not require colour similarity or create automatic assignments.
- The unassigned Archive shortcut opens unassigned review directly. Renaming,
  notes and new folder creation retain the existing explicit manual workflow.
- No scene/geometry metrics, histogram scores or analysis tables occupy the
  main review cards. Colour range and optional weak/route filters remain
  available for reviewing clothing-colour suggestions.

Suggestions remain deterministic comparisons of upper/lower clothing HSV
histograms against approved examples. No face/gait/body embeddings, inferred
same-person groups, biometric training, automatic folder creation or automatic
approval were added. Folder names and membership are human decisions. The
production catalog remains restricted to Archive-verified Person / People
recordings, not all motion recordings.

## Checks and current state

Nineteen folder workflow tests passed, including four new checks for manual
assignment without colour restriction, folder-scoped rejection/undo, approval
persistence and rejecting a folderless assignment request. JavaScript syntax
checks passed. Earlier synthetic browser checks verified the folder overview,
side-by-side references, approval, rejection and undo. Synthetic media stayed
isolated from production. A later attempt to reconnect to that preview tab
was blocked by the browser URL policy; it was not bypassed.

Both deployment phases passed seven live groups: unchanged manual decisions
and catalog, protected code/Tracks, exact source hashes, both API ports,
Home Assistant aliases, and healthy capture. Final checks include the new
folder-scoped `tab=assign` on both 8794/8795. No actual production clip was
approved/rejected by the agent. One existing folder, its three decisions and
all nine Archive-verified clips were retained.

The camera was independently changed after the V41 checkpoint. At this UI
deployment it reported `person_spatiotemporal_transport_v9`, GPU, 30.02 fps,
zero dropped output frames; the observed installed APK SHA was
`0f5a65985a817f8e998afc3c63355bdc3b3613893d2bf3fb7a243655f6a1c8bd`.
This UI task preserved that installed app and the existing camera adapter.
Do not infer which APK is newer from its policy string or overwrite it with
the old V41 installer. Reconcile concurrent camera work before updating it.

## Deployment and rollback

Initial backup:
`backups/s9-folder-first-v42/20261016T233940Z/`.
Final scoped-assignment backup:
`backups/s9-folder-first-v42/scoped-assign-20261016T234300Z/`.
Dates in these filenames are UTC; the local deployment date was 17 October.

Final receipt:
`state/s9-visual-attributes-v36/folder-first-v42b-release.json`.
It includes expected asset hashes, protected backend hashes, hashed manual
rows, both backup paths and live checks. The initial V42 receipt is historical
after the final V42b asset/backend update. Earlier V40/V41 source manifests
likewise remain historical.

`deploy-folder-first-v42.py` installs the first static-only phase from exact
V40a sources. `finish-folder-first-v42b.py` requires that first receipt, saves
another rollback and adds the read-only folder-scoped assignment view. They
are guarded single-use migrations; do not rerun blindly against newer assets.

To roll back software, restore the files listed in the appropriate
`restore.json` and restart the archive/relay user services if Python changes.
For a full return to V40a, restore the final phase and then the initial phase.
Never restore the SQLite snapshots over subsequent human decisions. No schema
changes or media moves/deletions were required.
