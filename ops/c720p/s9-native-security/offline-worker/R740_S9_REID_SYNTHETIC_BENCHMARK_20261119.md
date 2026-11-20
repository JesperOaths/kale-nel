# R740 — S9+ isolated ONNX Re-ID candidate benchmark (2026-11-19)

## Execution outcome

Executed with **real ONNX Runtime JNI** on the **actual SM-G965F (Android 10)**,
not a laptop or hub CPU. All inputs were deterministic synthetic RGB tensors
(normalized with ImageNet mean/std), **no photographs or videos**. All model
weights and DEX artifacts were SHA-256 checked on the sender and on the phone.
No APK reinstall/restart, People-folder assignment, reference mutation,
additional background task, or recording write occurred.

- Source: `S9ReidSyntheticProbeV740.java` on branch
  `research/s9-reid-batch16-r740-20261119`, commit
  `4a6383a03d37dba04b488d4dd420baa9db6c68cb`.
- Compiled on the hub with Android platform API, official ONNX Runtime Android
  1.22.0 AAR and D8, **without using the hub for pixel processing or ONNX inference**.
- Program packaged in SHA-verified isolated Android DEX jar
  `e12e32618aaad6a239a8fba49659fad4738e1ffb91c9bc2d748c8388f5e87758`.
- Executed via separate `app_process` at `nice -n 15` with intra-/inter-op
  threads both set to 1; not through the camera APK.
- Private phone test directory: `/data/local/tmp/s9_reid_r740/`.
  This is distinct from the active camera service, gallery, model deployment,
  worker queue and existing `/data/local/tmp/s9_worker/` records.

## Verified model candidates

