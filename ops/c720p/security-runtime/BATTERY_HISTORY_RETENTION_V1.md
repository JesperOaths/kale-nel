# C720P battery telemetry retention V1 (2026-10-21)

**Scope:** purely disposable *S9 battery sampling JSONL* at `state/camera-android-power-save.jsonl`. This is not a recording, original, human review, model, Save/Delete journal or Security UI change. The two actual readers currently consume at most the newest 300/2500 entries. Other shared backend owners are not modified.

## Live verified state
- C720P owner-installed script `bin/c720p-camera-android-power-save.sh`, SHA-256 `6fff51503a2b8ca65d3a01e8f46fcae8850b1bda120d528625c72fbfc022470b` (preimage backed up; see below)
- New owner-installed helper `bin/c720p-battery-history-retention-v1.py`, SHA-256 `29442c8533ad96c0e367de526b4344ab77f2aba38c9239f32d57d84181148139`
- The source files and matching shell patch in this directory are the reproducible scope of this PR. Do not blindly apply the patch to a different shell script revision.
- On 2026-10-21, authorized `jespern` private shell executed 5 negative/success tests and `bash -n`; the initial bounded real run returned `compacted_with_verified_archive`. Active telemetry: **8,493,198 to 3,072,534 bytes**. Single archive `.1.gz`: **122,659 bytes**; decompression verified.
- Before/after SHA-256 digests of the actual current results from BOTH `c720p-camera-battery-notifier.latest()` and `c720p-phone-battery-state.power_cache()` were identical. Exact private sample values are deliberately excluded. HA localhost still HTTP 200 and battery writer timer enabled/active.
- Live changes were reversible and made while battery writer/reader services were inactive, under the new exclusive append/compact writer lock. No camera process, S9 APK, media, review or worker threshold was changed.

## Contract and safeguards
- Writer invokes compaction **only after** its existing phone/battery operations; avoids any additional timed job or independent competing cleanup.
- Operates on exactly the existing fixed source path when invoked from shell with `--apply`, refuses symlinks/hardlinks/foreign mounts/unsafe prior archive/oversize input, retains newest **2500** complete line-delimited records, bounds active log at **8 MiB**, retains a verified compressed predecessor (<=4 MiB), and uses temporary files plus fsync and atomic replacement. If conditions fail, keeps the original log unchanged.
- `flock -n` serializes multiple actual writer invocations; readers reopen by path and were verified to return the same current entries. Earlier battery history is deliberately disposable; the single compressed predecessor is a bounded rollback generation.
- Tests exercise successful retention+readback, symlink rejection, hardlink rejection, unsafe archive rejection, and oversized recent sample rejection.
- Do not use this package to clean media, database, recordings, evidence or reviews. It is not permission to retire the six C720P migrated originals.

## Deployment and rollback
1. Confirm current source hash and no active writer; back up `bin/c720p-camera-android-power-save.sh` to the protected owner-only `backups/infra-battery-history-retention-20261021/c720p-camera-android-power-save.sh.before`.
2. Stage the helper to `bin/c720p-battery-history-retention-v1.py`; apply the exact shell patch only against matching preimage SHA-256 `7dd7e954839cce7c871465aeac499f3a46f96dc92c2fa86955246c3dad47e27e`. Run `bash -n`, Python compile and bundled tests.
3. The first application should be made only while the battery writer unit is inactive and holding `state/camera-android-power-save.jsonl.retention.lock`. Compare both current reader results before/after.
4. To rollback the integration, restore the protected `.before` shell file when installed hash still matches, keeping telemetry and its compressed predecessor; do not alter camera configuration. The new helper can remain inert after the shell restoration.
5. Do not overwrite an active/newer different installed version. The completed helper and shell installations are private-device proof; GitHub merge alone is **not** deployment proof.

## Current scope exclusions
Historical joiner remains deferred at **38.5°C S9+** (strict existing threshold is <36.2°C) and hub MemAvailable ~377 MiB (<1 GiB minimum), although healthy 4K capture is at 30.02 fps, 8,995 ms buffered and zero reported drops. NTP is synchronized, root has ~4.6 GiB free. The separate Save/Delete app-private backend is unaccepted; UI and evidence work remain with their existing owners.
