# S9+ isolated on-device detector benchmark

A separate app named nl.kalenel.s9benchmark compares the current SSD MobileNet v1 model against Google's official EfficientDet-Lite0 int8 model, CPU-only on the S9+. It reads existing native MP4s from removable microSD. No Camera2, cloud upload, identity matching or production app changes.

Up to 8 MP4 videos and 3 evenly spaced decoded frames per file. Both models see the same RGB frames. Guards require native camera watching (not recording), battery temperature below 37 C and 20 GiB SD reserve. No recording settings are modified. JSON is saved in the benchmark app-specific SD results folder. This app needs READ_EXTERNAL_STORAGE on Android 10; if file access is denied, report the limitation instead of bypassing sandbox restrictions.

Results include TFLite input/output signatures, model hashes, raw class-index-0 counts at confidence threshold 0.50, and CPU p50/p90 inference latency. Neither class-index-0 output nor model agreement proves ground-truth person detection. Independently annotate real daytime, nighttime, person and false-trigger frames before deciding to replace SSD. This app never auto-switches production detection.

On C720P, export S9_BENCHMARK_REF as the full immutable commit and run build-only.sh. It builds a separately signed APK, never installs it and never uses the production camera signing key. Only launch this separate package in a safe camera-idle window through its one-shot foreground service. Original MP4s are never modified or uploaded.


### Compatibility correction (10 October 2026)

The original MediaPipe int8 download exposed **two raw prediction tensors** and cannot be decoded as a post-processed four-output detector. The benchmark now uses a pinned TensorFlow Hub Lite0 model (SHA-256 `2e04c53bfeac0ac2a30c057c7e2a777594ce39baaac35a92f74fb1e8c4fc4e0b`) with 4 outputs. Its output tensor order is **reversed relative to SSD**: `StatefulPartitionedCall:3` boxes, `:2` classes, `:1` scores, `:0` count. The Java implementation now resolves output roles by exact names and checks shape/dtype before inference. The app writes results to the removable microSD or fails closed; no internal fallback directory. Benchmark install is still separate and was not authorized through the remote execution channel. An independent CPU comparison on the C720P is the fallback; hub latency is **not S9+ latency**.