| Candidate | Source | ONNX SHA-256 | Model I/O | Status |
| --- | --- | --- | --- | --- |
| OSNet x0.25, MSMT17 Re-ID | [anriha/osnet_x0_25_msmt17](https://huggingface.co/anriha/osnet_x0_25_msmt17) third-party conversion | `e78604f4ccda49b8f41cd0f8f7303800ce75d2361895ebb0729513c1bf53d277` | fixed `[16,3,256,128]` → `[16,512]` | S9 synthetic runtime PASS; external conversion has not been independently numerically matched to upstream PyTorch |
| OSNet-AIN x1.0, MSMT17 Re-ID | [mprib/osnet-ain-x1-0-msmt17-onnx](https://huggingface.co/mprib/osnet-ain-x1-0-msmt17-onnx) third-party conversion | `f11a8fa82c3980f13f563210ddf197346bbd8d1bd0dca364c4ad6c4e39794116` | dynamic `[N,3,256,128]` → `[N,512]` | S9 synthetic runtime PASS; upstream numerical equivalence is reported by publisher but not independently reproduced |

Official OSNet-AIN x0.25/x0.5 weights are available as **ImageNet-pretrained**
backbones. Those are **not** interchangeable with MSMT17-trained Re-ID
checkpoints and must not be silently represented as an identity model.
Small MSMT17-trained **OSNet (non-AIN) x0.25/x0.5** checkpoints can be used
as separate candidates after trusted export and equivalence proof.

## Measured phone inference (milliseconds)

All figures are **wall time for `OrtSession.run` including obtaining and
validating the output**, not model load, JPEG preprocessing, video decode, or
end-to-end tracklet time. One explicit warm-up, then exactly two reported
timed calls, one Android process per candidate.

| Model | Batch | Warm-up | Timed #1 | Timed #2 | Mean timed | Mean / actual input crop |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| OSNet x0.25 | 16 | 423.52 | 370.95 | 384.96 | **377.96** | 23.62 ms amortized |
| OSNet-AIN x1.0 | 16 | 2892.64 | 2817.74 | 2670.30 | **2744.02** | 171.50 ms amortized |
| OSNet-AIN x1.0 | 1 | 201.25 | 197.04 | 192.88 | **194.96** | 194.96 ms |

The fixed-batch OSNet x0.25 **always** requires 16 inputs (or explicitly
documented padding), so amortized timings must not be reported as true
single-crop latency. Multiple frames from one recording are **one source
bag**, not multiple independent person confirmations.

## Phone safety evidence

- Recorder PID **7244** before/after both equal-batch experiments.
- Battery-reported phone temperature **33.2 C before**, **33.2 C after x0.25**,
  **33.5 C after AIN x1.0**.
- Available RAM **2,429,500 KiB before**, **2,466,088 KiB after**.
- S9 model artifacts + probe jar checksums verified on-device.
- Model output contained exactly 512 finite, nonzero floats per input, but
  **not L2-unit-length**. Retrieval must normalize the raw vectors.
- Camera frame production/dropped-frame telemetry **not independently sampled**;
  recorder PID stability alone does not prove 30 FPS capture continuity.
- `real_crops_processed=0`; `auto_assignments=0`.
- C720P root filesystem was already near 98% utilization. Do not multiply
  local model copies or install PyTorch there.

## Next execution gates

1. Acquire **source-exact, full-person S9-native crops** with unambiguous
   person-track association, original SHA and verified current gallery
   revision. Reject torso-only/partial/multi-person boxes.
2. Add a phone-only **real crop** inference mode that writes a private
   append-only vector sidecar, keyed by model digest, crop digest, source
   digest and tracklet id, with repeatable preprocessing and no names.
3. Build a **source/day/outfit disjoint** evaluation. Verified reference
   labels must not share an original, near-duplicate crop or self-training
   path with held-out test examples.
4. Compare top-1, top-3, class ambiguity, per-source failure explanations
   against the frozen baseline. Independently validate known/unknown FAR.
5. Keep automatic filing disabled until both identification performance
   and unknown-person rejection cross predeclared, independently validated
   operating thresholds. Do not release trained models from synthetic
   runtime benchmarks alone.

No scheduled ChatGPT task, new daemon, background service, or automatic
source-label promotion was created.


## Additional read-only inventory of another existing S9 TFLite research run

At 2026-11-20 00:01–00:05 Europe/Amsterdam, a **separate, preexisting**
research directory was inspected **read-only** on the phone:
`/data/local/tmp/s9-osnet-qualcomm-reid-shadow/`. This is NOT the R740
ONNX benchmark. It used a different model, indicated by schema
`S9_REAL_OSNET_MARKET1501_SHA_EXACT_PERSON_CROP_RESEARCH_ONLY_V1`, with
model SHA `5249d33bb1cd53e53c9096db9d6acf555b698a7f4561a2b3eb81df4fcbfaac5c`.

- 18 source manifest batches, 99 crop-plan entries (40 reference and 59
  held-out), 98 distinct 512D private vector sidecars. One repeated planned
  crop explains the apparent one-entry discrepancy; no missing unique vectors.
- On-phone sidecars link to the exact source/crop metadata across all 98
  records, with 39 reference and 59 held-out unique sidecars.
- **Zero source-SHA overlap** between reference and held-out roles; the
  held-out crops represent 32 original recording source hashes.
- The 40 planned reference crop SHA hashes matched the frozen approved R407
  gallery source/crop authority exactly. But **five reference crop entries
  failed the strict upright-quality gate**, and three frozen reference entries
  had `frame_timing_verified=false`. An accuracy evaluation must filter these,
  not treat them as equivalent clean identities.
- The 98 existing sidecars report on-phone inference latency median **93.82
  ms**, range **84.10–158.05 ms**, but these are a different TFLite model and
  should NOT be compared as equivalent to the R740 ONNX runtime numbers.
- All 98 sidecars report `original_source_frame_PTS_independently_verified=false`.
  No held-out person labels were used by this existing embedding producer.
  There are **zero automatic folder assignments** reported in these sidecars.
- 30 of 32 held-out original source hashes intersect the **already-used**
  private R714 retrospective owner-labelled recording-bag set. Such labels
  are **not** independent unseen prospective validation and are recording-level,
  not proof of which individual track depicts the named person.

A metadata-only builder for a future blinded gallery was drafted but **its
execution was denied by a tool safety check**, and its unexecuted source
was removed from the branch. No alternative execution path was attempted.
**No source-to-identity ranking or known/unknown calibration was run.**
Do not promote a new matcher from these metadata counts.


## R742/R743 continuation — 2026-11-20 00:12–00:20 CET

### R742: strict, read-only camera admission

New source `s9_reid_capture_admission_v742.py` remains separate from
all live camera and recognition services; only `--self-test` and `--observe`
are supported. Its 17 synthetic fault cases PASS. The actual S9+ admission
sample over 2 seconds returned `REFUSE_MODEL_ADMISSION`, as designed.

Observed safe camera fields:
- S9 live recorder PID remained **7244**; sensor FPS **30.02**.
- Sensor frames advanced by **65** across the observation.
- Last frame ages 2 / 15 ms; source-capture result ages 30 / 12 ms.
- Phone battery temperature 31.5 C; camera temperature 31.4 C.
- 0 reported dropped 4K output frames; preroll_ready true.

**Unresolved camera state:**
- `continuous_4k_ready=false`;
  `continuous_4k_buffered_ms=0`;
  `continuous_4k_production_persisted=false`.
- `continuous_4k_last_result=fallback_control_disabled`.
- `native_4k_enabled=true` and independent memory-ring
  `preroll_ready=true`, `preroll_buffered_ms≈6998`.
- This is **not proof of a healthy continuous 4K output pipeline**.
  Live 30 FPS sensor results and 4K-ready status must remain separate.
- No attempts were made to enable, restart, or reconfigure the camera.
- R742 deliberately refuses any proposed heavy model experiment until both
  the independent 4K admission and a subsequent capture-under-load check pass.
- R742 read-only output: `sensor_frames_delta=65`,
  `reasons=['continuous_4k_buffer_under_5s',
  'continuous_4k_ready_not_true']`.
- S9 SD and phone memory/temperature observations pass their bounded checks.

### R743: open-set automatic-filing release guard (purely synthetic test)

New `s9_reid_open_set_release_gate_v743.py` evaluates only **external,
independently attested aggregate summary counts and booleans**. It never
opens actual identities, images, phone embeddings or private scoring files.
- The first synthetic test discovered a math-domain issue for impossible
  known counts. The implementation was fixed to **fail closed**, with an
  explicit impossible-count reason. Subsequent test surfaced a missing
  secondary rejection reason; that was fixed too.
- Final result:
  `R743_SYNTHETIC_RELEASE_GATE_TEST_PASS`,
  **16 synthetic refusals checked**.
- Provisional target: no observed false accepts in at least 600
  independent unknown-source recording bags to demonstrate a 95% one-sided
  FAR upper bound under 0.005 (exact binomial zero-event upper bound).
- Also checks a 95% lower Wilson bound >=0.90 for known correct accepted
  among all known source bags, minimum 100 known recording bags over at least
  8 distinct known people, zero wrong known accepts, no unverified reference
  propagation and independent source, day, outfit and model/camera proofs.
- Passing all proposed numerical gates returns only
  `CANDIDATE_FOR_INDEPENDENT_REVIEW_ONLY`;
  `automation_authorized` is **always false**.
- No actual independent prospective unknown test has yet been performed,
  and these sample-size targets are **proposed release goals**, not
  measured production performance or an owner approval.

### Newly located compact OSNet-AIN Re-ID weights

The [LibreYOLO/LibreReID-osnet model card](https://huggingface.co/LibreYOLO/LibreReID-osnet)
publishes OSNet-AIN x0.25 and x0.5 weights **claimed to have been trained
on multiple person-ReID datasets (MSMT17 / DukeMTMC-reID / CUHK03)**,
as opposed to merely ImageNet-pretrained backbones:
- `osnet_ain_x0_25.pt` — published SHA-256
  `ce171fe160b3608f5e4c19489774991419be965b1d6f4bdccc4b4cfd2ef95347`
- `osnet_ain_x0_5.pt` — published SHA-256
  `510bcebae21bd0c0fcc7df388e97d2f687a9ee4befa4394d6fb1fb19aac0bce2`

These are **PyTorch checkpoints**, not verified Android ONNX artifacts;
the publisher's conversion and training claims have not independently
been reproduced here. Neither small AIN model was installed, exported,
or benchmarked in this continuation. Do not mistake them for the prior
OSNet x0.25 or AIN x1.0 ONNX experiments.

### Remaining release blockers

1. Continuous 4K output is currently not ready despite 30 FPS sensor and
   memory-ring preroll; investigate non-disruptively first.
2. Independently verify source timestamp provenance, crop geometry, and
   strict full-person reference quality; keep the 5 invalid reference crops
   excluded from any clean benchmark.
3. Convert/verify small multi-source-trained AIN x0.25 and x0.5 checkpoints
   on a trusted build environment with source-to-ONNX numeric equivalence,
   then benchmark on S9+ **when camera admission passes**.
4. No identity-scoring data path was executed. The previous attempt to
   run a source/owner-labelled blind-gallery builder was denied by a tool
   safety check, and it was not rerouted.
5. Prospective known/unknown false acceptance and different-day/outfit
   discrimination remain unverified. Automatic People-folder filing OFF.

This continuation created **no new timer, scheduled ChatGPT task, recurring
job, Camera2 modification, production matcher change, or automatic identity
assignment**.


## R744: small model checkpoint artifacts and guarded exporter

Source-only `export_osnet_ain_verified_v744.py` supports pinned
`osnet_ain_x0_25` and `osnet_ain_x0_5` with two separate modes:
- `--verify-only`: strict SHA-256, size, PyTorch ZIP structural checks and CRC
  without loading pickle, image bytes or needing Torch.
- `--export`: **not executed in this continuation**; requires a trusted,
  adequately resourced build machine with Torchreid/PyTorch/ONNX Runtime.
  The implementation refuses incomplete/unexpected backbone tensors,
  uses `torch.load(weights_only=True)`, and requires ONNX shape/parity on
  deterministic synthetic tensors before writing a new immutable ONNX file.

Both publicly published checkpoint files have now actually been obtained and
pinned in the separate restricted C720P research staging folder
`staging/recognition-r744-ain-small-model-assets-20261120/`, **not installed
on the phone**:
- x0.25: **1,001,683 bytes**, SHA
  `ce171fe160b3608f5e4c19489774991419be965b1d6f4bdccc4b4cfd2ef95347`
- x0.5: **2,736,551 bytes**, SHA
  `510bcebae21bd0c0fcc7df388e97d2f687a9ee4befa4394d6fb1fb19aac0bce2`

Both archive checks passed. Each ZIP has 550 tensor data records, 1
`data.pkl` and 0 unsafe archive paths. Pure `pickletools` inspection
found tensor storage reconstruction opcodes and ordinary OSNet-style
parameter keys, without calling pickle loaders. The new verification
script passed both actual pinned checkpoints, **plus two negative tests**
that rejected a deliberately corrupted staged copy and a missing asset.

No model exports, new model inference, image/video work on C720P, camera
changes, user confirmations, folder changes or auto assignments occurred.
The converter still needs actual end-to-end execution and Torch/ONNX
equivalence review; a script compiling is not a proven conversion.


## R742/R744/R749 completed continuation — 20 November 2026

### Capture-path diagnosis and corrected guarded admission

Investigated installed camera source
`staging/s9-night-30fps-20261119/src/nl/kalenel/s9security/CameraService.java`.
`fallback_control_disabled` is set by the explicit
`continuous_4k_trial=disable` camera control, which invokes
`restoreLegacy4K("control_disabled")`. This is **not** a codec crash.
The established path records H.264 with `MediaRecorder` at **3840x2160,
30 FPS, 36 Mbps**, with an independent Android AVC memory-ring preroll.
The optional continuous encoder branch correctly reports
`continuous_4k_ready=false` and `continuous_4k_buffered_ms=0`.

R742 was corrected to admit **either**:
1. A currently healthy continuous 4K ring, or
2. The explicit disabled-by-control fallback with `native_4k_enabled`,
   healthy independent preroll, sufficient encoded preroll duration,
   progressing preroll encoder frames, no preroll drops, adequate storage
   and memory, stable camera PID, >29 sensor FPS, <34 ms exposure, and
   acceptable thermal headroom.

It **never** equates sensor FPS with verified native 4K output during an
event. Standalone R742 synthetic tests now pass **24 fault scenarios**.
Physical two-second admission on S9+ returned
`PASS_OBSERVATION_ONLY` with **66** newly captured sensor frames,
healthy preroll, zero observed drops, 30.02 sensor FPS and unchanged
recorder PID 7244. No camera control or capture change was performed.

### R744 successful x0.25 and x0.5 ONNX exports

Added isolated CPU-only GitHub CI export job (not a scheduled task,
runtime service or C720P inferencer). The first attempt failed because
the runner defaulted to Python 3.13 while the pinned Torch wheel was for
Python 3.11; fixed by pinning Python 3.11. The corrected job
`Isolated S9+ ONNX runtime and archive preservation contract`, run
**44639502561**, completed **successfully**.

Pinned PyTorch **2.6.0+cpu**, ONNX **1.17.0**,
ONNX Runtime **1.22.0**, NumPy **1.26.4**, exact upstream
`osnet_ain.py` SHA
`a43b495866a4b1645cd134a30c3011592e8c6826ba4781955a135588cf46cd25`.
Both publicly distributed checkpoint SHAs matched the R744 pins.
Strict backbone-only state-dict loading, ONNX checker, dynamic batch shape
validation, and **synthetic PyTorch/ONNX numeric parity** passed.
Artifacts were fetched through GitHub, verified by SHA and staged on
C720P, then copied into the existing S9+ research-only
`/data/local/tmp/s9_reid_r740` directory. The production Camera2 APK,
recognition labels and folders were untouched.

| Model | ONNX SHA-256 | Size | Synthetic PyTorch↔ONNX min cosine |
| --- | --- | ---: | ---: |
| OSNet-AIN x0.25 | `e7adf72649332d97c613be93db17a047e526bf55fc8b7240f14a1da67390b7af` | 900,103 bytes | 0.9999999 |
| OSNet-AIN x0.5 | `bc0e6c3819064b2c201716594ca83daad693fb5b8e8c0e4b41b2eebd99d27` | 2,603,447 bytes | 0.9999999 |

These verify conversion consistency **only**. They do not measure
real-person identification accuracy, known/unknown separation, or
verified frame-PTS provenance.

### R744 on-phone, guarded synthetic-only performance

All probes ran with `nice -n 15`, one ORT thread and independent
camera-state observations. 16 fake NCHW crops per batch unless noted.
No real pictures, recordings, identity labels or private embedding
vectors were processed.

| Model | Timed phone inference | Outcome |
| --- | --- | --- |
| Previous OSNet x0.25 non-AIN, batch 16 | 369.29 / 360.41 ms | PASS |
| New OSNet-AIN x0.25, batch 16 | **391.97 / 388.03 ms** | PASS |
| New OSNet-AIN x0.5, batch 1 | No valid result | **Process SIGKILL/exit 137** |
| Previous OSNet-AIN x1.0, batch 16 | No valid result on latest run | **Process SIGKILL/exit 137** |

**No x0.5 batch-16 test was attempted after its one-crop failure**.
Camera remained watching with unchanged PID, zero preroll drops and
minimum observed sensor FPS >=30.01 in the completed probes. Phone
reported `SwapTotal≈2.0GiB`, `SwapFree≈300MiB` after probes and
`MemAvailable≈2.3GiB`: **memory pressure is plausible but not
confirmed as the exact SIGKILL cause**. Do not retry a killed model
automatically or enable large-model inference in production.

AIN x0.25 is currently the only *new* AIN model with demonstrably
successful on-phone runtime compatibility under live camera load.
Successful runtime does not establish recognition quality.

### R749 anonymous source/crop provenance audit

Added `s9_reid_manifest_integrity_v749.py`. It only reads
existing research **JSON metadata** via ADB and produces anonymous
aggregate counts: no image/video decode, embedding comparison,
identity lookup, or People-folder assignment. CI-compatible
`--self-test` passed **5 synthetic integrity cases**, including
source leakage, model SHA mismatch, benign exact replay, and refusal of
mismatched overlap.

Actual on-phone research manifest results:
- **18** batch manifests, **99** plan rows, **98** distinct planned
  crops and **98** vector sidecars, matching the model hash and
  source/crop metadata exactly.
- One duplicate plan row: an **identical** first-crop replay
  `[0,1)` alongside the six-row `[0,6)` batch; not independent.
- **40 reference rows** from **39 distinct original source hashes**;
  **59 heldout rows** from **32 source hashes**. **0 source SHA
  overlap** between the reference and heldout groups.
- **5 reference rows fail the upright-crop-quality flag**;
  their height/width ratios range **0.14–1.06**, versus **1.31–3.19**
  for the 35 rows passing strict reference crop quality.
- **40 reference and 59 heldout rows** all have
  `original_source_frame_PTS_independently_verified=false`.
- **0 reference crops** currently satisfy **both** the strict upright
  crop-quality condition **and** independent frame-PTS attestation.
- Median of the existing 98 phone TFLite runtime sidecars is **93.83 ms**
  per crop (not a new AIN benchmark).

**Gate implication:** 0 source overlap in the existing gallery/holdout
is necessary but not sufficient: capture days, outfit episodes, exact
source-frame PTS, independent identity labels and unknown-person
false-accept rates remain unproven. Reject the five poor-quality
reference crops as calibration inputs. Do not silently promote the
source hash or SHA-exact crop alone into an independently timed or
identity-verified reference.

**Production invariant:** no new S9 service, no new recurring job or
ChatGPT Task, no Camera2 restart/reconfiguration, no altered original
recordings, no People-folder label changes, no auto-assignment activation.
The PR remains draft and must not be treated as a production recognition
deployment.


## R751 — phone-native read-only H.264 source PTS integrity, 20 November 2026

R751 validated a reproducible native 4K timestamp-inspection method
**on a previously recorded diagnostic video only**, without loading any
person-identified media, decoding images, comparing biometric embeddings,
creating labels, or changing originals.

- Source: existing native diagnostic MP4
  `diagnostic_preroll_1795047726878.mp4` from the S9+ removable card.
- Byte-size pin: **40,366,251**.
- On-phone SHA-256 verified:
  `04975e917bbb0671aef54e94e382141abd0f77fadb221f4122ef5e8bd1da9de2`.
- The new source-only Java class
  `S9DiagnosticPtsInspectorV751.java` was compiled with the Android
  API jar, converted to an independent 4.8 KB DEX/JAR and staged in
  `/data/local/tmp/s9_reid_r740/pts_r751.dex.jar`.
- JAR SHA-256:
  `04a297f99c076db907619a76b5ce8ad7f05c552d45400868e90d253666aa9b23`.
- Physical camera-admission guard R742 returned
  `PASS_OBSERVATION_ONLY`, stable sensor and preroll before execution.
- Physical on-phone `MediaExtractor` timestamp-only inspection returned
  **`SOURCE_PTS_TRACK_VERIFIED`** for the diagnostic source:
  - H.264 AVC, **3840 × 2160**, duration **8961 ms**.
  - **266** video samples; first PTS **0**, final PTS **8928.277 ms**.
  - Median positive interval **33.31 ms**, average **29.681 FPS**.
  - **0** nonmonotonic PTS, **1** interval >50ms.
  - No decoded frames, image crops, identities, or People-folder changes.
  - Camera process remained same PID, **7244**.

The inspector is deliberately pinned to the diagnostic clip and cannot be
used on arbitrary person recordings. This shows **the phone can inspect
original MP4 media timestamp tracks correctly**. It **does not** imply
that the actual frame-PTS of any of the 98 existing person crops is known;
all previously audited reference/heldout sidecars still have
`original_source_frame_PTS_independently_verified=false`.
No automatic folder filing or identity-release gate is changed.


### R744 follow-up: admitted single-input latency

A separate additional `nice -n 15`, single-thread S9+ synthetic
test using the new checksum-pinned OSNet-AIN x0.25 ONNX succeeded:
- **Batch 1**, warmup **21.38 ms**;
  two timed inferences **18.94 ms** / **18.75 ms**.
- Camera PID unchanged; minimum sampled sensor rate **30.01 FPS**.
- 29 new sensor frames, 14 new AVC preroll-encoded frames,
  **0** new preroll drops.
- Camera temperature after **31.5 C**, camera status eligible.
- No real crop read, no source-frame PTS attestation, no person
  classification or People-folder writes. This is **synthetic ONNX
  runtime latency**, not end-to-end capture/crop/quality/matcher timing.


### R749 additional independent geometry corroboration

The metadata-only audit now checks a conservative research-only
height-to-width candidate range **1.25–3.6**, *in addition* to the
preexisting `strict_upright_crop_quality` flag. This is only a
consistency check, not proof that a crop contains a complete person.
One newly added synthetic negative case deliberately marks an invalid
0.85-ratio crop as good and confirms the independent geometry rejects it.

- Synthetic tests: **6** pass.
- The existing **5** quality-failing reference rows are **exactly**
  the 5 reference rows excluded by the independent geometric range.
- **0** of the 59 holdout rows fail the independent geometry range.
- **0** quality flag vs independent geometry disagreements in this set.
- **0** reference crops become eligible with both geometry AND
  independently attested frame PTS (the missing-PTS blocker persists).
- No image processing, person identity evaluation or automatic assignment.


## R752 — S9-private vector integrity projection and R749 hardening

R749 originally parsed complete JSON sidecars on C720P; although it
never compared embeddings, that still transferred raw 512-D vectors
over ADB unnecessarily. This was corrected.

An isolated phone-native class `S9ResearchVectorMetadataV752.java`
now reads **only** the existing 98 research JSON sidecars in
`/data/local/tmp/s9-osnet-qualcomm-reid-shadow/vectors/` on the S9+.
It verifies that each source vector has exactly 512 finite components
and L2 norm within 0.03 of 1.0. Only whitelisted source/crop/model
metadata, boolean quality/PTS attestations and **the SHA-256 of the crop
filename** are returned. No raw vector floats or filename strings
leave the phone in this projection. No identity or folder matching.

The new R752 app_process DEX in the isolated research directory is
SHA-256
`2f52d881073cd612f2804e330d0ce17eb0f9fdfa761922a39b86f52d683586b0`.
Physical owner-authorized check:
- R742 live camera admission `PASS_OBSERVATION_ONLY`.
- **98** source vectors inspected on the handset;
  **0** invalid norm or dimension.
- **0** raw vector elements exported; **0** image/video decodes,
  **0** person labels examined, **0** People-folder assignments.
- Camera PID **7244** remained unchanged.

R749 host audit is now **required** to call the R752 phone-side
sanitized projector rather than `adb cat` on any vector sidecars.
Its revised synthetic tests pass **7** cases including model/hash
mismatch, overlap/source leakage and invalid phone vector norm.
The live anonymous audit still reports 98 sidecars, 40 reference rows
and 59 heldout rows, 5 reference rows failing the independent geometry
check and **all** 99 rows missing independently attested actual source
frame PTS. Automatic filing remains prohibited. The new on-phone norm
audit is numeric integrity, **not** proof of identity discrimination.


## R753–R757: physical decoder PTS → anonymous crop → phone OSNet-AIN, 2026-11-20

All activities below ran as isolated one-shot research actions. The
existing Camera2 APK, verified originals, manual People-folder references,
review decisions, online recognition and scheduled jobs remain unchanged.

### R753 diagnostic-only *decoded* PTS and in-memory pixel digest

- Reused the earlier physically grounded ROI-only
  `S9Original4KTimedDecoderV410.java`, now preserved as separate source in
  this draft PR. This obtains the **actual MediaCodec decoder OUTPUT**
  `BufferInfo.presentationTimeUs`, never a guessed seek time.
- `S9DiagnosticActualDecodedPtsV753.java` verifies both source file
  SHA-256 before and after decode, has a fixed owner-created **diagnostic
  recording only**, and hashes 128x256 ARGB pixel data without saving it.
- Physical S9 result for requested **2000 ms**: actual decoded PTS
  **2,031,822 µs**, ROI pixel SHA
  `2caef9a5ae1062ee2c1a02415938a7ae9f1dc729badc2516724770ad5e10d1ea`.
- Independent replay returned **exact same** timestamp and crop digest.
  A 4000 ms request yielded **4,030,788 µs** and a different pixel SHA.
- Live S9 camera PID **7244** stable; frame and AVC encoder counters
  advanced; no new preroll drops.
- Research APK/DEX staged separately; SHA:
  `9a4c938d0408fe622a7af458fa23b6f11a638b9433fce7bbba4caf9be361132e`.

### R754 strict replay contract

`r754_diagnostic_pts_replay.py` provides `--self-test` and an explicit
`--phone-verify` only. Pure Python tests reject **16 synthetic faults**:
source substitution, wrong nonce/provenance flags, requested timestamp
masquerading as physical PTS, wrong ROI, accidental People-folder writes,
mismatched replay and identical data from different seeks. The real
three-invocation S9 replay also **passed**, demonstrating unchanged
physical PTS and pixel SHA on duplicate seek. These are **diagnostic-only
claims**, not provenance for historical person crops.

### R755 source-bound physical PTS on a verified real original

`S9OriginalAnonymousPtsV755.java` decodes one tiny anonymous **center
scene region** of a source named `motion_[13digit epoch].mp4` ONLY when
the invocation provides the exact current owner-approved source SHA,
size, requested time and a per-job nonce. It rehashes the original
before/after decode, never saves a crop, and does not read person labels.

For one current **18 November 2026** original of **40,358,988 bytes**:
- The updated S9 standalone original catalog (**756** originals) and
  independent original-hash ledger both agreed on the same version; the
  model independently re-verified the original MP4 SHA on S9 twice.
- SHA `b362b8eca96f81456329940b0fa32d6f1afd164315b65dafa375dc4be6456a20`.
- Requested 2000 ms; actual decoded **2,009,033 µs**; ROI ARGB
  SHA `d49b7b7f217cd24a29e4fdb10e57cfdf888eabdd7f50ed8c1c2adad74c7fad45`.
- S9 recorder PID remained unchanged; sensor FPS ~30.02,
  0 new preroll drops.
- One-shot DEX SHA
  `b18f1df682ab9ce2d3cefad5e3dabe01562a37a5535936a136085694ada87286`.

### R756 independent-day anonymous original decoder replay

`r756_anonymous_original_pts_replay.py` checks the fresh standalone
source catalog, independent SHA ledger, fixed phone DEX digest, per-run
nonces and camera-admission health. **17** synthetic bad receipts are
rejected. One-shot physical inspection of two current verified
**17 and 18 November** originals returned:

- 17 November, 2000ms request: **2,020,111 µs** actual output PTS.
- 18 November, 2000ms request twice: **2,009,033 µs**, same pixel digest.
- 18 November, 4000ms request: **4,008,011 µs**, distinct pixel digest.
- **4** phone decodes, all source SHA revalidated before and after,
  no camera restart, ~30.01–30.02 FPS, zero new preroll drops.
- These two days are **source dates only**, NOT source-day-disjoint
  person identity labels or known/unknown recognition evaluation.

### R757 anonymous real video frame → normalized ONNX input → AIN x0.25

`S9AnonymousSourceToAinBenchV757.java` binds the actual V410 decoded
frame PTS, on-phone pixel SHA and ImageNet-normalized NCHW
float-input SHA to pinned on-phone OSNet-AIN x0.25 ONNX:
`e7adf72649332d97c613be93db17a047e526bf55fc8b7240f14a1da67390b7af`.
One ORT thread, `nice -n 15`, only batch-1, two passes,
no output vector contents transferred and no person matching.
No source media copied or changed; input is a **tiny center scene
sample**, not a quality-approved person crop.

Three actual phone runs completed:

| Date | ROI-only 4K decode | RGB preprocess + input SHA | Timed 512D ONNX output | Source ROI PTS |
| --- | ---: | ---: | ---: | ---: |
| 18 Nov | 585.69ms | 29.35ms | **19.30ms** | 2,009,033 µs |
| 18 Nov repeat | 535.23ms | 35.60ms | **14.76ms** | 2,009,033 µs |
| 17 Nov | 503.80ms | 28.51ms | **18.86ms** | 2,020,111 µs |

The November 18 repeat exactly matched BOTH the earlier pixel SHA
`d49b7b7f217cd24a29e4fdb10e57cfdf888eabdd7f50ed8c1c2adad74c7fad45`
and real normalized model-input SHA
`9f27509b6f9a81b6e50626cb9cd732a4a1c329c855701bea28a40c499bba80d6`.
November 17 yielded a **different** input hash, as expected.
Each run had a stable camera PID, verified source SHA on S9 before and
after decode, ~30 FPS, no new preroll drops and no folder assignments.
Research-only phone DEX SHA:
`c82f4dce5f47222efe69e60c45826559e9993812ff9ca3920c86cd11d1de187a`.

**Critical distinction:** This is verified *technical* image
provenance and phone runtime, NOT recognition accuracy. The 99 planned
reference/holdout rows from R749 remain **without independently verified
original-frame PTS**. The five quality-ineligible reference crops remain
excluded, unknown-person FAR is not calibrated, and **automatic People
filing is still OFF**. Moving from anonymous scene-ROI experiments to
trusted person-crop PTS requires binding the actual specific owner-approved
crop bytes to the physical decoded output frame in a separately verified
capture/review flow; existing sidecars must not be upgraded retroactively
by guessing timestamps. No gallery-builder or identity-label execution
was attempted or rerouted after its prior safety denial.


## R758/R759 independent recognition validation — 20 November 2026

This stage tests whether the actual historical person-ReID research
manifests could support a **scientifically independent recognition
accuracy or open-set false-accept claim**. It **does not** create
identity-labelled galleries, compare feature vectors, process person
identities, auto-assign folders, restart Camera2 or alter originals.

### R758 — Real SHA-bound capture-day split leakage

`r758_capture_day_leakage_audit.py` joins **only** existing role/source
metadata from 18 S9 batch manifests to the current standalone phone
catalog and independent on-phone SHA-verification ledger. It refuses
source/crop manifest version mismatches and produces anonymous counts
only, never names or SHA values in its report. Both UTC and
Europe/Amsterdam capture-date overlaps are checked from the original
filename epoch. Synthetic adversarial tests: **9 passed**.

**Actual audit outcome: `FAIL_CAPTURE_DAY_OR_SOURCE_DISJOINTNESS`.**

| Evidence | Measured |
| --- | ---: |
| Current recorded original files | **756** |
| Research distinct original source SHA-256 entries | **71** |
| Reference recordings | **39** from **17** distinct local dates |
| Holdout recordings | **32** from **8** distinct local dates |
| Reference/holdout identical original SHA overlap | **0** |
| Shared capture dates (UTC and local) | **5** |
| Holdout recording sources on shared dates | **26/32** |
| Holdout rows on shared dates | **50/59** |
| Holdout rows left on exclusive local dates | **9** |
| Exclusive-day holdout distinct original source bags | **6** |
| Exclusive-day holdout distinct dates | **3** |
| Research source hashes matching current catalog versions & ledger | **71/71** |
| Source SHA ledger byte checks older than 14 days | **64/71** |
| Within 14 days (from prior ledger, not per-crop PTS) | **7/71** |

Historical verification that remains tied to an unchanged catalog
version is valuable **metadata provenance**, but should NOT be
represented as a fresh byte-level hash check. R758 therefore
distinguishes `source_versions_verified_against_original_catalog_and_ledger`
from `all_source_SHA_rechecks_current=false`. It does not alter the
integrity ledger. The one repeated plan crop from R749 is accepted only
as an identical replay, never as an independent source/bag.

A conservative day filter therefore leaves **only 6 source bags**
across 3 days (9 crop rows). They are not identity-labelled known or
unknown evidence; no capture-day-independent recognition rate can be
computed from these counts. Outfit-episode disjointness also remains
unverified, and all R749 crops still lack exact physical source-frame PTS.

### R759 — Fail-closed independent release evidence compiler

`r759_release_readiness_from_provenance.py` aggregates the existing
R749 on-S9 vector-integrity projection, real R758 capture-day audit,
and the R743 open-set statistical release guard. No embeddings, image
bytes, original video or person labels leave S9; no identity scoring is
performed. Its adversarial tests reject **5** malformed/optimistic
inputs and verify that fixing source integrity **alone** cannot
authorize an identity release.

Actual result: **`RECOGNITION_RELEASE_BLOCKED`**, with **9 blockers**:
capture-day overlap, stale source SHA rechecks, five geometrically
invalid reference rows, 40 reference and 59 holdout rows without
independent physical source-frame PTS, absent independently known
person/outfit truth, absent independent unknown-person FAR, absence
of end-to-end completed native4K event-file proof under model load,
unproven prospective predeclared thresholds, and **model-version
mismatch** between old Market1501/TFLite vectors and candidate AIN.

Crucially, the **98** existing Market1501 TFLite research embeddings
have model SHA
`5249d33bb1cd53e53c9096db9d6acf555b698a7f4561a2b3eb81df4fcbfaac5c`,
while the NEW OSNet-AIN x0.25 ONNX model has SHA
`e7adf72649332d97c613be93db17a047e526bf55fc8b7240f14a1da67390b7af`.
The vectors are both 512D but **are not interchangeable models**,
and a comparison of those old vectors would not validate AIN x0.25.

The existing independent production-quality metrics still report
**1 correct out of 9 assessable source-separated historical
recordings (11.1%)**, **0 independently verified unknown-person
ground-truth labels**, no calibrated independent FAR, and automatic
People-folder filing authorization **false**. Do not relabel this as
a new AIN accuracy estimate.

The numerical release contract requires at least **100** genuinely
independent known bags representing **8** distinct known people,
**600** genuinely independent unknown-person bags, and conservative
confidence bounds. For *zero* unknown false accepts in 600 truly
independent bags, the one-sided 95% upper FAR limit is **0.00498**.
Actual independently known/unknown scored counts are **not known**;
do not substitute 32 source-separated retrospective recordings for
qualified unknown test labels.

### Six phone-side recent source SHA spot checks

To demonstrate cautious future retesting rather than assume old ledger
proofs are fresh, one-shot `nice -n 19 sha256sum` was run directly on
the S9+ against **all six** metadata-selected holdout originals whose
capture dates do not overlap reference dates. Each file was compared to
the current original catalog SHA with live Camera2 admission checked
before, during and after. **6/6 passed**, about **314 MB** total source
bytes read (never transferred to C720P), including **5** sources whose
prior ledger checks were >14 days old. The camera stayed near 30.02 FPS,
the AVC ring advanced, PID remained the same, and **zero new preroll
drops** were reported.

These were **read-only spot checks**, not a bulk rehash and not a
persistent update of the independent production SHA ledger. R758/R759
continue to accurately report 64 ledger entries older than 14 days.
Do not use these checks to claim person-identity accuracy, verified
historic crop PTS, outfit independence, or valid unknown FAR.

### R743 semantics correction

The optional `continuous_4k_ready` experimental encoder is not
mandatory: the normal 3840x2160 MediaRecorder + AVC preroll remains
the supported production capture path. R743 now requires
`native_4k_event_file_30fps_verified_under_model_load` rather than
misidentifying a deliberately disabled optional encoder as a failed
production camera. Physical 30FPS **sensor** rate and a healthy preroll
are not enough to assert independently measured 30FPS **completed
4K event file** output while inference runs. All **16** synthetic
R743 release-gate refusal tests pass.

**Deployment invariant:** Draft research branch only. No source
deletion, no refreshed person labels, no population of an identity
gallery, no automatic People-folder filing and no newly created timer
or ChatGPT scheduled task. This stage did not attempt to rerun or
circumvent the earlier safety-denied identity-gallery builder.


### R758 supplemental anonymous archive date-capacity scan

Without reading any images, names, labels, embedding values or individual
person descriptors, a metadata-only scan of the current original archive
counted **756** recordings from **37** distinct local capture dates.
The existing 39 research-reference sources occupy **17** dates; the
remaining **20** capture dates include **412** other original recordings
and **344** recordings occur on reference dates.

The 412 recordings are only *potential exploratory source capacity*;
they have NOT been screened for actually containing a person, correct
person-count/crop geometry, owner-verified known/unknown truth, prior
exposure to development/testing, clothing/outfit independence or
prospective threshold predeclaration. They must never be silently
promoted to independent prospective FAR or recognition-accuracy samples.
No source files were copied, added to a gallery, or identity-labelled.


## R760–R763: protected evaluation freeze, physical 4K event timing and complete S9 source rehash, 20 Nov 2026

### R760: immutable retrospective-vs-prospective boundary

`r760_freeze_blind_capture_cohort.py` (three synthetic checks passed)
froze an anonymous source-SHA **historical exploratory candidate set**
in the owner-only `0600` research file
`staging/recognition-r744-ain-small-model-assets-20261120/r760_anonymous_cohort_freeze.json`.
The file can only be created once; repeated `--verify` refuses an
incomplete, inconsistent or mutable replacement.

- Freeze UTC: **2026-11-20 00:52:15.959**, cutoff epoch ms
  **1795135935959**.
- Original catalog: **756** files. Prior research originals
  excluded: **71**, with a strict embargo on all 17 existing reference
  capture dates. Historical exploratory candidates: **406** across
  **19** remaining local dates.
- Candidate existing ledger ages *at freeze*: **263** checked within
  14 days, **143** older. (These are historical and are **not**
  independent known/unknown person identities or prospective trials.)
- Private freeze manifest SHA-256:
  `7a5d9952d97519c3de162bf23f106b0818bb92b56bad68a30c4d03fc8828ccea`.
- No person images, identities, pixel crops, embeddings, video bytes,
  manual links or People-folder assignments were touched.
- To become *prospective*, a new original source must be captured
  strictly **after** this time boundary, excluded from prior model
  development, source-verified and independently labelled. Nothing in
  the frozen historical pool is silently promoted.

### R761: on-S9 physical native-4K event sample timing

`S9OriginalNative4KEventTimingV761.java` reads ONLY source SHA and
`MediaExtractor`-provided encoded video sample PTS from a
SHA-revision-pinned **completed** 3840x2160 H.264 motion MP4.
It never decodes frames or reads image/identity data. The camera
process remains untouched. This is a separate on-phone research
`app_process`, not an APK install or new service.

Six most recent source-verified native 4K recordings were checked.
All had **0** nonmonotonic PTS and a **33.312ms** median sample interval.
Full-file average encoded FPS ranged **29.705–29.934 FPS**. However,
the initial sample-to-sample interval in *every* file ranged
**106.355–153.311ms**, always at video sample index **0**.
The original strict whole-event gap-free test therefore refused **6/6**.

A follow-up measurement explicitly separated first-ten-sample startup
from the steady portion (the startup gap is **not** erased or
misrepresented):
- **6/6** steady portions passed, with independently measured
  **30.015 FPS** across all six;
- **0** steady-state intervals >100ms;
- maximum steady-state interval **33.334–33.367ms**;
- **6/6** whole-file strict no-gap checks still **fail** due to the
  repeatable first-sample startup gap.
- All original checksums were verified on S9 before and after MP4
  metadata inspection. Camera live FPS stayed ~30.01–30.02, stable
  process PID, 0 new preroll drops.
- The 4K diagnostic capture control reports
  `preroll_diagnostic_used=true` in the current live CameraService
  instance. Resetting/restarting the live camera to permit another
  diagnostic capture was **not attempted**. This stage therefore does
  **NOT** prove a freshly completed 4K event file while AIN x0.25
  inference is concurrent with its actual camera capture.
- The recorder's repeatable 106–153ms *first-frame gap* remains a
  distinct timing defect requiring a future separately guarded
  camera/encoder-start investigation; the steady encoder rate is not
  the issue.

Source-only research Java SHA:
`c74f06e5aed665426a5c656602896496277cdf4bcf9dd3401a4d6c5f6761ebce`
for the final staged standalone DEX. No Camera2 APK changes.

### R762: COMPLETE research-source SHA currency refresh on the S9

`r762_reverify_reid_original_ledger.py` is a bounded one-shot
research-source-only extension to the **existing** independent
`s9-original-hash-ledger-v1.json` format. Before any write it
created an immutable `0600` backup of that **one changed file**:
`state/s9-original-hash-ledger-v1.json.before-r762-20261120`,
SHA prefix `4ad060e55347c9c1`.

The script shares the original hash-ledger writer's fcntl lock and
atomically updates only successful version/SHA checks, using bounded
batches of at most 8, nice-19 SHA computation **on S9**, phone-status
polling and instant capture-priority refusal. It copies **0** video
bytes to C720P, updates no user labels or People folders, and
never creates a recurring task.

Actual progression: **64/64** previously overdue research source
recordings were successfully rehashed, each matching its exact
catalog source digest; **0 mismatches**. The earlier **7** already
current sources remain verified. A final dry-run and independent R758
audit both confirmed:

- **71/71** source records SHA-verified within 14 days.
- **0** older-than-14-day source checks.
- Original catalog remains **756** current recordings, original
  media files unchanged.
- No camera restart, priority interruption, or increase in reported
  AVC preroll drop counters. Camera stayed ~30.02 FPS.
- Original ledger is backed up, original format preserved and
  private permissions retained.

This fully resolves the independent source-*byte* currency blocker
for the **existing 71-source research split**. It does **not**
verify the specific decoded-frame PTS of 99 historical crop plan
rows, independent person identities or outfit disjointness.

### R763: strict research-only quality mask

`r763_research_quality_selection.py` performs one-shot **metadata
only** selection with a conservative height:width range 1.25–3.6
AND the existing strict-upright quality flag, joining source hashes to
the newly current ledger and exact catalog version. Five synthetic
adversarial tests pass; no identities or vector scores processed.

Of the **98 unique existing research crop rows**:
- **39** distinct reference crops, of which **5** are excluded,
  leaving **34** reference crops and 34 original sources.
- 34 quality-eligible reference sources occur on **15** local dates.
- **59** geometry-eligible holdout crops, of which only **9** from
  **6 source recordings across 3 dates** are date-disjoint from
  all quality-eligible reference sources.
- Research-only selection SHA-256 commitment:
  `d7fff3cfecc0006055d3027559327ffb575d4e564b2bc388e2363a4dc112bbfa`.
- This is an eligibility mask, not a person-labelled identity gallery;
  excluded references remain preserved in original historical data.
- Selected historical crops **still have no independently attested
  decoded-frame PTS**. The prior batch manifest schema contains source
  hashes, crop hashes, size, role, ratio and track-id but NO original
  pixel bounding coordinates or physical decoder PTS. A source/crop
  timing relation cannot be retroactively invented from those fields.

R759 was extended to verify that R763 excludes all five bad
reference rows and reproduces R758's nine date-exclusive holdout
rows, and to verify that the R760 frozen set remains historical only.
The real post-R762 release evidence status is
**`RECOGNITION_RELEASE_BLOCKED` with 8 remaining blocks**:
capture-day overlap in the historic raw split; poor reference crop
quality still present in raw historic sources (but filtered from
research selection); missing actual frame PTS; missing independently
verified known/outfit truth; missing prospectively independent
unknown-person truth and FAR; no completed event 4K output under
concurrent model load; no independent predeclared threshold test;
and no real person-accuracy evaluation of the *new* AIN x0.25 model.

**Production unchanged:** automatic People-folder filing remains OFF;
the CI/test evidence is about provenance and model compute
compatibility only. The earlier owner-labelled identity gallery
builder denial was not rerun or circumvented.


### R765: physical on-S9 fail-closed quality gate before person matching

`S9PreMatchEvidenceGateV765.java` implements a **negative-only**
admission boundary for future person model inputs, based solely on
non-biometric evidence: current original/crop SHA+version, exact
MediaCodec output frame PTS, physical pixel ROI coordinates and
pixel/input provenance, 3840x2160 source geometry, candidate
OSNet-AIN x0.25 model SHA and 512-D output dimensions, strict
upright geometry, an independently verified single unambiguous person
crop, and detector confidence >=0.8. Its output **never** permits
automatic People-folder filing, even when research input metadata
passes. The runtime treats all unverified fields as reasons to abstain;
untrusted boolean attestations alone are not production proofs.

Pure Java synthetic self-tests **15/15 passed on the host AND on S9**.
Research-only phone DEX SHA
`84358cd7cd1ed7924c9a26fc8bab91a89f85ce8e2a658f015b8b1bbff04f0678`.

R757's source-verified real 4K ROI → actual decoder PTS →
normalized ONNX input → AIN x0.25 was **integrated with R765**
and rerun on S9 using one previously verified real original:
- Actual decoder PTS **2,009,033 µs**, source SHA verified twice on S9.
- Model produced a valid 512-D output, timed **20.31 ms**.
- The anonymous scene ROI had no independently verified person track,
  crop source-version attestation or person detector evidence;
  the pre-match check therefore correctly returned
  **`ABSTAIN_UNVERIFIED_SOURCE_OR_CROP`**, with 3 refusal reasons.
- `phone_prematch_person_scoring_authorized=false` and
  `phone_prematch_automatic_filing_authorized=false`.
- Camera unchanged PID **7244**, sensor **30.02 FPS**, zero new
  preroll drops; 0 biometric vector values exported, 0 person labels
  read and 0 People-folder assignments.
- Integrated standalone research DEX SHA
  `e44466245769546b9879c212241a3a6adb14c488a73d57a5f1f52e6e5ebaf412`.
- New standalone Java gate and R757 integration are source-compiled
  and synthetic-tested in existing GitHub CI; no new device service,
  timer, app installation or production matcher modification.

**This demonstrates enforced abstention, not identity recognition
accuracy.** No historical owner-verified person references had their
missing original source-frame PTS silently changed, and the
independent unknown FAR evidence remains absent.


## R766–R770: cross-day 4K start fault, phone-verified crop transcript and locked future open-set test — 20 November 2026

The live Camera2/MediaRecorder APK, source MP4s, People-folders,
human-verified labels, preexisting recognition worker coordinator and
scheduled tasks were **not modified** in this stage. All real video
metadata and 4K pixel model preprocessing ran on S9+; C720P only
joined small source-catalog/ledger metadata and compiled offline tests.

### R766/R767: reproduce the native4K startup PTS gap across capture dates

The R761 source-only H.264 `MediaExtractor` inspector was extended
to read and report only the first 8 encoded sample PTS, sample sizes,
sync flags and codec profile/level; this does not decode images or
export video contents. The new R767 guarded metadata-only repeat
runner verifies:
- exact current original SHA and catalog bytes, checked again **twice
  on S9+**, before and after extracting MP4 PTS metadata;
- immutable source-name digest and nonce;
- Camera2 watching, S9 recorder PID stable, >=~30 FPS and zero new
  AVC preroll drops before/after each individual check;
- first sample is a codec sync frame, all first eight timestamps
  strictly increasing, and any gap >100ms is **NOT** converted to a
  whole-file gap-free pass.
- synthetic tests: **9** malformed/suspicious receipts rejected.

Using 14 one-source-per-day verified archives from **3–19 November**:
- **14/14** sustained approximately **30 FPS in steady state**,
  with **zero interior sample intervals >100ms**;
- **12/14** exhibited a >100ms gap exclusively after their FIRST
  encoded video sample (different files' first gaps ranged
  **~110.3–184.4ms**);
- **2/14**, captured **3 and 10 November**, started without a gap,
  with first intervals **33.311ms** and **33.322ms**;
- All four physically inspected comparison clips (3, 10, 11, 19
  November) used the **same reported H.264 profile 8 / level 32768**,
  and each first frame carried the sync flag.
- First 8 PTS on a gap-containing Nov 19 event:
  `[0,127377,160688,194011,227322,260644,293955,327277]` µs.
- First 8 PTS on a gap-free Nov 10 event:
  `[0,33322,66633,99955,133266,166577,199900,233211]` µs.
- Some first keyframes differed in encoded byte size, but that does
  **not** prove a root cause or allow a safe live camera change.
- The staged CameraService source creates a fresh Camera2
  recorder surface and schedules a repeating capture request just
  before `MediaRecorder.start()`. This is a **plausible** startup
  transition source, NOT a proven causal explanation or an
  independently verified exact deployed binary revision.
- No risky Camera2 ordering or encoder initialization patch was
  installed while the only diagnostic capture control remained used.
  A new controlled A/B camera test would need a safe source
  opportunity. The user-facing goal is gap-free native event output,
  not merely masking the startup gap in aggregate FPS.

The reusable R767 source/phone contract is now included in the
existing CI, never in a new timer.

### R768: true source-PTS-ROI-to-normalized-model-input content commitment

`S9CropSourceProvenanceV768.java` implements domain-separated
SHA-256 over a *canonical versioned transcript* containing:
verified original source SHA and bytes, actual MediaCodec decoded
output PTS in microseconds, original 3840x2160 ROI XYXY pixel
coordinates, exact ARGB8888 pixel SHA, ImageNet-normalized 3x256x128
NCHW input tensor SHA, and candidate AIN x0.25 ONNX SHA. It is
**not a digital signature** or proof of device identity; the trusted
on-S9 caller must itself establish the actual source/PTS/input values.

- Host AND S9 Java synthetic tests: **7** changed-binding cases
  produce different commitments and **5** bad source/PTS/ROI hashes
  fail closed.
- This helper was integrated into R757's isolated
  original-SHA-verified actual MediaCodec 4K frame extraction and
  S9 OSNet-AIN x0.25 inference path; R765's pre-match quality gate
  still **abstains** because the anonymous center scene region has
  no independently proven person track/identity.
- Two separate REAL S9 runs of the same owner-authorized real
  original at requested 2000ms reproduced the exact decoded PTS
  **2,009,033µs**, pixel SHA, NCHW input SHA and
  `physical_source_to_input_transcript_sha256`:
  `841229fdc51a420a273ec7ccf119c6bb02308d3fc8205a1b72db7e55d8056437`.
- Timed model passes: **19.04ms**, **18.60ms**. Stable live
  recorder PID, **30.02FPS**, zero new preroll drops. No
  512-dimensional model vector contents exported, no identity
  comparison or folder assignment, no historical person crop
  retroactively promoted.
- Staged phone research DEX SHA:
  `edae41f2facc9745de65b7e60892ffb26f2efcce97b6b264f2e11207ea1496f6`.
- This is a tested **forward-only provenance component**, NOT proof
  the old R749 research crop files had corresponding verified
  original-frame PTS or that new untrusted source metadata is
  automatically identity-approved.

### R769: locked future evaluation method, before new person ground truth

`r769_predeclared_open_set_protocol.py` produces a `0600`,
exclusive-create immutable methodological freeze bound to the R760
cohort cutoff, candidate AIN x0.25 model SHA and R743's conservative
one-sided independent trial release targets. Private frozen path:
`staging/recognition-r744-ain-small-model-assets-20261120/r769_statistical_protocol_freeze.json`.
Commitment SHA:
`f9f8a840a8131e05d43d7ef9a2c0589f8c83ef1d740d7691dff132e6fa356d4b`.

The protocol prespecifies calibration on genuinely independent,
unknown-person **source/episode bags** using a conservative
conformal-like upper order statistic:
`ceil((n+1)*(1-0.005))` of sorted independent unknown
calibration best-match scores, with **strictly greater** decision
required to accept an unfamiliar candidate. At least **199**
truly independent unknown calibration episodes are needed even to
obtain a finite threshold at this alpha, subject to **exchangeability**
and truthful labels. Prospective **final test** samples cannot be
reused for threshold selection. R743 separately requires at least
**600** independent unknown final-test bags and **100** known bags
with **8** known persons and a strong known-accuracy confidence
bound; repeated frames/same episode do not multiply samples.
Synthetic threshold test passes **5** invalid/underpowered refusals.

**No real person unknown calibration dataset exists. No numeric
real-person decision threshold has been calibrated.** The frozen
method does not itself clear the prospective threshold-evidence
release blocker, and no auto People-folder filing is allowed.

### R770: future captured-original admissibility, no false prospectivity

`r770_prospective_original_intake_gate.py` distinguishes original
security MP4s whose filename timestamp is strictly after R760's
locked cutoff from all older archive sources. It additionally
requires current source catalog version/SHA, the independent
on-S9 integrity ledger, real 4K dimensions and a finished video,
and refuses reused earlier content hashes even when the new
catalog iteration order is reversed. Synthetic tests: **5** pass,
including missing current verification and future-dated spoofing.

Real archive audit: **756** historical source MP4s, **ZERO**
originals after the R760 freeze cutoff, **ZERO** independently
qualified prospective known/unknown trial bags. Nothing was
copied, decoded, relabelled or scheduled.

### Corrected filtered-selection readiness statement

R759 now consumes the **verified** R763 research crop mask and
accepts the fact that the new candidate *research selection*
does not reuse the five bad reference crops and does not contain
source/day collisions. The old raw manifest still has five bad
reference rows and five shared capture days; its history remains
untouched. The corrected independent readiness audit replaces
these two historical-selection-only blockers with the true
**underpowered independent-bag** blocker: just **6** distinct
disjoint original recording bags survive the quality/day mask.
R769 future method and R770 prospective original intake must both
verify before the readout is trusted.

Current independent release status: **`RECOGNITION_RELEASE_BLOCKED`**
with **7 remaining gates**: missing actual historical person-crop
source-frame PTS; insufficient truly independent evaluation bags;
no independent known-person/outfit truth; no independent unknown
ground truth/FAR; no completed native 4K event while AIN inference
is actually concurrent; a model-specific prospective threshold
not yet calibrated from independent truth; and no AIN x0.25
identity-accuracy assessment on genuinely independent person trials.

**No production automation, scheduled job, camera restart,
recognition identity gallery construction or source deletion.
No previously denied source-to-identity gallery operation was
repeated or worked around.**


### R771: matched physical-frame OSNet-AIN x0.25 versus x0.5 S9 execution cost

A narrow research-only extension to
`S9AnonymousSourceToAinBenchV757.java` supports an explicit
`--research-anonymous-source-x05` variant without altering the
production app or the original x0.25 default. Both on-S9 models
have exact pinned model file bytes/SHA-256 checks:

| Trained checkpoint architecture | ONNX bytes | On-phone SHA-256 |
| --- | ---: | --- |
| OSNet-AIN x0.25 | 900,103 | `e7adf72649332d97c613be93db17a047e526bf55fc8b7240f14a1da67390b7af` |
| OSNet-AIN x0.5 | 2,603,447 | `bc0e6c3819064b2c201716594ca83daad693fb5b8e8c0e4b41b2eeb7ebd99d27` |

**Physical comparison performed on S9**: two runs of each model
against the **exact same** 18 November SHA-backed original and
physical MediaCodec output frame PTS `2,009,033 µs`. All four runs
had identical exact ROI ARGB pixel SHA and normalized NCHW input
SHA, and model-specific R768 provenance transcript SHA commitments.

| Model | Timed inference #1 | Timed inference #2 |
| --- | ---: | ---: |
| x0.25 | **21.23ms** | **18.92ms** |
| x0.5 | **43.40ms** | **44.55ms** |

The larger model incurred ~**2.2x** latency in this bounded
single-crop CPU/ONNX test. Camera sensor kept **30.02FPS**,
original process PID unchanged, **zero new AVC preroll drops**,
and both variants correctly **abstained** from identity matching
via R765. No 512D output features exported, no crop files saved,
no identity labels or People folders read/written.

The larger architecture's potential accuracy gain is **unknown**:
there is no independently labelled, source/day/outfit-disjoint
test set for either new AIN model. The R769 calibration protocol
remains locked specifically to x0.25. The alternate model is
compatible for isolated research runtime only, never an
automatically promoted production candidate.

R771 two-model standalone DEX SHA
`0fa67e437b4826c4c417429540037dbdec55fb0b7feda2c8238c492eacc23aac`.
The existing CI now checks the alternate model SHA and explicit
command-line selection without adding a new workflow or timer.


## R772–R773: proven 10/15-FPS preroll bottleneck; default-off 30-FPS trial — 20 November 2026

### Source-verified real physical outputs and root-cause isolation

The independent camera currently has TWO distinct capture cadences:
- The primary **3840x2160 MediaRecorder event** file was directly
  inspected on S9 and has ~**30.015 FPS steady-state**, with a
  separate first-frame startup timestamp gap in many events.
- The accompanying **640x480 low-resolution in-RAM pre-event ring**
  is a separate hardware `MediaCodec` path. A new
  `S9PreRollCompanionTimingV772.java` worker (one-shot, separate,
  no camera source changes, double phone SHA of companion before/after)
  physically inspected seven existing companion MP4s from
  **17–19 November**:
  - **6/7** averaged **~9.98–10.00 FPS**;
  - latest **1/7** averaged **15.024 FPS**;
  - all were **640x480**, not native 4K.
  - The 10-FPS companions had expected ~100ms frame intervals,
    whereas the 15-FPS companion had a **66.567ms** median interval.
  - No frame or image bytes, labels, embeddings or originals were
    transferred/decoded/modified. Camera remained healthy.

An additional **live 4-interval sampling while night mode was ON**
showed independent Camera2 sensor FPS and YUV preview frame rate
both **~30 FPS**, but encoded preroll only **14.96–15.24 FPS**,
temperature ~**33.8°C**, and old `preroll_dropped_frames=0`.
The on-phone ring held ~105 YUV/H264 samples in ~7 seconds.

The exact current GitHub source `CameraService.java` used:
`lastFrameAt-preRollLastFrameAt>=44L` on the YUV preview frame
feed before enqueuing the preroll codec worker. At a 30-FPS preview
(33.3ms per frame), **the first subsequent frame fails this gate**,
so the maximum offered rate is one out of every two sensor frames,
or about **15 FPS**, even with an idle encoder.

Separately, existing source had a `!preRoll.busy()` condition
that silently discards encoder-busy opportunities without
incrementing `GardenPreRoll.dropped`. Thus a zero preroll dropped
counter previously did NOT mean no missing preroll frames. Older
~10FPS files may also reflect worker load or input cadence; the
specific cause of those individual clips was NOT independently
measured from historical runtime counters.

The current `GardenPreRoll.java` advertises a nominal
`MediaFormat.KEY_FRAME_RATE=24`, but observed sample PTS are
determined by actual admitted YUV frames. The 24 setting alone
does not raise a physically admitted 15-FPS feed.

### R773 draft, off-by-default, reversible change only

Two existing native Java source files were changed **on the draft
research branch only**. The installed S9 camera APK and persistent
settings were **NOT** modified:

1. `GardenPreRoll.java`: retain exactly the legacy no-argument
   constructor and 24-FPS codec setting by default. Add an
   explicit boolean constructor that configures a trial 30-FPS
   H264 codec rate ONLY on explicit opt-in.
2. `CameraService.java`: the new persisted preference key
   `preroll_30fps_trial_explicit` is **FALSE by default**.
   The existing **44ms** frame interval is retained unless this
   key is explicitly enabled and battery temp is **<40°C**;
   trial cadence is then **30ms** and reverts to 44ms at
   40–42°C, still subject to the unchanged upper 42°C
   source admission hard-stop. The worker remains non-blocking;
   no changes to Camera2 capture-session construction,
   MediaRecorder 3840x2160/30FPS/36Mbps, recording rate limits,
   event triggers, or microSD persistence.
3. **New transparent status metrics** are provided in the
   draft source: `preroll_encoder_configured_fps`,
   `preroll_camera_yuv_frames_seen`,
   `preroll_cadence_interval_skips`,
   `preroll_encoder_worker_busy_skips`,
   `preroll_offers_accepted`, `preroll_offers_rejected`
   and `preroll_observed_cached_fps`, with the trial flag
   visible separately. This avoids attributing intentional
   skips to an unreliable zero drop counter.

`r773_preroll_30fps_trial_contract.py` verifies by deterministic
synthetic 30-FPS timestamp replay: **legacy 44ms -> 15 offered FPS**,
the **explicit 30ms trial -> at most 30 offered FPS**, and
the **40°C fallback -> 15 offered FPS**. It checks worker-busy
skip accounting, 42°C hard stop, no encoder feed during
full-4K recording, the default-off config, and source-level
invariance of the production MediaRecorder settings. All synthetic
cases PASS; existing S9 CI compiles/tests the research patch.

**Release status: NO 30FPS PREROLL CLAIM.** The trial has
not been installed, exercised on the actual hardware encoder,
or validated with five completed verified MP4 events; higher
admission frequency might reveal encoder backpressure or affect
capture. A future rollback-safe installation and 4K event under
trial load remain conditional and should not be attempted just
to force a recording while the live camera is healthy.


### Directly paired native 4K versus preroll from the SAME motion events

Two November 19 source files, each paired with its own saved
preroll companion, were checksum-verified **twice on the phone per
file** and inspected during a live healthy 30.02FPS night session:

| Exact matched recording | Native 4K steady FPS | Native 4K first gap | Same-event 640×480 preroll FPS |
| --- | ---: | ---: | ---: |
| `motion_1795111776348.mp4` | **30.015** | 127.377ms | **15.024** |
| `motion_1795108992688.mp4` | **30.015** | 125.233ms | **9.996** |

These exact source/companion pairs demonstrate that the same
event can have a full-resolution 30-FPS recording alongside a
distinct 10- or 15-FPS pre-event companion. Neither companion
FPS value should be mistaken for the original 4K frame rate.

No 4K event was forced or overwritten. No on-phone model was run
during original video capture. The draft 30-FPS preroll trial
still has **not** been installed; tests only establish frame-offer
cadence capacity and safe defaults.


## R777–R782: exact-installed camera DEX preservation, signed off-device trial and rollback — 20 Nov 2026

The currently installed native camera APK was independently backed up with
byte-for-byte SHA-256 **9aca447ce5e3e34a2d8360f9c40d9c4631c130b7fdc50fda9aeac931e9ad77da**
and owner release certificate **0ca669482a7b5bc4698eae4ba43897b913177f87907418a8231b95e830675bb5**.
This backup is privately permission-0600 on C720P, NEVER in this GitHub PR.
Existing 4K original videos, identity folders, person labels and camera APK
source/signing secret were not uploaded.

### R777: unsafe full-source APK rebuild positively refused

All 23 GitHub camera Java sources were pinned by Git blob SHA-1 and
successfully compiled in an isolated offline workspace. The generated
Android DEX was compared with the exact installed binary.

| Structural check | Installed live APK | Java source rebuild |
| --- | ---: | ---: |
| Complete DEX class descriptors | **166** | **160** |
| Camera recovery fields | All installed | Missing **6** |
| Missing installed class descriptors | None | **11** |

Missing classes include `ContinuousAacRing`,
`EncoderProgressPolicy`, `GardenBaseTrackGate` and synthetic
lambda helpers. The experimental GitHub `CameraService.java`
also omits important original recovery fields
(`cameraOpenGeneration`, `cameraRecoveryGeneration`,
`cameraRecoveryQueued`, `cameraSessionGeneration`,
`continuous4KFence`, `retiring4K`).

The new `r779_installed_camera_abi_coverage_gate.py` independently
refuses such a camera APK replacement and runs synthetic fail-closed
tests in the **existing CI**. The original live APK was NEVER replaced
with the incomplete rebuild.

### R780–R781: full original bytecode round-trip and minimally changed trial

The official `baksmali/smali` **3.0.10** upstream release jars
were independently SHA-256 verified against the published Github
release asset checksums. The original installed APK's primary and
secondary DEX were disassembled into **all 166 original class
definitions**. Both were reassembled without altering source code:
R779 reported `CLASS_AND_RECOVERY_FIELD_PRESERVATION_PASS`,
with 166/166 classes, 0 duplicates and all six recovery fields.

An isolated **experimental** primary DEX changed just three
individual numeric literals relative to the unmodified reassembly:
- `CameraService` preroll producer frame-admission interval
  **44ms → 30ms**;
- `GardenPreRoll` MediaCodec H.264 declared frame-rate
  **24 → 30 FPS**;
- corresponding static nominal FPS **24 → 30**.

The assembled output was byte-compared to the unchanged assembly:
**exactly 3 changed DEX payload bytes**, plus DEX signature/Adler
checksum header bytes. The original secondary DEX, including its
continuous-4K recovery/audio ring classes, is **bit-for-bit
identical** to the installed version.

A locally signed research APK was created from the exact original
Android APK, with all non-DEX media libraries, model assets,
AndroidManifest and SDK/package metadata unchanged. The only ZIP
payload differences are primary DEX and regenerated APK signer
metadata. Signer verified to match exact production certificate,
with v2/v3 signatures passing Android verification. Local signed
trial SHA-256:
`ad864f5ee07d606363848f0bcd1a2bf736ff70821d7d037fde060c66b0505c33`.

**Important distinction**: this 3-byte surgical APK would change
preroll cadence every time it is installed; it does NOT have R773's
separate false-by-default pref or 40°C fallback. It is a bounded
hardware experiment, NOT the release-approved production candidate.

### R782: brief actual hardware run, partial result and manual VERIFIED rollback

A one-shot local script backed up the exact original, checked
camera `mode=watching`, real sensor ~30.02FPS and cool temperature,
then temporarily installed the matching-signer experimental 3-byte
APK and relaunched the camera. During the first four partial
observations the source recorder stayed **30.01–30.02FPS** and
~**32.7°C**, and old preroll reported **0 drops**.

Observed on-phone compressed preroll ring:
- **60** buffered frames across **2,303ms**;
- **101** buffered frames across **3,808ms**;
- **138** buffered frames across **5,109ms**;
- **187** buffered frames across **6,759ms**.

The last buffered span corresponds to **(187−1)/6.759 =
27.519 FPS**, significantly higher than the baseline ~15FPS,
but **below a proven sustained 30FPS target**. This short
partial measurement does not validate encoder backpressure,
steady event recording or a production rollout.

**Execution failure disclosed explicitly**: the script installed
a `signal.alarm(29)` watchdog without registering a Python
`SIGALRM` handler. The default handler **terminated the
test process (exit 142) after the fourth sample**, before the
`finally` rollback code could execute. The failure was a
test-script control error, not evidence that Camera2 itself
crashed. This is NOT described as successful automatic rollback.

The assistant immediately executed a **separate** original APK
reinstall, followed by CameraActivity launch, source SHA check
and independent healthy camera polling. Final status:
- installed APK SHA **exactly the pinned original**;
- `watching`, **30.02FPS** sensor, **night mode ON**, no
  capture failure, preroll ready, **0** preroll drops;
- restored pre-event encoder rate measured ~**14.03FPS**
  across a separate four-second post-restoration sample;
- original clip files and labels unchanged; no autonomous
  People-folder filing.

The script's watchdog behavior was corrected **locally in
staging** to register a Python exception-raising SIGALRM
handler and synthetic self-test. A private JSON incident
receipt `r782_transient_physical_preroll_trial.json`
preserves the four observed samples, manual restoration
and the failed test's limitations. **There has been NO
second live installation after this error**.

The experimental APK is NOT installed now. An opt-in safe
production patch still requires the exact deployed codebase,
hardware codec backpressure accounting, a reliable independent
rollback and completed 4K video event checks. The independent
person recognition R759 release gate remains blocked;
automatic person-folder filing is OFF.


### R783: lossless synthetic YUV buffer-copy optimization staged, no new live camera build

The current independent `GardenPreRoll.copyPlanes` repeatedly
wrote every output YUV pixel using a bounds-checked indexed
`ByteBuffer.put(index,value)` call. At 640×480 this incurs
over 300,000 separate Java-level Y-plane writes per candidate
preroll frame, potentially increasing `preRoll.busy()` skip
frequency at a 30-FPS sensor feed.

`GardenPreRollBulkCopyV783.java` implements a conservative
fast path for **strictly packed** source AND destination
pixel strides of 1: at most 480 direct row bulk copies for
a 640×480 Y-plane. It uses a duplicate destination buffer
so the source plane's original ByteBuffer position/limit
are unchanged. For padded or interleaved UV planes,
the original per-pixel addressing is preserved. The code
prechecks source and destination region bounds before
writing any pixels, and never reads user recordings.

- **Six** deterministic packed, padded and interleaved
  synthetic input-plane equivalence tests passed;
  **two** out-of-bounds refusals passed.
- On C720P host synthetic 40-frame Y-plane microbench,
  the new copy ran at **11.616ms vs 108.854ms** baseline
  (~9.37× speedup), and in an independent follow-up at
  **15.046ms vs 71.041ms** (~4.72×). These are total
  40-copy runtimes, not per-frame measured recordings.
- The helper was wired into the **draft source-only**
  `GardenPreRoll.java` path and registered in existing
  Android camera CI; the R773 trial contract also verifies
  the new helper call.
- An isolated synthetically generated phone DEX was
  prepared with SHA-256
  `5028ac90a12a745c810baf1bbe7bc9d29306f39849a60601993daf9b45c27ba9`.
  **No on-phone copy benchmark was run** because the
  independent capture-priority guard refused model/worker
  admission after camera app restart, rather than silently
  bypassing it.
- This synthetic result does NOT prove a physical
  30FPS saved preroll or a new native4K event under load.
  The production S9 APK is still the original verified
  SHA `9aca447ce5e3e34a…`.

### R784: distinguish post-APK-restart missing 4K diagnostic from capture failures

After verified restoration of the exact old camera APK,
`continuous_4k_last_result` returned `not_tested`
because the one-shot diagnostic state resets on a process
restart. The sensor and legacy AVC preroll were physically
healthy (~30.02 FPS, ~7sec buffered, zero reported drops).
However the R742 admission guard correctly refused the
research helper, since a freshly completed native 4K event
has NOT yet been verified in this process session.

R742 was narrowly updated to return the explicit reason
`post_restart_4k_event_diagnostic_not_yet_attested`
for this case, while **still returning
`REFUSE_MODEL_ADMISSION`**. Synthetic tests now pass 25
refusal/continuity cases; actual two-second read-only
observation confirmed 63 advancing sensor frames with this
single post-restart refusal. No heavy onphone research task,
Camera2 session or People-folder assignment was started.

This separates a normal diagnostic reset from a genuine
codec failure WITHOUT representing either as verified
native-4K under-model-load readiness.


## R785–R787: first completed post-restore 4K diagnostic attested on S9+, then bounded synthetic model load — 20 November 2026

### R785: normal original-APK one-shot native 4K + preroll

After the previous R782 experimental APK was **manually restored** and
the original package SHA-256 independently verified, the running
production camera process was `watching`, 30.02FPS sensor, ~7sec
preroll ready, 0 reported drops, ~33°C and had its explicitly
excluded `preroll_diagnostic` one-shot available. The
`record_once` camera control was invoked exactly **once**, not a
forced garden person/motion event. Its native Camera2
`MediaRecorder` path recorded for about **9 seconds**, finalized
the MP4, saved a separate AVC preroll companion, and resumed
`watching` at ~30.02FPS on the **same PID**, with 0 failed
recordings and 0 ordinary `recorded` events. Both files were
written only to S9+ microSD and their actual contents remained
on-device; no video was copied to GitHub/C720P.

Two separate narrowly scoped classes
`S9DiagnosticNative4KTimingV785.java` and
`S9DiagnosticPrerollTimingV785.java` attest **only**
`diagnostic_preroll_<epoch>.mp4` and its exact companion,
not arbitrary people-labelled surveillance recordings. Each
read-only S9 pass double-checks source SHA-256 and uses the
Android `MediaExtractor` encoded sample PTS; no image pixels,
frames, embeddings or person identity labels are read.

| Verified S9 sample output | Native 4K diagnostic | Separate preroll |
| --- | ---: | ---: |
| Width × height | **3840 × 2160** | **640 × 480** |
| File bytes | **40,275,493** | **1,058,259** |
| Encoded frames | **264** | **87** |
| Track duration | **8,940.433ms** | **5,874.111ms** |
| Full sample mean | **29.527FPS** | **14.820FPS** |
| 4K steady sample FPS after first 10 frames | **30.015FPS** | — |
| Median encoded frame step | **33.312ms** | **66.834ms** |
| First recorded interval | **178.277ms** | **66.855ms** |
| Samples with nonmonotonic PTS | **0** | **0** |
| Frame intervals >100ms | **1** | **1** |
| 4K steady interior >100ms intervals | **0** | — |

The native 4K result is therefore
`STEADY_NATIVE_4K_TIMING_PASS_WITH_STARTUP_GAP`, **NOT**
strict gap-free 30FPS. The physical **178.277ms first-interval
gap is still unresolved**; the separate ~15FPS pre-event AVC
path remains distinct. This direct event evidence is newer
and stronger than earlier status-only FPS checks.

Both diagnostic files are excluded from the normal archive
catalog, unknown/known person trial cohort, verified-person
reference gallery and any identity score calculation.
Their exact file names/checksums, pre- and post-camera
receipt, and full sample metadata stay privately in
`staging/recognition-r744-ain-small-model-assets-20261120/r785_native4k_post_restore_diagnostic/`
on C720P; only non-identifying aggregate results are here.

### R786: independent post-restart 4K baseline admission

`r786_post_restart_4k_diagnostic_attestation.py` independently
re-checks, **on the running S9+**, the previously SHA-backed
diagnostic video and preroll, exact pinned installed original
camera APK hash, original camera PID from a separate
pre-capture receipt, process ID unchanged, diagnostic filename
and result, source date freshness, and two advancing sensor/
preroll counter samples. **12 synthetic adversarial refusals
PASS**, including missing original PID, mislabeled future or
historical video, altered source digest or missing frames.
The method accepts only the explicitly excluded diagnostic
format; it **cannot** authorize known- or unknown-person
identity classification. A genuinely gap-free future
diagnostic also has a separate truthful passing branch;
a contradictory “strict gap-free” claim while the startup
gap is still present is rejected.

Physical on-phone result:
`PASS_COMPLETED_NATIVE_4K_CAPTURE_BASELINE_FOR_SYNTHETIC_ONLY`,
**118 new sensor frames** across observation, same camera
PID, no drops, exact deployed APK/file SHA rechecked.
The post-restart camera endpoint still reports
`continuous_4k_last_result=not_tested` (an optional
continuous-encoder diagnostic reset), so the original
status-only R742 probe **still refuses model admission**
absent this separate cryptographic source receipt.
Nothing was falsely treated as continuous-encoder readiness.

### R787: isolated synthetic-only ONNX model cost after fresh capture proof

After the independent R786 attestation, two short, lower-priority
Android `app_process` executions of the existing R740
**synthetic-only** probe were performed on S9 while the
full camera remained in `watching` mode, not while an
event was recording:

| On-S9 candidate | Timed ONNX model execution | Live sensor FPS |
| --- | --- | --- |
| OSNet-AIN x0.25 | **12.49ms, 13.55ms** | **30.02FPS** |
| OSNet-AIN x0.5 | **33.01ms, 32.96ms** | **30.01FPS** |

Each has 512-D output, but **zero actual person crops**
read, no source media decoded for inference, no model
embeddings exported, no identities predicted and no People
folder updates. Both showed **22** advancing sensor frames
across their respective bounded invocations, stable original
S9 camera PID, ~7sec ready pre-event buffer and **0 new
reported drops**.

**The R759 production release gate is still blocked on
all seven independent recognition requirements.** This
test demonstrates (a) completed real 4K after an APK
restore and (b) synthetic ONNX while camera preview/preroll
runs. It does NOT demonstrate (c) completed 4K recording
*while model inference is concurrently running* and does
NOT demonstrate cross-day/outfit/unknown-person recognition
accuracy. No new timers, recording deletions, user-labelled
identities or production camera APK changes were made.


## R788–R789: natural-event-only 4K+ONNX concurrency probe and on-device YUV-copy performance — 20 Nov 2026

### R788: do not manufacture a security event just to benchmark

`r788_natural_4k_model_overlap_once.py` now stages a bounded **one-shot** capture-priority probe, not a daemon or scheduled task. The C720P inspects only camera status and source SHA/PTS metadata, while the S9+ itself would perform all synthetic-only OSNet-AIN x0.25 inference at `nice -n 15`.

The real preflight accepts **only** a naturally occurring active
`mode=recording` session of the established 3840×2160 MediaRecorder
(not the inactive experimental continuous encoder). It fails closed
for low FPS, stale frames, changing PID, thermal or memory pressure,
SD limits, existing errors or drops. The model is forbidden to read
real crops, images or labels; its output receipt must explicitly
attest `real_crops_processed=0` and `auto_assignments=0`. To claim
actual **concurrent** capture, the SAME recording must remain active
before and after the model's phone-only inference, with new sensor
frames and stable recording counters.

A separate finished-file gate requires the recorder to return to
watching, exactly one new normal `motion_<epoch>.mp4` event to
complete without failures, the file SHA/size to be independently
verified on S9, and the existing R761 phone-only MediaExtractor
sample-timing inspector to verify encoded 3840×2160 footage at
~30FPS steady state, with any first-frame startup gap disclosed.
The two separate milestones -- synthetic ONNX overlapped an
active 4K recording and that exact original 4K event finalized --
must both hold. Neither step unlocks People-folder identity filing.

**29 synthetic fault cases passed**; the live immediate
`--live-once --wait-seconds 0` correctly returned
`NO_NATURAL_RECORDING_ACTIVE_NO_ACTION` at ~05:00 CET.
At that moment the S9+ was `watching`, 30.02FPS, ~7sec
preroll, 0 drops, no recordings or errors. **No inference ran
during a recording and NO concurrent recording proof exists
yet.** The tool did not create an event, install an APK, delete
a recording or set up a timer. Its synthetic case tests are
part of the preexisting GitHub CI.

### R789: real S9 CPU synthetic direct-buffer performance

Now that R786 attested a completed physical native-4K baseline
after APK restoration, the isolated R783 synthetic plane-copy
DEX was safely run directly with Android `app_process` on the
S9+, using **only generated byte arrays**, no camera samples,
images, videos, person labels, embeddings or storage writes.
Its on-phone SHA-pinned DEX
`5028ac90a12a745c810baf1bbe7bc9d29306f39849a60601993daf9b45c27ba9`
was uploaded to the isolated research sandbox, not installed in
the camera.

The full six-stride equivalence tests and two out-of-bounds
refusal cases passed. Actual ARM phone microbenchmark, 40
copies of a synthetic 640×480 packed YUV plane:
- legacy per-pixel `ByteBuffer.put(index, byte)` **108.761ms**
- bulk row `ByteBuffer.duplicate().put(byte[], offset, width)` **5.591ms**
- **19.45× synthetic-copy speedup**, approximately
  **2.72ms → 0.14ms per copied Y-plane**.

S9 stayed `watching`, 30.02FPS, 32.9°C, original camera
PID 31276, ready preroll and 0 new reported drops. This
is an actual **S9 CPU benchmark of a synthetic array**,
NOT a measured improvement to the installed APK or the
completed MP4 FPS. The lossless row-copy source is wired
only in the **draft** R773/R783 preroll implementation,
not installed into the production recorder.

**Release state unchanged:** seven independent R759 identity
and open-set gates are still blocking automatic People-folder
assignment. An unforced live event will be needed to test
R788's true capture-and-model overlap; no new scheduled
check or hidden identity process was created.


## R790–R791: synthetic on-S9 hubness correction + separate locked score-family calibration protocol — 20 November 2026

### R790: phone-native synthetic math; do not confuse with real-person accuracy

`S9SyntheticHubnessCalibrationV790.java` is an isolated
phone-compatible Java implementation for synthetic **512D** toy
vectors only. It computes:
- **CSLS** at k=3:
  `2*cos(query,template) - mean_top3_cos(query,all_templates) -
  mean_top3_cos(template,independent_background_queries)`;
- **per-template background z normalization**:
  `(cos(query,template)-mean_background_cos) /
  max(sd_background_cos,0.05)`;
- **per-query t normalization** as a score standardization,
  explicitly testing that it **cannot alter ranking** on
  its own (a shared positive affine transform);
- **reciprocal rank fusion**, offset 60, of the CSLS and
  template z-normalized rankings.

A deliberately contrived, unlabeled synthetic cohort has a
frequently matched hub at vector index 0 and a rarer reference
at index 1. Raw cosine ranks the hub first
(`0.759962 > 0.649967`), while CSLS, per-template z
normalization and their RRF rank the *rare toy reference*
first. This demonstrates the **mathematical ability** to
penalize hubness, not any measured camera/person accuracy.

The exact source passed eight synthetic refusal tests
(nonfinite/zero/dimension-mismatched vectors, identical
reference/background cohort vectors, invalid rank fusion).
The Java class was compiled to a standalone Android DEX
(SHA-256 `0fa575fa2cfe7105f0cea1f6aca47f4697ea9e7ae4b753d0493dc20b0c2e2b24`)
and independently executed on the **S9+** at low OS priority,
with the same pass result. The camera remained
**30.01FPS, original PID 31276, zero drops**.
No real embeddings, person folders, labels, videos, images,
gallery or production automatic matching were accessed.
The synthetic-only Java test is included in the existing
GitHub CI.

### R791: separate pre-frozen calibration arm; primary R769 stays immutable

A serious domain mismatch was caught before any promotion:
the original **R769** protocol is frozen to raw cosine
`scoring_metric=cosine_top1_normalized_feature_pair`, with
a score range **[-1,1]**. CSLS has a mathematical range
**[-4,4]**, per-template z-normalization with 0.05 SD
floor has range **[-40,40]**, and RRF yields
`(0, 2/61]`. A cosine threshold **cannot** be reused
for any new family, even if they sometimes agree on rank.

`r791_shadow_score_family_predeclaration.py` created an
**independent**, exclusive-create 0600 immutable methods
file on C720P, before any new post-R760-cutoff source
appeared in the SHA-backed anonymous archive. It records
three *separate shadow* score families, exact formulas,
numeric domains, the original R769 method SHA and model
SHA, and explicit source/person/day/outfit/cohort/test
disjointness requirements. The existing R769 method file
was **NOT** modified.

Original locked cosine-method SHA:
`f9f8a840a8131e05d43d7ef9a2c0589f8c83ef1d740d7691dff132e6fa356d4b`.

New separately frozen shadow-method SHA:
`e58b5e17cbb5ab1b32ad62e9b8ea53081cefbe5509f3731e7024add7c3612375`.

With three potential familywise unknown-person decisions,
the predeclaration conservatively uses **Bonferroni**
`alpha_per_branch=0.005/3`, requiring at least
**599 genuinely independent unknown calibration episode
bags** for a finite conformal-like upper threshold
per arm under exchangeability assumptions, versus the
original R769 single-cosine-method **199**. It additionally
forbids selecting the best method from the final holdout
without a separate preregistered independent selection
stage or proper multiplicity adjustment. The final
unknown-person test cohort requirements remain
independent and unfulfilled.

**10 synthetic invalid-score/underpowered-threshold
and method-mutation cases passed**. The synthetic self-test
was made portable to existing CI; real verification
checks both private frozen method digests and original
cohort SHA on owner C720P.

Neither method has a **real-person numeric rejection
threshold**, actual independent person ground truth, nor
permission for auto People-folder filing. The R759
recognition release remains **BLOCKED**. No scheduled
task, recording deletion or live S9 recorder change.


## R792–R794: physical 4K first-interval fault isolation and a necessary rank-fusion open-set correction — 20 November 2026

### R792: four independent double-SHA-verified 4K event sample timelines

Three preexisting original **3840×2160** S9 clips (Nov 18–19)
and the newly completed **Nov 20** 4K diagnostic clip
were re-inspected with separate, phone-only
`S9OriginalNative4KEventTimingV761` /
`S9DiagnosticNative4KTimingV785` `MediaExtractor`
operations. Every original was independently source-SHA
checked **before and after** reading the encoded sample PTS,
first eight sample flags and encoded dimensions; no video
frames, pixels, person identities or folder labels were decoded
or sent to C720P.

| Independent original day | First PTS interval | First sample is sync frame | Subsequent steady encoded FPS | Later >100ms gaps |
| --- | ---: | --- | ---: | ---: |
| Nov 18 | **176.522ms** | Yes | **30.015** | **0** |
| Nov 19 (A) | **125.233ms** | Yes | **30.015** | **0** |
| Nov 19 (B) | **127.377ms** | Yes | **30.015** | **0** |
| Nov 20 one-shot diagnostic | **178.277ms** | Yes | **30.015** | **0** |

All four original sources have distinct SHA digests and were
captured across **three** local calendar days. The maximum
PTS interval is at source video frame index **0** in all four
files; all first samples are H264 keyframes. The **median**
first gap is **151.9495ms**. All next six sample steps in
the first eight stay around the nominal **33.3ms**.
This repeatable sample pattern is a *starting encoded-stream
timing gap*; neither on-phone sensor frame loss nor a
specific MediaRecorder/Camera2 root cause has been proved.
The current 30-FPS steady state remains excellent.

The standalone `r792_native_4k_startup_gap_audit.py`
verifies strict filename, unique original SHA, 4K H.264
geometry, source double-hash, keyframe flag, first-eight
monotonic PTS, first-gap-only location, source-day
independence and steady 30-FPS interval consistency.
Its **17 adversarial synthetic refusal tests PASS** in the
existing CI. The private owner-only JSON receipt containing
real source SHA and initial sample PTS is mode 0600 on
C720P, not committed to GitHub. No recorder startup order
was changed blindly; production APK unchanged.

**Engineering decision:** until a tested alternative 4K
continuous encoder or source session is proved safe, do
NOT treat an assumed 4-5 "missing" sensor frames as
demonstrated actual frame drops, fabricate interpolated
frames, hide the strict-full-event failure, or reorder the
already-working MediaRecorder `start()` call under the
same working camera. New eventual capture tests should
report both start interval and steady-state frame timing.

### R793: rank-only reciprocal-rank fusion falsely gives maximum confidence to unknowns

A new `S9SyntheticRankFusionUnknownGuardV793.java`
test constructed **only synthetic 512D vectors**:
one well-matched known toy source and one completely
orthogonal unknown toy source. On the S9+ itself,
both CSLS+z ranking systems could agree on their
respective top candidate, so BOTH top **RRF** scores
were IDENTICALLY **0.032786885246 = 2/61**.

By contrast, the absolute scores were starkly different:
- Known toy query: CSLS **1.401653**,
  template z **10.192146**.
- Orthogonal unknown toy query: CSLS **0.0**,
  template z **0.0**.

Thus an RRF-only maximum score is inherently
unsuitable for open-set known/unknown acceptance; it
may rank the *least unsuitable* folder equally strongly
for a stranger. The synthetic test also checks that a
missing or nonfinite absolute threshold always causes
ABSTAIN. The S9 phone ran this entire test in a
sandbox `app_process`, low priority, with zero person
data, active camera ~30.02FPS and 0 drops.
No real-person accuracy or false-accept rate is claimed.

### R794: immutable addendum, not retrospective editing of locked R769/R791

The original R769 cosine protocol and R791 shadow
three-arm protocol were NOT edited or unfrozen.
`r794_shadow_rank_only_rejection_amendment.py` is
a **separately frozen** owner-private method, SHA
`d59b08fb88109ee5aa2069a016111eff96452215079176fd5a1877636c125581`,
which is cryptographically bound to:

- Original primary frozen R769:
  `f9f8a840a8131e05d43d7ef9a2c0589f8c83ef1d740d7691dff132e6fa356d4b`
- Original initial shadow R791:
  `e58b5e17cbb5ab1b32ad62e9b8ea53081cefbe5509f3731e7024add7c3612375`

It explicitly **supersedes the rank-only RRF score
as an acceptance statistic** while preserving RRF
only as a candidate ranking. For a future real
unknown-person trial, freeze reference and background
cohorts first; for each *independent unknown episode*,
select its RRF-best candidate, then calibrate the
**candidate-conditional absolute CSLS and z scores**
independently on disjoint unknown calibration episodes.
Only if **both absolute scores strictly exceed**
their separately calibrated thresholds *and* all source
provenance/release gates pass can a method ever be
considered for supervised release evaluation. Any
missing threshold, mixed source or nonfinite score =>
ABSTAIN. The original conservative predeclared
**599 independent unknown calibration episodes per
shadow arm** is retained, along with final independent
known/unknown sets and no final-test peeking.

The addendum's **12 synthetic negative tests pass**;
it was frozen before any post-cutoff new original
source appeared in the SHA-backed archive. All three
private method files are immutable, independently
SHA-verifiable, and their contents remain separate
from GitHub. No real unknown/known person labels
or independently calibrated numeric thresholds yet
exist. Production automatic People-folder filing
remains **OFF**.

R792, R793 and R794 compile/self-test in the
**existing** S9 research GitHub workflow, without
creating any new periodic job, camera APK, or identity
collection pipeline.
