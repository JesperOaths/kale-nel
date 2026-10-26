# C720P — Offline ONNX head/body feature backfill

This is a **private, local-image-only** feature preparation utility. It performs no S9 phone reads, production ranking changes, original-media attestation, journal writes, or automatic person matching.

## Model and preprocessing

Uses the existing PyTorch-exported model at `/home/jespern/c720p-home-hub/state/folder-reference-v2/visual_backbone_512d.onnx`, SHA-256 `ee5717ad7a90cf0c915afa1fb6a5399b966562c5d42aa6f4a0c6c84a5349e47d`. The model's original training checkpoint/dataset provenance is **not independently established**, so do not describe it as a verified pre-trained face-ID model.

The input is an RGB `1×3×256×128` float32 tensor with ImageNet channel normalization. The output is a 512-D feature vector, L2-normalized separately for the geometric head region and cached full-track image. Concatenation with equal squared contribution yields a 1024-D unit vector. Historical S9 thumbnails are not guaranteed to be the native tracking keyframe, and track crops do not establish identity.

## Runtime and offline procedure

On the C720P, Python 3.13:

```bash
python3 -m venv /home/jespern/c720p-home-hub/.venv-onnx
/home/jespern/c720p-home-hub/.venv-onnx/bin/python -m pip install -r ops/c720p/s9-native-security/requirements-offline-onnx-cpu-v1.txt
/home/jespern/c720p-home-hub/.venv-onnx/bin/python ops/c720p/s9-native-security/offline_onnx_head_body_v1.py --max-new 12
/home/jespern/c720p-home-hub/.venv-onnx/bin/python ops/c720p/s9-native-security/test-offline-onnx-head-body-v1.py -q
```

Repeat the bounded batch command until `complete=true`. The utility expects the previously verified private manifests, source feature index, and locally cached images under `/home/jespern/c720p-home-hub/`. It refuses changed model bytes or changed source revisions when resuming, and writes the output using an atomic 0600 file replacement.

**Recorded result on 2026-10-26:** 160/160 crop pairs (108 historical Drive + 52 local S9), no batch errors. Saved privately at `/home/jespern/c720p-home-hub/artifacts/offline-onnx-head-body-20261026/neural-fused-1024d-v1.json`, SHA-256 `91fd7e22eb6fa2e55abc65442045ec51bc52c7dac757dd065c5b0ce604b40203`.

## Explicit non-goals

Not deployed as the live `visual_embedding_cosine_v1` model. Not certified for identity recognition; 34 historical folder assignments have no decision-time gold media-binding receipts. Do not change review HMAC semantics from `original_opened` to `verified_preview_v1` or auto-file clips based solely on these vectors. Live authenticated S9 crop routing, all 49 candidate cards, and HMAC preview tickets are **outside this patch**.
