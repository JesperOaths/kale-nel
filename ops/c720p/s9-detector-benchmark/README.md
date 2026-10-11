# S9+ isolated on-device detector benchmark

A separate app named nl.kalenel.s9benchmark compares the current SSD MobileNet v1 model against Google's official EfficientDet-Lite0 int8 model, CPU-only on the S9+. It reads existing native MP4s from removable microSD. No Camera2, cloud upload, identity matching or production app changes.

Up to 8 MP4 videos and 3 evenly spaced decoded frames per file. Both models see the same RGB frames. Guards require native camera watching (not recording), battery temperature below 37 C and 20 GiB SD reserve. No recording settings are modified. JSON is saved in the benchmark app-specific SD results folder. This app needs READ_EXTERNAL_STORAGE on Android 10; if file access is denied, report the limitation instead of bypassing sandbox restrictions.

Results include TFLite input/output signatures, model hashes, raw class-index-0 counts at confidence threshold 0.50, and CPU p50/p90 inference latency. Neither class-index-0 output nor model agreement proves ground-truth person detection. Independently annotate real daytime, nighttime, person and false-trigger frames before deciding to replace SSD. This app never auto-switches production detection.

On C720P, export S9_BENCHMARK_REF as the full immutable commit and run build-only.sh. It builds a separately signed APK, never installs it and never uses the production camera signing key. Only launch this separate package in a safe camera-idle window through its one-shot foreground service. Original MP4s are never modified or uploaded.


### Compatibility correction (10 October 2026)

The original MediaPipe int8 download exposed **two raw prediction tensors** and cannot be decoded as a post-processed four-output detector. The benchmark now uses a pinned TensorFlow Hub Lite0 model (SHA-256 `2e04c53bfeac0ac2a30c057c7e2a777594ce39baaac35a92f74fb1e8c4fc4e0b`) with 4 outputs. Its output tensor order is **reversed relative to SSD**: `StatefulPartitionedCall:3` boxes, `:2` classes, `:1` scores, `:0` count. The Java implementation now resolves output roles by exact names and checks shape/dtype before inference. The app writes results to the removable microSD or fails closed; no internal fallback directory. Benchmark install is still separate and was not authorized through the remote execution channel. An independent CPU comparison on the C720P is the fallback; hub latency is **not S9+ latency**.

### Shadow pipeline V2 — development and benchmark (11 October 2026)

**Separate Android application** `nl.kalenel.s9benchmark`, never changes the production camera package `nl.kalenel.s9security`. The optional benchmark launcher has `android.permission.DUMP` protection intended for ADB/shell-only use. Installing the separate app does **not** activate a second camera. Benchmark service reads existing 4K MP4 files, never opens Camera2 or starts MediaRecorder.

A CPU-only, deterministic `GardenShadowPipeline.java` runs independently on both detectors' person class bounding boxes on the *same decoded frames*. It computes a 24×14 luma grid, uses median garden exposure correction and adaptive per-cell noise, rejects connected motion exclusively outside the garden, and maintains up to six clip-scoped anonymous person tracks. A track requires three independent observations, at least two scores ≥0.62 within 5.2 seconds; weak candidates begin at 0.44; missing a person for up to 2.8 seconds is tolerated. No recognition of named people or linking across clips. The zone remains a fixed experimental foot-location boundary at normalized Y=0.64; it is **not** a calibrated polygon.

The temporal benchmark samples up to six existing native videos, 15 selected frames per video in three distinct windows, with a six-minute wall-clock ceiling and per-frame native-camera idle/temperature/free-space checks. The SSD and the pinned EfficientDet-Lite0 see exactly the same frames. Results on *S9+ microSD* include per-model inference median/p90, person candidate boxes, adaptive motion-positive frames, verified box-track confirmations, garden rejection, exposure suppression and per-frame model disagreement. No original video is modified. Inference is **CPU-only on the phone**; current production GPU throughput will not match these times.

**Critical accuracy limitation:** ground-truth person labels are explicitly absent (`ground_truth_person_labels=null`). Model agreement, fewer triggers or confidence scores alone do **not** demonstrate precision, recall, lower false-positive rate or better people capture. Before changing a live trigger, visually label a held-out set containing daytime people, dark scenes, garden foliage, shadows, rain and street traffic. Sampled frames, unlike a continuous 30 FPS stream, will miss short events. Device results are preliminary until recorded and compared to the labels.

Source unit tests:
```bash
P=ops/c720p/s9-detector-benchmark
javac -d /tmp/s9-shadow-tests "$P/src/nl/kalenel/s9benchmark/GardenShadowPipeline.java" "$P/tests/GardenShadowPipelineTest.java"
java -cp /tmp/s9-shadow-tests nl.kalenel.s9benchmark.GardenShadowPipelineTest
```

The original `build-only.sh` still only builds and signs the separate APK. Installation/launch, if performed, must leave `nl.kalenel.s9security` running and must avoid benchmarking while that service reports recording, temperature ≥37°C or SD free space under 20 GiB. The current camera source, configuration, microSD video and Home Assistant are not deployed or replaced by this branch.
