#!/usr/bin/env python3
"""R744: strict OSNet-AIN multi-source ReID weight verification / ONNX export.

--verify-only runs with Python standard library and NEVER unpickles any asset.
--export runs on a separately provisioned trusted CPU build host with
PyTorch/Torchreid/ONNX/ONNXRuntime, and performs *synthetic* equivalence checks.
No real camera images, person recognition, labels or device writes.

Model cards claim person-ReID training for OSNet-AIN x0.25 and x0.5.
Training provenance is externally asserted; this script verifies model bytes,
strict backbone key/shape compatibility and PyTorch-to-ONNX numerical agreement,
NOT recognition accuracy.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile
import zipfile

MODELS = {
    "osnet_ain_x0_25": {
        "name": "osnet_ain_x0_25.pt",
        "sha256": "ce171fe160b3608f5e4c19489774991419be965b1d6f4bdccc4b4cfd2ef95347",
        "min_bytes": 850_000,
        "max_bytes": 1_200_000,
    },
    "osnet_ain_x0_5": {
        "name": "osnet_ain_x0_5.pt",
        "sha256": "510bcebae21bd0c0fcc7df388e97d2f687a9ee4befa4394d6fb1fb19aac0bce2",
        "min_bytes": 2_500_000,
        "max_bytes": 3_200_000,
    },
}
SOURCE = "https://huggingface.co/LibreYOLO/LibreReID-osnet"
UPSTREAM_ARCHITECTURE_SHA256 = "a43b495866a4b1645cd134a30c3011592e8c6826ba4781955a135588cf46cd25"
UPSTREAM_ARCHITECTURE_URL = "https://raw.githubusercontent.com/KaiyangZhou/deep-person-reid/master/torchreid/models/osnet_ain.py"
SIZE = (1, 3, 256, 128)
FEATURES = 512

def require(ok, message):
    if not ok:
        raise ValueError(message)

def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as inp:
        for data in iter(lambda: inp.read(65536), b""):
            h.update(data)
    return h.hexdigest()

def validate_source(model_name, location):
    spec = MODELS[model_name]
    source = location / spec["name"]
    require(location.is_dir() and not location.is_symlink(),
            "Missing regular trusted weight directory")
    require(source.is_file() and not source.is_symlink(),
            "Missing pinned regular weight file")
    length = source.stat().st_size
    require(spec["min_bytes"] <= length <= spec["max_bytes"],
            "Unrecognized weight blob size")
    require(sha(source) == spec["sha256"],
            "OSNet-AIN checkpoint SHA-256 mismatch")
    require(zipfile.is_zipfile(source), "Expected PyTorch ZIP state dict")
    with zipfile.ZipFile(source) as archive:
        items = archive.infolist()
        require(len(items) >= 300 and len(items) < 1400,
                "Unexpected checkpoint entry count")
        require(not any(i.filename.startswith("/") or ".." in
            Path(i.filename).parts for i in items),
                "Unsafe archive paths")
        require(sum(i.filename.endswith("/data.pkl") for i in items)==1,
                "Missing unique PyTorch state-dict descriptor")
        tensor_files = [i for i in items if "/data/" in i.filename]
        require(500 <= len(tensor_files) <= 650,
                "Unexpected number of tensor storage records")
        require(all(not i.flag_bits & 1 for i in items),
                "Encrypted zip entries forbidden")
        # zipfile testzip reads all tensor bytes but does not unpickle them.
        require(archive.testzip() is None, "Checkpoint CRC verification failed")
    return {"architecture": model_name,
            "source": SOURCE,
            "weights_sha256": spec["sha256"],
            "weights_bytes": length,
            "zip_tensor_records": len(tensor_files),
            "unpickled": False}

def safe_tensor_state(torch, path):
    # IMPORTANT: NEVER pass weights_only=False or evaluate arbitrary pickle.
    state = torch.load(str(path), map_location="cpu", weights_only=True)
    if type(state) is dict and type(state.get("state_dict")) is dict:
        state = state["state_dict"]
    require(isinstance(state, dict) and len(state) >= 400,
            "Unrecognized tensor state dict")
    require(all(type(k) is str and isinstance(v, torch.Tensor)
                for k,v in state.items()), "Checkpoint contains non-tensor objects")
    result = {}
    for key, value in state.items():
        clean = key[7:] if key.startswith("module.") else key
        require(clean not in result and clean and
                not clean.startswith("classifier.") and not
                clean.startswith("classifier"), "Duplicate/stray classifier tensor")
        require(torch.isfinite(value.to(dtype=torch.float32)).all().item(),
                "Nonfinite pretrained weight")
        result[clean] = value
    return result

def export(model_name, location, output, architecture_source):
    meta = validate_source(model_name, location)
    import importlib.util
    import numpy as np
    import onnx
    import onnxruntime as ort
    import torch

    require(architecture_source is not None and architecture_source.is_file()
            and not architecture_source.is_symlink(), "Pinned architecture source missing")
    require(sha(architecture_source) == UPSTREAM_ARCHITECTURE_SHA256,
            "Upstream OSNet-AIN source SHA-256 mismatch")
    module_spec = importlib.util.spec_from_file_location("pinned_osnet_ain_r744",
                                                        str(architecture_source))
    require(module_spec is not None and module_spec.loader is not None,
            "Cannot load pinned architecture module")
    osnet_ain = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(osnet_ain)

    require(not output.exists() and not output.is_symlink(),
            "Refuse to overwrite existing ONNX export")
    require(output.suffix == ".onnx" and output.parent.is_dir() and
            not output.parent.is_symlink(), "Unsupported output destination")
    torch.set_num_threads(1)
    weights = safe_tensor_state(torch, location / MODELS[model_name]["name"])
    model = getattr(osnet_ain, model_name)(
        num_classes=1000, loss="softmax", pretrained=False).cpu().eval()
    expected = model.state_dict()
    backbone = {k:v for k,v in expected.items() if not k.startswith("classifier.")}
    require(len(backbone)>300 and len(weights)>=len(backbone)-8,
            "Pretrained backbone coverage insufficient")
    bad = [k for k,v in backbone.items() if
           (k not in weights or tuple(weights[k].shape)!=tuple(v.shape))]
    unexpected = sorted(set(weights)-set(backbone))
    require(not bad and not unexpected,
            "Model mismatch: incomplete, incompatible or unknown state tensors")
    missing,extra=model.load_state_dict(weights, strict=False)
    require(not extra and all(k.startswith("classifier.") for k in missing),
            "Model load missing nonclassifier weights")
    # Synthetic inputs deterministic: no photographs or personal data.
    first = torch.linspace(-1.,1.,3*256*128,dtype=torch.float32).reshape(*SIZE)
    second = torch.stack((first[0],torch.flip(first[0],[-1])),dim=0)
    with torch.inference_mode():
        r1=model(first).detach().numpy().astype("float32")
        r2=model(second).detach().numpy().astype("float32")
    require(r1.shape==(1,FEATURES) and r2.shape==(2,FEATURES) and
            np.isfinite(r1).all() and np.isfinite(r2).all(),
            "PyTorch synthetic embedding contract failed")
    fd,temp = tempfile.mkstemp(prefix=".ain-validated-",suffix=".onnx",
                              dir=output.parent)
    os.close(fd)
    artifact=Path(temp)
    try:
        torch.onnx.export(model,first,str(artifact),opset_version=17,
            do_constant_folding=True,input_names=["person_crop"],
            output_names=["visual_embedding"],
            dynamic_axes={"person_crop":{0:"batch"},
                          "visual_embedding":{0:"batch"}},
            dynamo=False)
        onnx.checker.check_model(str(artifact))
        session=ort.InferenceSession(str(artifact),
                                    providers=["CPUExecutionProvider"])
        require(len(session.get_inputs())==len(session.get_outputs())==1,
                "ONNX model signature not 1x1")
        in_name=session.get_inputs()[0].name
        cosines=[]
        for crop,expected_output in ((first,r1),(second,r2)):
            actual=np.asarray(session.run(None,{in_name:crop.numpy()})[0],
                              dtype=np.float32)
            require(actual.shape==expected_output.shape and
                    np.isfinite(actual).all(),
                    "ONNX output mismatch")
            for a,b in zip(actual,expected_output):
                an=np.linalg.norm(a);bn=np.linalg.norm(b)
                require(an>1e-6 and bn>1e-6,"Degenerate ONNX vector")
                cosine=float(np.dot(a,b)/(an*bn))
                require(cosine>=.999,"ONNX export numeric parity insufficient")
                cosines.append(cosine)
        require(artifact.stat().st_size > 200_000 and
                artifact.stat().st_size < 40_000_000,
                "Unexpected ONNX export size")
        out_sha=sha(artifact)
        os.replace(artifact,output)
    finally:
        artifact.unlink(missing_ok=True)
    manifest=dict(meta,onnx_sha256=out_sha,onnx_bytes=output.stat().st_size,
        input_shape=["batch",3,256,128],output_shape=["batch",512],
        source_checkpoint_pytorch_only=True,
        model_human_reid_accuracy_verified=False,
        upstream_architecture_sha256=UPSTREAM_ARCHITECTURE_SHA256,
        camera_frame_rate_verified_during_this_export=False,
        phone_compatibility_verified=False,
        torch_onnx_cosine_min=min(cosines),onnx_opset=17)
    report=output.with_suffix(".manifest.json")
    require(not report.exists(), "Manifest already exists")
    fd,tmp=tempfile.mkstemp(prefix=".ain-manifest-",dir=output.parent)
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,"w") as f:
            json.dump(manifest,f,sort_keys=True,indent=2)
            f.write("\n")
        os.rename(tmp,report)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)
    print(json.dumps({"status":"R744_EXPORT_SYNTHETIC_EQUIVALENCE_PASS",
                      "architecture":model_name,
                      "weights_sha256":meta["weights_sha256"],
                      "onnx_sha256":out_sha,
                      "cosine_min":round(min(cosines),7),
                      "phone_run":False,
                      "people_assigned":0},sort_keys=True))

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--variant",choices=sorted(MODELS),required=True)
    p.add_argument("--weights-dir",type=Path,required=True)
    p.add_argument("--architecture-source",type=Path,default=None)
    action=p.add_mutually_exclusive_group(required=True)
    action.add_argument("--verify-only",action="store_true")
    action.add_argument("--export",type=Path,default=None)
    a=p.parse_args()
    if a.verify_only:
        print(json.dumps({"status":"R744_PINNED_CHECKPOINT_ARCHIVE_PASS",
                          **validate_source(a.variant,a.weights_dir)},
                         sort_keys=True))
        return
    export(a.variant,a.weights_dir,a.export,a.architecture_source)

if __name__=="__main__":
    main()
