# Security continuity V1

This release connects existing Security metadata, manual-review and display
contracts. It does not change the S9+ APK, recording configuration, original
media, recognition models, person decisions, scheduled camera jobs or other
chats' appearance/recovery workers. Coordinate current ownership before each
release and compare fresh live hashes immediately before applying it.

## Source and live state

Canonical repository assets can lag independently deployed UI additions.
Transform fresh deployed files with the pure patchers; do not replace those
files wholesale from an older repository copy. Preserve the current migrated
recordings panel, private relay resolver and independent model/range features.
Stage source separately and retain before/after SHA-256 manifests.

The recorded core receipt verifies deployment on **19 October 2026 at 20:49
CEST**: eight files, 223 originals retained, manual state unchanged, native
capture ready at 30.02 sensor fps with zero dropped output frames, and screen
motion accepted with the original full/dim baseline of 937/281. It verifies
routes/status; it does not establish a physical walk-triggered screen wake or
every rendered browser workflow. Later UI/cache work requires its own receipt.

Core contracts:

- The authenticated LAN relay forwards only allowlisted localhost metadata,
  exact auxiliary media paths and explicit human proposal **denial**. It
  preserves authentication, origin/intent validation, query bounds and media
  ranges; it adds no assignment or inference job. Missing face proposals remain
  `face_embedding_index_not_ready`, not a completed identity pipeline.
- Native 4K preference, capture readiness, buffered milliseconds and dropped
  frames are separate typed values. Unknown values remain unreported.
- Screen wake accepts the shared V16/V18/V19 confirmed-motion contract with
  seven-second freshness and a 150-second wake window. Lamp permission does not
  suppress screen motion. Compare the daemon's full/dim baseline across restart,
  rather than using its currently dimmed physical brightness as the new full.
- Outfit candidates and cached results honor final skipped/rejected/assigned
  review state; only an explicit empty inbox reopens them. Source-qualified
  manual group memberships remain intact.
- Review tabs accept visibility/Refresh messages only from their same-origin
  parent, announce readiness, stop hidden video and gate automatic 60-second
  polling. Explicit Refresh and standalone use remain available. The separate
  night display asset gates its 16-second telemetry polling on the actual
  `panel-live.hidden` flag. No blanket timer/request interception is used.

## Core eight-file deployment

`deploy-security-continuity-v1.py` permits four hub scripts only:
`s9_continuity_relay_v1.py`, `c720p-lan-camera-relay.py`,
`s9_phone_garden_status.py`, `c720p-screen-idle.py`; and four web assets:
`security-people-v45.js`, `security-archive-v7.html`,
`security-review-v8.html`, `security-hub-v30.js`.

Prepare the reviewed stage and its eight-entry `manifest.json` from fresh
sources, using `patch-security-transport-continuity-v1.py` and
`../s9-native-security/patch-security-ui-continuity-v1.py` where applicable.
The operator supplies the reviewed manifest digest:

```text
python3 deploy-security-continuity-v1.py --stage <private-stage> --manifest-sha256 <digest>
python3 deploy-security-continuity-v1.py --stage <private-stage> --manifest-sha256 <digest> --apply
```

Default preflight validates exact hashes, targets and Python syntax, current
native capture, original catalogue, manual state and active services. Apply
backs up privately, rechecks each target before writing, restarts the archive
proxy, LAN relay and screen daemon, then validates routes, unauthorized LAN
rejection, native telemetry, unchanged manual state/original coverage and
screen baseline. On failure, code rollback restores only bytes still matching
this release and preserves concurrent edits. Inspect its receipt/conflicts and
repeat health checks; never restore an old review database over newer decisions.

Core backups/verification receipts live beneath the private hub directory
`backups/security-continuity-v1/<timestamp>/`.

## UI/cache seven assets plus one dashboard value

Apply `../s9-native-security/patch-security-review-lifecycle-v1.py` to fresh
People, Review and night-display assets. Apply `security_cache_release_v1.py`
as pure transforms to the supplied fresh cache entrypoints. It updates only
the existing Security version keys, preserving other query fields/routes and
unrelated dashboard values.

`deploy-security-ui-release-v1.py` runs **inside the HA container**. Its seven
targets are `c720p-surveillance.html`, `security-hub-v30.html`,
`security-hub-v30.js`, `security-people-v50.html`, `security-people-v45.js`,
`security-review-v8.html`, and `s9-night-visibility-v1.js`. It also changes only
the unique Security iframe URL in `/config/.storage/lovelace.c720p_hub`.

```text
python3 deploy-security-ui-release-v1.py --stage <private-container-stage>
python3 deploy-security-ui-release-v1.py --stage <private-container-stage> --apply --expected-plan-sha256 <reviewed-plan-digest>
python3 deploy-security-ui-release-v1.py --rollback <private-backup>/receipt.json
```

Preflight is read-only and produces a deterministic plan covering current
bytes/metadata, staged hashes, the dashboard change and helper versions. Any
source/helper drift requires a new reviewed plan. Apply preserves modes/owners,
creates private backups and writes a `files_applied_restart_pending` receipt.
It performs no HTTP requests or service restarts. The authorized operator owns
container access, one subsequent HA restart and live cache-chain/browser
verification. Files applied is not live acceptance. Rollback checks the private
receipt/plan and restores only unchanged release bytes; conflicting independent
edits are preserved and reported. The operator then restarts/rechecks HA as
needed. Container backups are private under `/config/.security-ui-release-backups/`.

## Verification and handling artifacts

The unified `c720p-continuity-contracts.yml` workflow validates transport,
screen, UI transforms, review lifecycle, **eight cache tests**, native status,
detector-version compatibility and the file-only UI deployer's scratch tests.
Tests use synthetic metadata/fake browser surfaces or temporary files; they do
not exercise live cameras or save human decisions.

Commit canonical source, reviewed offline fixtures and documentation only.
Never commit live source snapshots, release manifests, private backups/receipts,
HA storage documents, authentication material, media or personal review data.
Keep those artifacts in private operator/device storage; public reports should
contain only the minimum non-secret verification summary.
