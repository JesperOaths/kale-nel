# Stage 4 — detector validation and guarded cutover decision

**Decision: HOLD EXISTING SSD CAMERA PERSON DETECTOR. Do not install EfficientDet-Lite0 as the production trigger and do not retire the current detector.**

Evaluation date: 11 October 2026. This is an evidence-based deployment gate, **not** a claim of measured improvement.

## What was verified

| Evidence | Measured / observed | Interpretation |
| --- | --- | --- |
| Previous on-S9+ SSD MobileNet CPU median | **147 ms** | Baseline |
| Previous on-S9+ EfficientDet-Lite0 CPU median | **172 ms** | ~17% slower |
| SSD CPU p90 | **189 ms** | Baseline |
| EfficientDet-Lite0 CPU p90 | **233 ms** | ~23% slower; fails the 10% latency regression gate |
| Archive comparison | **4 clips / 54 paired decoded frames** | Sampled frame A/B, not continuous 4K stream |
| Baseline temporal person-track confirmations | **0** | Model did not confirm a person in tested windows |
| Candidate temporal person-track confirmations | **0** | No demonstrated recall gain |
| Independent human-positive/human-negative labels | **Absent** | True person precision/recall, night recall, and missed non-recorded visits **not measurable** |
| Post-Stage3 native Camera2 installation and restart | Job **10097**, exit code 0, monitoring after upgrade | Native `watching`, snapshot ready, configured 3840×2160 recorder, Stage3 event/thumb versions |
| Authenticated Hub gallery and index publication | Job **10098**, exit code 0 | Signed microSD catalog and Saved Clips event segment labels installed |
| Latest available health mirror, observed 07:19:38 UTC | Proxy `camera_ok=true`, 24 MJPEG output FPS, `recording=false` | Confirms Home Assistant **proxy health**, not independent native 4K event quality |
| Current production detector name in installed Stage3 source | `garden_roi_gpu_two_frame_person_gate_v2` | Production source unchanged from SSD person-gate model |

The initial 54-frame benchmark is documented in [ON_PHONE_BENCHMARK_20261011.md](../s9-detector-benchmark/ON_PHONE_BENCHMARK_20261011.md). Its report on S9+ microSD is `/storage/9C33-6BBD/Android/data/nl.kalenel.s9benchmark/files/bench-results/compare-1791699468509.json`. The initial test had a 6-minute wall-clock ceiling and was not a continuous frame-rate or missed-visitor test. Its zero confirmed tracks prove **nothing** about absence of people in the recordings.

## Attempted fresh validation / execution boundary

A bounded, **read-only** C720P/S9+ audit was implemented in `audit-stage4-readonly.py` and checked in CI. It is designed to:
- confirm two successive native Camera2 frame-counter/snapshot samples and unchanged SSD detector status;
- stratify old and new MP4 recording manifests on microSD without copying any videos;
- count independent human-reviewed cases, real classification and thumbnail sidecars, 4K resolution metadata and event-continuity evidence;
- aggregate raw SSD/Lite0 candidate detections from the existing 54-frame on-phone report;
- verify that the rollback APK exists with a distinct hash and retain all original videos.

**The attempted management-authenticated remote read-only execution request was blocked. It was not queued or run, and no output from it is represented as on-device evidence.** No APK installation, force-stop, recording, detector swap, retention deletion, benchmark continuation, or camera reset was performed during this Stage4 attempt. The archive beyond the existing benchmark and new motion activity have **not** yet been freshly validated by this audit.

The latest Supabase-proxied health snapshot is not a direct substitute for camera/MP4 inspection; the Home Assistant C720P disk also reported ~631 MiB free, which is distinct from S9+ microSD free space.

## Non-bypassable automated gate

`stage4-cutover-decision.py` reads human-annotated paired **continuous observation windows** and independent device health evidence; it **never deploys a model**. Required evidence:

1. At least **20 person-positive and 20 non-person** windows each in **daylight and darkness**, all independently reviewed and with both candidate/baseline predictions from **the exact same intervals**; video windows admitted solely by the old motion detector are rejected as selection-biased.
2. At least **5 percentage points absolute recall gain**, statistically significant paired-positive wins (two-sided exact McNemar p below 0.05), no additional false alarms or newly missed people in either day or night.
3. Candidate on-device p90 inference time no more than **10% slower** than baseline, thermal increase at most **2°C** under matched conditions.
4. Native 4K dimensions, saved video playback, microSD reserve, recorder/snapshot health, absence of lost capture and a verified rollback APK.
5. Even if those pass: **guarded candidate shadow/canary rollout first**, then retain the previous detector for at least **7 days of incident-free monitoring**. Only then can it become eligible for retirement.

None of the paired independent gold-label data currently satisfies this gate, and the earlier candidate p90 result specifically violates item 3. An eventual positive synthetic unit test proves the **decision code**, not camera detector performance.

## Rollback and invariants

- Verified production Stage3 candidate APK SHA-256: `3b29ad2315988f5b1c2d0c169342ec25f16e087879340f4b6d9e73360e895e0e`.
- Prior working camera APK backup: `/home/jespern/c720p-home-hub/backups/native-security-cutover/S9-native-before-night-guard-20261011-090409.apk`.
- Production signed and prior APK both passed matching certificate SHA-256 `0ca669482a7b5bc4698eae4ba43897b913177f87907418a8231b95e830675bb5`.
- Existing face embedding model SHA-256 `2254b01065c1f69ff501e9501042441b85323710e3d5a7b6be04a5084b647651`.
- Home Assistant release backup `/home/jespern/c720p-home-hub/backups/s9-event-v3-hub-publication/20261011T070707756325Z`.
- **Existing SSD MobileNet production person gate preserved. Original MP4s, original manifests, phone camera settings and user data untouched by Stage4.**

## Clear remaining acceptance tests

Freshly inspect true new S9+ clips and their actual video playback and event-focused JPEG thumbnails; corroborate the on-phone detector counters during a real garden walk-by; compare both algorithms against independently labeled day/night visitor and nonvisitor windows, **including non-recorded intervals**. Only a measured and statistically supported gain permits a guarded candidate cutover; without that, keep SSD active.
