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
