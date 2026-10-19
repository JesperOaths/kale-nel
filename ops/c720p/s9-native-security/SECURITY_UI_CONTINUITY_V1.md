# Security UI continuity corrections

`patch-security-ui-continuity-v1.py` transforms four **fresh deployed** assets
using narrow, idempotent edits. It does not install anything or call device
endpoints. Existing source assets in this repository may lag independent live
changes, so they must not replace the fresh deployed files wholesale.

Corrections:

- Restore the local per-render face-crop deduplicator in saved folders. This
  declaration already exists in current mainline; staging leaves it untouched
  wherever it is already present.
- Replace substring-based Archive person labels with explicit positive and
  uncertain categories. `no_person_model_detection` cannot become Person even
  with a contradictory old count. Negative sampling does not establish absence.
- Resolve the authenticated relay in the recovery page's own window or its
  same-origin parent. Missing/inaccessible relay fails closed. Auxiliary
  companions remain separate from verified originals and human assignments.
- Display native 4K preference independently from capture readiness, buffered
  milliseconds and dropped-output-frame count, and expose the already supported
  native night-mode control. Missing or wrong-type telemetry stays unreported.

The matching status adapter must supply strictly validated
`native_4k_enabled`, `continuous_4k_ready`, `continuous_4k_buffered_ms` and
`continuous_4k_dropped_output_frames`. This UI never infers readiness from
sensor FPS or camera watching mode. Screen-only brightness enhancement remains
independent of the native night policy.

Example staging (explicit, separate destination; no in-place mode):

```text
python patch-security-ui-continuity-v1.py --source-root /path/to/fresh-www --output-dir /path/to/reviewed-stage
node test-security-ui-continuity-runtime-v1.mjs /path/to/reviewed-stage
```

Without `--output-dir`, the script prints the before/after SHA manifest only.
It refuses unrecognized/partly modified anchors, a source/output overlap, or
overwriting an earlier stage. Production integration remains a separate step
requiring fresh-hash comparison, backups, coordinated cache keys and rendered
browser verification. It must preserve independent appearance, automatic-face,
camera, recovery-processing and manual-review work.

`python test-security-ui-continuity-v1.py` verifies idempotence, preservation of
unrelated text/line endings, already-fixed mainline behavior, fail-closed
staging and source/output isolation. The Node suite executes the changed
functions and complete recovery metadata/preview workflow in a fake DOM,
including missing/cross-origin parent failures. It makes no network requests,
loads no media and writes no reviews. Minimal fixtures preserve the original
pre-fix contracts without retaining private recording or person data. Set
`C720P_TEST_TMPDIR` to a writable scratch directory where the Windows sandbox's
default temporary directory is unavailable.
