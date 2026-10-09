# S9+/S3 historical Drive person categorization — verified archive only

This operates on the **existing** Drive archive inventory. It is intentionally
separate from the native Android 4K recorder, its microSD source and the live
C720P person candidate monitor.

## Scopes and guarantees

- Work list = only index entries with state **verified**, cameras \`new\`
  (including both \`NEW_\` and old \`S9PHONE_\` names) or \`s3\`.
  The audited starting inventory on 10 October 2026 had **180 verified clips**
  (**173 new + 7 S3**) and **160 deleted entries** excluded entirely.
  Live inventory changes can change these totals.
- Each selected clip is streamed via \`rclone cat\` to FFmpeg and decoded to
  bounded 320×240 RGB frames **in memory**; the CPU-only on-hub TFLite
  SSD MobileNet model produces anonymous person, vehicle and animal proposals.
  No videos or JPEGs are saved on the hub and no Drive write is performed.
- A SHA-256 clip key including camera namespace creates a stable *record*
  across reruns. It is not an identification of any person.
- The private \`~/c720p-home-hub/state/s9-legacy-person-catalog.json\`
  is written atomically as mode 0600 after every clip. Its status distinguishes
  classified, pending and retryable failures. No cleartext model embeddings,
  face descriptors, biometric identities or sensitive demographic labels.
- Explicitly tagged confidence is **uncalibrated model evidence**, *not*
  a probability that the video was correctly labeled. Historical
  \`confirmed_person\` archive metadata is also an older AI decision, not
  independent ground truth.
- Multi-person classification needs separate non-overlapping boxes in two
  sampled frames. One frame with distinct boxes stays \`possible_group\`.
  Distinct track fragments do not establish recurring identity.
- On each batch the scanner confirms the native camera is idle, healthy
  and below 38°C, and uses one TFLite CPU thread. The timer service is set to
  Nice=17, CPUQuota=30%, MemoryMax=600M, and at most 3 clips per batch.
  Failure or reboot preserves completed checkpoints.
- No automatic deletion, new cloud upload, production Android APK replacement,
  4K motion trigger change or real-person identity inference.

## Persistent visitor IDs: independent human confirmation

The Security page gets an authenticated **Historical Drive clips — Person
review** section. It displays the completed AI proposals and links to the
original verified Drive folders and exact file names.

If, *after viewing that exact source video*, the reviewer confirms one
specific person, they can create a private \`VIS-0001\` visitor ID or link the
clip to an **existing** ID. A confirmation checkbox and explicit write-intent
header are required. Group clips, animal-only, vehicle-only and unresolved
clips cannot be assigned a unique visitor ID by the one-person UI.

The visitor registry is only a list of **manual assertions**. Two recordings
are not automatically linked using faces, biometrics, clothing, or another
unverified appearance embedding. A visitor ID does not verify a legal name,
biometric identity, or intent. These pseudonyms can be corrected/removed and
all changes are privately audited.

## Deployment

The installer \`deploy-drive-person-catalog.py --stage <immutable staged
source directory>\` performs offline regression tests, checks active camera
health and existing SD playback, backs up all changed files, updates the
private signed relay and page, checks that unauthorized writes are rejected,
validates 206-range MP4 seeking, enables the timer, and rolls back on any
failure.

The timer is \`c720p-s9-drive-person-catalog.timer\`, running at most 3
recordings per batch; only the private metadata catalog is updated.

For an immediate read-only estimate:
\`\`\`bash
$HOME/c720p-home-hub/build/s9-detector-benchmark/venv/bin/python \
  $HOME/c720p-home-hub/bin/s9-drive-person-catalog.py --dry-run --max-clips 3
\`\`\`

To stop the unattended scanner **without affecting the native camera**:
\`\`\`bash
systemctl --user disable --now c720p-s9-drive-person-catalog.timer
systemctl --user stop c720p-s9-drive-person-catalog.service
\`\`\`
