# S9+ shadow detector V2 — first on-phone A/B result

**11 October 2026; execution completed at 06:17:54 UTC, C720P agent job 10072, exit code 0, first attempt.**

## Deployment isolation

- Built an **independently signed** APK for package `nl.kalenel.s9benchmark` (11,125,406 bytes; SHA-256 `e942aa2f883d29f980769176ff169d75dc01d40ddc3397618bf084c92df361cb`).
- Benchmark app installation: success. No pre-existing benchmark package.
- Actual S9+ production native app `nl.kalenel.s9security` **was not updated**; its installed APK path before and after the benchmark was identical.
- Preflight native camera: `ok=true`, `mode=watching`, temperature **33.3°C**, microSD free **79,608,545,280 bytes**. After benchmark native mode remained **watching** and phone temperature was **34.5°C**.
- Both CPU models verified on C720P: SSD TFLite SHA-256 `e4b118e5e4531945de2e659742c7c590f7536f8d0ed26d135abcfe83b4779d13`; EfficientDet-Lite0 SHA-256 `2e04c53bfeac0ac2a30c057c7e2a777594ce39baaac35a92f74fb1e8c4fc4e0b`.
- Build source pinned at `786546fc5c846a957eadb7b2dd57a7f0a9726ef0`. All subsequent code changes in this PR are benchmark score/report documentation, regression tests and retirement of one-off release workflow.

## Measured results on S9+ CPU

| Metric | Baseline SSD MobileNet | Candidate EfficientDet-Lite0 |
| --- | ---: | ---: |
| CPU-only inference median | **147 ms** | **172 ms** |
| CPU-only inference p90 | **189 ms** | **233 ms** |
| Confirmed temporal person-track events | **0** | **0** |

- **54 paired frames**, **4 original microSD MP4 clips** sampled.
- **0 track-level disagreement frames**. This does **not** establish that both models were correct.
- Six-minute **time budget reached during clip 4**, so the target six-clip corpus was not exhausted.
- An automatically guarded standalone benchmark, not an active real-time pipeline deployment. No camera FPS improvement claimed.
- No human-ground-truth person-positive or negative labels. Precision, recall, missed-person rate, day/night quality and false-positive rate are **not measurable** from this run.
- Inference latency excludes 4K MP4 decode and preprocessing; results are **not an end-to-end camera FPS benchmark**.
- The report remains on S9+ microSD at:
  `/storage/9C33-6BBD/Android/data/nl.kalenel.s9benchmark/files/bench-results/compare-1791699468509.json`.
  It contains sampled per-frame detector metrics and motion/tracking records. No video was copied off the phone for this run.

## Interpretation and next gate

On the tested sampled frames, **SSD is faster**: 147 vs 172 ms median and 189 vs 233 ms p90. Neither model confirmed a temporal person event, so this run cannot identify a better *person detector*. Do not cut over the current camera. Neither a zero-event model agreement nor the absence of a face proves the clips lack people.

Before production cutover, compare a held-out manually labeled set from real garden events and non-triggered intervals, including bright sun, dusk, full darkness, rain, foliage, bikes and street traffic. Sampled-frame shadow tests do not establish 30 FPS streaming behavior, GPU delegate performance, continuous motion precision or camera recording reliability. Retain old APK and a live rollback path.

## CI and security

The independent Java garden-motion tracker tests passed; both Android benchmark compilation workflows passed. Manifest requests no CAMERA permission and protects exported benchmark service launch with `android.permission.DUMP`. The management-authenticated C720P one-shot request and the temporary GitHub dispatcher were retired after the test. Do not infer device access remains available from a saved command.

**Status:** Step 2 has a built and phone-tested **candidate**. Comparative model accuracy is inconclusive and production detection remains unchanged.
