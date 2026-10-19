"""Isolated person-appearance feature extraction; never establishes identity.

A detector supplies a person bounding box in absolute, half-open XYXY pixels.
The full box feeds an OSNet/ResNet50/ONNX 512-D visual model. The *original*
upper 25% of that box, before either resize, feeds a distinct ONNX model.
Model weights are explicit; this module does not download any weights, access
video archives, write metadata or activate automated surveillance decisions.

Optional runtime dependencies: torch, torchreid, timm, onnxruntime. NumPy and
OpenCV are required. This module is safe to import without the optional ones.
"""
from __future__ import annotations

from dataclasses import dataclass
import math
from pathlib import Path
from typing import Any, Protocol, Sequence

import cv2
import numpy as np

SCHEMA_VERSION = "s9_person_appearance_features_v1"
VISUAL_DIM = 512


@dataclass(frozen=True)
class InputSpec:
    width: int = 128
    height: int = 256
    mean: tuple[float, float, float] = (0.485, 0.456, 0.406)
    std: tuple[float, float, float] = (0.229, 0.224, 0.225)

    def __post_init__(self) -> None:
        if type(self.width) is not int or type(self.height) is not int:
            raise ValueError("Model image dimensions must be integers")
        if not 8 <= self.width <= 4096 or not 8 <= self.height <= 4096:
            raise ValueError("Model image dimensions outside supported range")
        if len(self.mean) != 3 or len(self.std) != 3:
            raise ValueError("RGB normalization must have three components")
        if not all(math.isfinite(v) for v in (*self.mean, *self.std)):
            raise ValueError("Nonfinite image normalization")
        if not all(v > 0 for v in self.std):
            raise ValueError("Zero or negative normalization standard deviation")


def preprocess_bgr(crop_bgr: np.ndarray, spec: InputSpec) -> np.ndarray:
    """Returns contiguous NCHW float32 RGB, normalized for the target model."""
    if (not isinstance(crop_bgr, np.ndarray)
            or crop_bgr.dtype != np.uint8 or crop_bgr.ndim != 3
            or crop_bgr.shape[2] != 3 or min(crop_bgr.shape[:2]) < 1):
        raise ValueError("Expected nonempty uint8 HWC BGR image")
    rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
    rgb = cv2.resize(rgb, (spec.width, spec.height),
                     interpolation=cv2.INTER_LINEAR)
    values = rgb.astype(np.float32) / np.float32(255.0)
    values = (values - np.asarray(spec.mean, dtype=np.float32)) / np.asarray(
        spec.std, dtype=np.float32)
    return np.ascontiguousarray(values.transpose(2, 0, 1)[None, ...])


def crop_person(frame_bgr: np.ndarray,
                bbox_xyxy: Sequence[float],
                min_height: int = 16,
                min_width: int = 16) -> tuple[np.ndarray, tuple[int, int, int, int]]:
    """Clips absolute half-open XYXY to frame; rejects empty/tiny detections."""
    if (not isinstance(frame_bgr, np.ndarray)
            or frame_bgr.ndim != 3 or frame_bgr.shape[2] != 3
            or frame_bgr.dtype != np.uint8
            or not frame_bgr.shape[0] or not frame_bgr.shape[1]):
        raise ValueError("Expected nonempty uint8 HWC BGR frame")
    if len(bbox_xyxy) != 4:
        raise ValueError("Bounding box must be four absolute XYXY numbers")
    try:
        x1, y1, x2, y2 = (float(v) for v in bbox_xyxy)
    except (ValueError, TypeError, OverflowError) as exc:
        raise ValueError("Invalid bounding-box coordinates") from exc
    if not all(math.isfinite(v) for v in (x1, y1, x2, y2)) or x2 <= x1 or y2 <= y1:
        raise ValueError("Nonfinite or inverted bounding box")
    height, width = frame_bgr.shape[:2]
    left = min(width, max(0, math.floor(x1)))
    top = min(height, max(0, math.floor(y1)))
    right = min(width, max(0, math.ceil(x2)))
    bottom = min(height, max(0, math.ceil(y2)))
    if right - left < min_width or bottom - top < min_height:
        raise ValueError("Bounding box outside image or too small for features")
    return frame_bgr[top:bottom, left:right].copy(), (left, top, right, bottom)


def upper_quarter(crop_bgr: np.ndarray) -> np.ndarray:
    """Crop top 25% of original person pixels BEFORE independent model resize."""
    if (not isinstance(crop_bgr, np.ndarray) or crop_bgr.ndim != 3
            or crop_bgr.shape[2] != 3 or crop_bgr.dtype != np.uint8
            or crop_bgr.shape[0] < 16 or crop_bgr.shape[1] < 16):
        raise ValueError("Original person crop is too small")
    stop = max(1, math.ceil(crop_bgr.shape[0] * 0.25))
    return crop_bgr[:stop, :, :].copy()


