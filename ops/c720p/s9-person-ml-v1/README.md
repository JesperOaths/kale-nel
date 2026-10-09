# S9+ GPU person recognition and C720P offload

Deployed on 2026-10-09. Source code: this directory. This is a **second Android package** (`nl.kalenel.s9person`) deliberately isolated from the existing video capture companion (`nl.kalenel.s9edge`) and the IP Webcam Pro camera.

## Neural inference

- TensorFlow Lite Android 2.14.0 with the native arm64 runtime and GPU delegate; model: Google's public COCO SSD MobileNet v1 quantized object detector (`coco_ssd_mobilenet_v1_1.0_quant_2018_06_29.zip`).
- Inference on the S9+ Mali GPU has been directly verified: ~18–36 ms per inference in startup and continuous samples, 0 model errors in the observed runs, phone temperature ~31–33°C. The Java code includes NNAPI and CPU fallback when GPU startup fails.
- Input is the **phone-local** IP Webcam `http://127.0.0.1:8080/shot.jpg`, not camera frames sent from the hub. Images are analyzed on-device. The HTTP API, bound to **phone loopback only**, returns detections and health as JSON on port `8799`.
- Class 0 is person (the original model label list begins with an extra `???` line). Confidence threshold 0.60 with consecutive-frame confirmation; the last event's sequence, age, and confidence survive transient frame changes.
- Temperature throttling/pause and safe no-trigger behavior on inference errors are implemented.
- GPU inference was tested live. **Precision/recall against labeled garden footage and a real walk-through remain to be established**; successful GPU inference alone does not prove zero false detections or adequate sensitivity.

## Phone-side recorder integration

The older `nl.kalenel.s9edge` recording companion (source `ops/c720p/s9-edge-v1/`) now runs `s9-ml-linked-v7`. It polls the person-model API on phone loopback (`127.0.0.1:8799`) for healthy, fresh **new person events**. It starts protected IP Webcam captures itself through its existing disk, SD, temperature, and rate-budget checks.

While person ML is healthy, the old S9 phone-side pixel-motion analysis sleeps to save resources. If ML is unavailable, the original geometric algorithm resumes (phone fallback). The existing IP Webcam app remains the hardware camera owner.

All captured source videos are kept on phone internal storage, and verified copies, SHA-256 manifests, and thumbnails are produced on S9 removable SD. Originals are not deleted. The 300 MB internal-source budget will stop new captures at capacity; address off-phone backup and verified cleanup **before** relaxing that limit.

## Hub-side offload

`install-hub-edge-offload.py` applies a feature mode `motion_mode=s9_ml_edge` to the live C720P camera service.

- It queries the locally ADB-forwarded ML endpoint `127.0.0.1:18799` and S9 recorder endpoint `127.0.0.1:18798` once per camera heartbeat, **without decoding JPEGs for motion detection**.
- It reports neural status in the existing hub API runtime, suppresses duplicate hub recordings, and delegates actual recording to the S9.
- It re-enables the hub's independent snapshot publication at an 8-second interval, preserving the Home Assistant/Security snapshot display. Existing saved clips, indexes, retention settings, and Drive reserve are not modified.
- If neural model or recorder becomes unhealthy, the previous hub software snapshot detector is available as an automatic runtime fallback.
- The installer makes timestamped copies of the Python camera service and JSON configuration, compiles the patched Python, restarts the service, checks health and snapshot freshness, and automatically restores the originals if the check fails.
- The ADB-bridge watchdog also maintains both forwarded ports at regular intervals.

### Verified live health after offload

- Camera API `camera_ok=true`, `last_motion_source=s9-gpu-ml-offload`, `s9_ml_backend=gpu`.
- ML and S9 Edge both reported healthy; Edge `geometry_fallback_active=false`.
- The six pre-existing C720P local MP4s remained present.
- Hub camera Python process CPU decreased from around **6.5%** in an earlier reading to **1.7%** in a post-change reading. These are observational samples, not a controlled CPU benchmark. The C720P as a whole remains heavily loaded and its root disk remains 97% used.

## Operations and rollback

On C720P:
```sh
systemctl --user status c720p-s9-edge-bridge.timer
curl -fsS http://127.0.0.1:18799/status
curl -fsS http://127.0.0.1:18798/status
curl -fsS http://127.0.0.1:8793/health.json
```

To undo the hub offload, restore the timestamped `camera-before-s9-gpu-*.py` and matching `config-before-s9-gpu-*.json` from `/home/jespern/c720p-security-camera-new/backups/`, then restart `c720p-frontyard-security-new.service` as the hub user. Do **not** delete any clips or edit retention/Drive reserves.

To pause automatic **S9** recording without uninstalling anything, disable the `pilot_recording` control for the `nl.kalenel.s9edge` activity. **Never uninstall the S9 Edge app before exporting the video files stored in its Android-owned SD directory; Android can erase app-specific files on uninstall.**

Outstanding work: labeled walk-by and night accuracy tests; alignment with confirmed-person Saved Clips and verified off-phone Drive archive; safe source cleanup to prevent the 300 MB phone-internal backlog from eventually blocking recordings.