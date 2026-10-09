# S9+ isolated on-device detector benchmark

A separate app named nl.kalenel.s9benchmark compares the current SSD MobileNet v1 model against Google's official EfficientDet-Lite0 int8 model, CPU-only on the S9+. It reads existing native MP4s from removable microSD. No Camera2, cloud upload, identity matching or production app changes.

Up to 8 MP4 videos and 3 evenly spaced decoded frames per file. Both models see the same RGB frames. Guards require native camera watching (not recording), battery temperature below 37 C and 20 GiB SD reserve. No recording settings are modified. JSON is saved in the benchmark app-specific SD results folder. This app needs READ_EXTERNAL_STORAGE on Android 10; if file access is denied, report the limitation instead of bypassing sandbox restrictions.

Results include TFLite input/output signatures, model hashes, raw class-index-0 counts at confidence threshold 0.50, and CPU p50/p90 inference latency. Neither class-index-0 output nor model agreement proves ground-truth person detection. Independently annotate real daytime, nighttime, person and false-trigger frames before deciding to replace SSD. This app never auto-switches production detection.

On C720P, export S9_BENCHMARK_REF as the full immutable commit and run build-only.sh. It builds a separately signed APK, never installs it and never uses the production camera signing key. Only launch this separate package in a safe camera-idle window through its one-shot foreground service. Original MP4s are never modified or uploaded.
