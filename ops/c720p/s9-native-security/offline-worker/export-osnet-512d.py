#!/usr/bin/env python3
"""Export a real pretrained OSNet x1.0 to static [1,3,256,128] ONNX 512D.

Runs only on a build host equipped with trusted CPU Torch, torchvision,
torchreid, onnxruntime and onnx. Never touches the S9 recording APK.
Requires an explicitly supplied output path and uses atomic writing.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile

import numpy as np


def digest(path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for data in iter(lambda:f.read(65536),b""): h.update(data)
    return h.hexdigest()


def main():
    cli=argparse.ArgumentParser()
    cli.add_argument("--output",type=Path,required=True)
    cli.add_argument("--manifest",type=Path,required=True)
    args=cli.parse_args()
    if args.output.suffix != ".onnx" or args.output.is_symlink():
        raise ValueError("Only a regular ONNX output is supported")
    if args.manifest.is_symlink():
        raise ValueError("Manifest symlink not allowed")
    import torch
    import torchreid
    import onnx
    import onnxruntime as ort
    torch.set_num_threads(1)
    # Pretrained=True is mandatory: no random-weight fake descriptors.
    model=torchreid.models.build_model(
        name="osnet_x1_0",num_classes=1000,loss="softmax",
        pretrained=True,use_gpu=False)
    model=model.cpu().eval()
    test=torch.linspace(-1,1,3*256*128,dtype=torch.float32).reshape(1,3,256,128)
    with torch.inference_mode():
        out=model(test).detach().cpu().numpy().astype(np.float32)
    if out.shape!=(1,512) or not np.all(np.isfinite(out)):
        raise ValueError("OSNet did not produce a finite [1,512] eval descriptor")
    if float(np.linalg.norm(out))<1e-8:
        raise ValueError("Degenerate OSNet pretrained output")
    args.output.parent.mkdir(parents=True,exist_ok=True)
    fd,tmpname=tempfile.mkstemp(prefix=".osnet-",suffix=".onnx",dir=args.output.parent)
    os.close(fd)
    tmp=Path(tmpname)
    try:
        torch.onnx.export(
            model,test,str(tmp),
            input_names=["image"],output_names=["visual_embedding"],
            opset_version=17,
            do_constant_folding=True,
            dynamic_axes=None,
            dynamo=False)
        onnx.checker.check_model(str(tmp))
        session=ort.InferenceSession(str(tmp),providers=["CPUExecutionProvider"])
        outs=session.run(["visual_embedding"],{"image":test.numpy()})
        if len(outs)!=1 or outs[0].shape!=(1,512):
            raise ValueError("Exported ONNX visual shape mismatch")
        actual=np.asarray(outs[0],np.float32)
        if not np.all(np.isfinite(actual)):
            raise ValueError("Nonfinite exported OSNet embedding")
        reference=out[0]/np.linalg.norm(out[0])
        observed=actual[0]/np.linalg.norm(actual[0])
        cosine=float(np.dot(reference,observed))
        if cosine<.999:
            raise ValueError("ONNX export diverged from pretrained PyTorch output")
        if tmp.stat().st_size<1_000_000:
            raise ValueError("Unexpectedly small OSNet ONNX export")
        checksum=digest(tmp)
        os.replace(tmp,args.output)
        manifest={
            "version":1,"architecture":"osnet_x1_0",
            "pretrained":True,"input_shape":[1,3,256,128],
            "output_shape":[1,512],"input_color":"RGB",
            "mean":[0.485,0.456,0.406],
            "std":[0.229,0.224,0.225],
            "source":"torchreid.models.build_model(osnet_x1_0,pretrained=True)",
            "onnx_opset":17,"cosine_torch_onnx":cosine,
            "sha256":checksum,"bytes":args.output.stat().st_size,
            "identity_model":False,"phone_runtime_tested":False,
        }
        args.manifest.write_text(json.dumps(manifest,sort_keys=True,indent=2))
        print("OSNET_512D_ONNX_EXPORT_VERIFIED "+
              json.dumps({"sha256":checksum,"bytes":manifest["bytes"],
                          "cosine":cosine,"input":manifest["input_shape"],
                          "output":manifest["output_shape"]}),flush=True)
    finally:
        tmp.unlink(missing_ok=True)

if __name__=="__main__":
    main()