def _vector(output: Any, size: int) -> np.ndarray:
    values = np.asarray(output, dtype=np.float32)
    if values.ndim == 2 and values.shape[0] == 1:
        values = values[0]
    if values.ndim != 1 or values.shape != (size,):
        raise ValueError(f"Model produced {values.shape}, expected one {size}-D vector")
    if not np.all(np.isfinite(values)):
        raise ValueError("Model produced nonfinite embedding")
    norm = float(np.linalg.norm(values.astype(np.float64)))
    if not math.isfinite(norm) or norm < 1e-10:
        raise ValueError("Model produced a zero-length embedding")
    return np.ascontiguousarray(values / np.float32(norm))


class EmbeddingBackend(Protocol):
    vector_dim: int

    def encode(self, crop_bgr: np.ndarray) -> np.ndarray: ...


class ONNXEmbeddingBackend:
    """Single NCHW float32 input / single vector output ONNX model.

    The optional session argument is test injection only. Production uses
    from_file() with a local, explicitly supplied, trusted model artifact.
    """

    def __init__(self, session: Any, *, vector_dim: int,
                 input_spec: InputSpec = InputSpec(),
                 output_name: str | None = None):
        if type(vector_dim) is not int or not 1 <= vector_dim <= 4096:
            raise ValueError("Invalid ONNX embedding dimension")
        inputs = session.get_inputs()
        outputs = session.get_outputs()
        if len(inputs) != 1 or not outputs:
            raise ValueError("ONNX model must accept exactly one input")
        entry = inputs[0]
        if getattr(entry, "type", None) != "tensor(float)":
            raise ValueError("ONNX input must be float32")
        dims = getattr(entry, "shape", None)
        if not isinstance(dims, (list, tuple)) or len(dims) != 4:
            raise ValueError("ONNX input must be NCHW")
        for actual, expected in zip(dims, (1, 3, input_spec.height, input_spec.width)):
            if type(actual) is int and actual != expected:
                raise ValueError("ONNX shape does not match declared preprocessing")
        choices = {v.name for v in outputs}
        selected = output_name or outputs[0].name
        if selected not in choices:
            raise ValueError("Unknown ONNX output name")
        self.session = session
        self.input_name = entry.name
        self.output_name = selected
        self.input_spec = input_spec
        self.vector_dim = vector_dim

    @classmethod
    def from_file(cls, model_path: str | Path, *, vector_dim: int,
                  input_spec: InputSpec = InputSpec(),
                  providers: tuple[str, ...] = ("CPUExecutionProvider",),
                  output_name: str | None = None) -> "ONNXEmbeddingBackend":
        path = _existing_model(model_path, ".onnx")
        import onnxruntime as ort
        session = ort.InferenceSession(str(path), providers=list(providers))
        return cls(session, vector_dim=vector_dim, input_spec=input_spec,
                   output_name=output_name)

    def encode(self, crop_bgr: np.ndarray) -> np.ndarray:
        batch = preprocess_bgr(crop_bgr, self.input_spec)
        result = self.session.run([self.output_name], {self.input_name: batch})
        if len(result) != 1:
            raise ValueError("ONNX model returned unexpected outputs")
        return _vector(result[0], self.vector_dim)


class TorchEmbeddingBackend:
    """Preinitialized PyTorch model, not a classifier/logit output.

    Inference-only and bound to a single explicit device. Exactly vector_dim
    descriptors must be returned. The factory functions below load pretrained
    weights without arbitrary-code deserialization or an implicit download.
    """

    def __init__(self, model: Any, *, vector_dim: int = VISUAL_DIM,
                 input_spec: InputSpec = InputSpec(),
                 device: str = "cpu"):
        import torch
        if type(vector_dim) is not int or vector_dim <= 0:
            raise ValueError("Invalid torch embedding dimension")
        self.torch = torch
        self.model = model.to(device).eval()
        self.device = device
        self.vector_dim = vector_dim
        self.input_spec = input_spec

    def encode(self, crop_bgr: np.ndarray) -> np.ndarray:
        batch = preprocess_bgr(crop_bgr, self.input_spec)
        tensor = self.torch.from_numpy(batch).to(self.device)
        with self.torch.inference_mode():
            result = self.model(tensor)
        if isinstance(result, (tuple, list, dict)):
            raise ValueError("Torch model must return a single embedding tensor")
        return _vector(result.detach().cpu().numpy(), self.vector_dim)


def _existing_model(path: str | Path, suffix: str) -> Path:
    artifact = Path(path)
    if (artifact.is_symlink() or not artifact.is_file()
            or artifact.suffix.lower() != suffix):
        raise ValueError("Trusted local model file required: " + suffix)
    return artifact


