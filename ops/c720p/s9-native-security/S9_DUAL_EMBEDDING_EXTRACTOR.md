# S9+ dual person appearance features — offline extractor

This module populates exactly two model-output fields in an **isolated Python
analysis environment**, not in the running Android Camera2 app or C720P HA hub.

- `visual_embedding`: **512** L2-normalized float32 features from the entire
  person bounding-box crop via torchreid OSNet-x1.0 or a pretrained,
  appropriately projected timm ResNet50 (or an ONNX full-body model).
- `structural_crop_embedding`: L2-normalized features from a **different,
  explicitly supplied ONNX model**, applied to the top **25% of the original
  person crop**. Its length comes from that model's configured `vector_dim`;
  it is not necessarily 512.
- `bbox_xyxy`: clamped half-open absolute frame coordinates.
- `feature_schema` and `*_model_id`: version pins for incompatible embedding
  spaces. `appearance_only: true`, `verified_same_person: false`.

The structural crop is extracted **before** model-specific resize/normalization.
The first model never sees the upper-crop as a replacement for the full body,
and the second model never sees the full-body crop. This avoids accidentally
reusing a histogram, image crop, or embedding for both features.

## Example: pretrained OSNet + separate structural ONNX model

Place trusted, licensed model assets outside the Git repository. They are not
downloaded automatically, and must not be exported to public APIs.

```python
import importlib.util
from pathlib import Path

module_path=Path("ops/c720p/s9-native-security/s9_person_feature_extractor.py")
spec=importlib.util.spec_from_file_location("person_features",module_path)
features=importlib.util.module_from_spec(spec)
import sys
sys.modules[spec.name]=features
spec.loader.exec_module(features)

visual=features.load_osnet_visual(
    "/private/models/osnet_x1_0_pretrained.pth",device="cpu")
structural=features.ONNXEmbeddingBackend.from_file(
    "/private/models/upper_quarter_embedding.onnx",
    vector_dim=128,
    input_spec=features.InputSpec(width=128,height=128),
    providers=("CPUExecutionProvider",))
extractor=features.PersonFeatureExtractor(
    visual,structural,
    visual_model_id="osnet-x1-0:<pinned-weights-sha256>",
    structural_model_id="upper-quarter-onnx:<pinned-model-sha256>")

# frame_bgr must be an actual uint8 OpenCV BGR image; bbox is an already
# detected PERSON bounding box, in absolute XYXY coordinates (right/bottom
# exclusive, before clamping to the frame).
record=extractor.extract(frame_bgr,(x1,y1,x2,y2))
# For a consent-appropriate temporary observation: row.update(record)
```

Requires `numpy`, `opencv-python-headless`, `torch`, `torchreid`,
`onnxruntime` (and `timm` for ResNet50). Install compatible versions in an
isolated environment; do not install these Python packages directly into the
recording phone's Java/Android Camera2 process.

## Alternative pretrained ResNet50

```python
visual=features.load_resnet50_visual(
    "/private/models/resnet50_backbone.pth",
    "/private/models/trained_resnet50_projection_2048_to_512.npz",
    device="cpu")
```

For timm ResNet50, the globally pooled backbone normally returns **2048**
features. Supply a real *trained*, architecture/version-matched
`projection.npz` with `weight` shape `(512,2048)` and `bias` shape
`(512,)`. Randomly projecting, truncating or padding features does not
constitute a pretrained 512-D person descriptor. Factory methods only load
local PyTorch state dicts using `torch.load(...,weights_only=True)` and use
`np.load(...,allow_pickle=False)` for projection weights.

## Runtime and deployment boundaries

1. Models must be provided, checksummed, licensed and tested independently.
   The repository contains code and synthetic tests, **not** trained weights.
2. ONNX model input is one NCHW float32 tensor; expected dimensions, RGB
   channel order, mean/std and model output dimension are checked. Set
   `InputSpec` to the exact values used for the exported model.
3. The extractor returns dictionaries to its caller and does **not**
   automatically modify S9+ clip catalog JSON, SQLite tables, Google Drive
   files, the saved-person review decisions or the Home Assistant UI.
4. No cross-clip identity inference, face matching, private API submission,
   or person identification occurs in this module. Merely computing a
   descriptor is not evidence of a person's identity.
5. Only process lawfully collected and suitably consented footage in a
   controlled environment. Validate privacy, false matches, source provenance,
   lighting/occlusion and thermal/4K performance before considering any
   production/phone integration.

## Tests

`python ops/c720p/s9-native-security/test-s9-person-feature-extractor.py`

Synthetic tests cover original top-25% pixels, BGR→RGB, normalized vector
lengths, invalid/tiny boxes, ONNX input/output contracts, missing weights and
PyTorch inference where installed. The dedicated GitHub Actions workflow
runs without any camera, ONNX model files or biometric samples. Real-world
model quality is **not** established by passing these tests.
