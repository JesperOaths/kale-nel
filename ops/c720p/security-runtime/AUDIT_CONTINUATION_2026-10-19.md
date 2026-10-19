# Home Assistant Security audit continuation — 19 October 2026

## Recovered handoff

The comprehensive code/runtime audit was PR #767, not a finished migration.
It deployed eight runtime fixes and verified 175 indexed S9 originals, but
left administrator clock synchronization and physical motion/light acceptance
unresolved. Later UI changes and the offline ML worker are separate ongoing
work. This continuation started from main commit
`8f3867a9594027dc0ddd529e4a079692bb9d4573` (PR #821).

Live baseline job **11624** confirmed 175 S9 catalog entries, 94 historical
Drive entries, continuous native 4K ready, zero reported dropped output frames,
33.3°C, no failed user units, and roughly 993 MiB root free. NTP remains disabled.
The phone metadata timer and fast catalog consumer were already enabled, but
the full scanner still used its older deployed source. Merge status alone did
not describe that live state.

## Reproduced errors and repair

| Defect | Correction | Regression evidence |
| --- | --- | --- |
| A full refresh could overwrite a populated index with an empty/partial result after a native-directory or previously indexed sidecar read failed. | Refuse publication before either recording or fallback-preview metadata is written. Preserve the last complete index. Only a successful directory listing can prove an original was actually removed. | Both failure reproductions failed against the previous implementation and pass after repair; explicit real-removal reconciliation remains supported. |
| The standalone phone worker required exact equality with the older hub index, rejecting a verified new original until the old scanner discovered it. | Accept validated phone additions while requiring every pre/post hub original to remain represented. A missing known original or shrinking hub still defers publication. | New-original discovery passes; missing-record and shrinking-hub cases retain prior private results. |
| The standalone catalog did not install the newer JPEG endpoint into Camera2; a new thumbnail therefore had no working transport through that endpoint. | Preserve the indexers' existing bounded ADB thumbnail transport as a fallback, checking identical filename, byte size and JPEG markers on both transports. Never decode or transfer an original video for a thumbnail refresh. | New thumbnail from an old APK passes; a malformed fallback cannot replace a valid previous image; valid cached versions avoid both transports. |
| The legacy single-file fast-index publisher could install a caller before its required helper API. | Reject that deployment unless the local client supports the new optional argument. The grouped rollout supplies all four modules together. | Compatible and incompatible client API cases pass. |

## Validation and release

- **126 local unittest cases** passed across catalog/client adapters, metadata
  worker, runtime cancellation/retention, manifest bounds, transport, evidence,
  face-image integrity, manual links and Automatic Person review. The separate
  person-track assertion suite also passed. This corrects the intermediate
  progress message's mistaken total of 136.
- Python syntax/compilation and `git diff --check` passed.
- Private hub preflight **11640** passed all three staged regression suites,
  exact deployed-source checks and the 175-recording archive/capture baseline.
- Public GitHub push was rejected by automatic approval review because public
  publication lacked explicit authorization. No alternate public upload was
  attempted. The owner explicitly approved public publication on 19 October. The
  reviewed source is now being synchronized through the connected GitHub app.
- Private deployment uses the authorized maintenance gateway, a verified
  checksum-bounded source bundle, predecessor hashes, private byte backups,
  a shared catalog lock, restored timers and rollback on any failed check.
  Camera2, Home Assistant, recording services and manual review files are not
  deployment targets.
- Source bundle SHA-256:
  `d9b9bd71803cc9994bcb3bed764fbf922a66c1e8a848f6dfcaf78d2a190404e9`.

## Verified private activation

Private activation job **11644** completed with exit code 0. All four deployed
module digests were checked. The phone worker, full scanner and fast indexer
completed successfully; the archive remained **175 before / 175 after**, and
all four manual assignment/rejection state and audit-file digests were
unchanged. Capture health was checked between each oneshot. Rollback source
and index metadata snapshots were retained on the managed hub.

Measured CPU for these individual activation runs: phone metadata worker
0.396 seconds, full scanner 12.185 seconds, fast indexer 0.338 seconds. The
full scanner's first migration run refreshed thumbnail versions; these are
single-run resource measurements, not continuous-load claims.

Final readback job **11649** verified matching installed source hashes, all
three timers active, zero failed user units, five served Home Assistant assets
identical to disk, three native original MP4 byte ranges returning correct 206
responses, three valid recording thumbnails and three candidate-crop JPEGs
matching their indexed byte sizes and SHA-256 digests. This proves image
integrity/delivery, not face identity or crop quality. Both catalogs still
contained 175 S9 / 94 Drive entries. Camera remained watching, continuous 4K
ready, zero reported dropped output frames, 33.3°C, frame age 30 ms.

Historical Drive readback job **11650** also passed: three sampled original
videos returned HEAD 200, `video/mp4`, positive expected content lengths and
byte-range support. No original video bytes were downloaded in this check.

After rebasing this repair onto the latest mainline, all **133 local unittest
cases** passed (the original 126 plus seven combined S9/Drive activity tests),
along with the separate person-track assertions. The legacy fast-index workflow
now accepts both successful installation and already-current receipts.

## Still separate or unverified

- Administrator NTP repair remains unresolved. The prior authorized sudo
  attempt required a password. Authentication timing checks were not weakened.
- S3 health polling is restored but a fresh private camera heartbeat and actual
  room-motion/manual-switch behavior still require acceptance evidence.
- The remaining S9 offload pilots and full identity-model/backfill work remain
  separate ongoing tasks. This change neither claims them complete nor changes
  Camera2/ML models, inference thresholds or approved identities.
- No physical walk-in, dark-room, light-switch or identity-quality acceptance
  result is inferred from service health or synthetic tests.