def _load_state_dict(model: Any, path: str | Path) -> None:
    """Safe tensor-only checkpoint; refuse mostly unmatched/nonpretrained nets."""
    import torch
    artifact = _existing_model(path, ".pth")
    saved = torch.load(str(artifact), map_location="cpu", weights_only=True)
    if isinstance(saved, dict) and isinstance(saved.get("state_dict"), dict):
        saved = saved["state_dict"]
    if not isinstance(saved, dict):
        raise ValueError("Expected a tensor-only model state_dict")
    expected = model.state_dict()
    compatible = {}
    for raw_name, weights in saved.items():
        if not isinstance(raw_name, str):
            continue
        name = raw_name.removeprefix("module.")
        if (name in expected and isinstance(weights, torch.Tensor)
                and weights.shape == expected[name].shape):
            compatible[name] = weights
    non_head = [name for name in expected if not name.startswith(("classifier.", "fc."))]
    matched = sum(name in compatible for name in non_head)
    if not non_head or matched < math.ceil(len(non_head) * 0.9):
        raise ValueError("Checkpoint does not contain the pretrained backbone")
    model.load_state_dict(compatible, strict=False)


def load_osnet_visual(weights_path: str | Path, *,
                      device: str = "cpu") -> TorchEmbeddingBackend:
    """torchreid OSNet x1.0 yields a native 512-D eval descriptor."""
    import torchreid
    model = torchreid.models.build_model(
        name="osnet_x1_0", num_classes=1, loss="softmax",
        pretrained=False, use_gpu=device.startswith("cuda"))
    _load_state_dict(model, weights_path)
    return TorchEmbeddingBackend(model, vector_dim=VISUAL_DIM,
                                 input_spec=InputSpec(128, 256), device=device)


def load_resnet50_visual(backbone_weights: str | Path,
                         trained_projection_npz: str | Path, *,
                         device: str = "cpu") -> TorchEmbeddingBackend:
    """timm pretrained ResNet50 (2048) + *trained* 2048->512 projection.

    A vanilla ResNet50 has 2048 pooled features, NOT 512. Reject absent/random
    projection weights rather than silently slicing or mislabeling features.
    The supplied projection must have been trained against THIS backbone.
    """
    import timm
    import torch
    model = timm.create_model("resnet50", pretrained=False,
                              num_classes=0, global_pool="avg")
    if getattr(model, "num_features", None) != 2048:
        raise ValueError("Expected 2048 pooled ResNet50 features")
    _load_state_dict(model, backbone_weights)
    projection_path = _existing_model(trained_projection_npz, ".npz")
    with np.load(projection_path, allow_pickle=False) as saved:
        weight = np.asarray(saved["weight"], dtype=np.float32)
        bias = np.asarray(saved["bias"], dtype=np.float32)
    if weight.shape != (VISUAL_DIM, 2048) or bias.shape != (VISUAL_DIM,):
        raise ValueError("Expected trained 512x2048 weight and 512 bias")
    if not np.all(np.isfinite(weight)) or not np.all(np.isfinite(bias)):
        raise ValueError("Projection weights are not finite")
    if float(np.linalg.norm(weight)) < 1e-10:
        raise ValueError("Unusable projection weights")
    projection = torch.nn.Linear(2048, VISUAL_DIM, bias=True)
    with torch.no_grad():
        projection.weight.copy_(torch.from_numpy(weight))
        projection.bias.copy_(torch.from_numpy(bias))
    combined = torch.nn.Sequential(model, projection)
    return TorchEmbeddingBackend(combined, vector_dim=VISUAL_DIM,
                                 input_spec=InputSpec(128, 256), device=device)


class PersonFeatureExtractor:
    """Produce two *appearance* fields from distinct original pixel crops.

    No tracking or identity decisions, similarity thresholds or persistence.
    The caller must only process clips with an appropriate privacy basis.
    """

    def __init__(self, visual: EmbeddingBackend, structural: EmbeddingBackend,
                 *, visual_model_id: str, structural_model_id: str):
        if visual.vector_dim != VISUAL_DIM:
            raise ValueError("Full-crop visual model must return 512 dimensions")
        if not 1 <= structural.vector_dim <= 4096:
            raise ValueError("Structural model dimension is invalid")
        if not visual_model_id.strip() or not structural_model_id.strip():
            raise ValueError("Supply immutable versioned model identifiers")
        self.visual = visual
        self.structural = structural
        self.visual_model_id = visual_model_id
        self.structural_model_id = structural_model_id

    def extract(self, frame_bgr: np.ndarray,
                bbox_xyxy: Sequence[float]) -> dict[str, Any]:
        full, rect = crop_person(frame_bgr, bbox_xyxy)
        head_and_shoulders = upper_quarter(full)
        visual_embedding = _vector(self.visual.encode(full), VISUAL_DIM)
        structural_crop_embedding = _vector(
            self.structural.encode(head_and_shoulders), self.structural.vector_dim)
        return {
            "visual_embedding": visual_embedding.tolist(),
            "structural_crop_embedding": structural_crop_embedding.tolist(),
            "bbox_xyxy": list(rect),
            "feature_schema": SCHEMA_VERSION,
            "visual_model_id": self.visual_model_id,
            "structural_model_id": self.structural_model_id,
            "appearance_only": True,
            "verified_same_person": False,
        }
