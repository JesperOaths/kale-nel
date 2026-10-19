#!/usr/bin/env python3
"""Safely stage separately verified ONNX assets on S9+ microSD (not Camera2).

Exported pretrained OSNet is supplied as a local artifact and manifest.
The ArcFace blob streams directly from its immutable Hugging Face LFS
object to a separate SD worker folder, without a large C720P temporary copy.
No recording, crop, review decision, camera package or service is modified.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import urllib.request

PHONE="192.168.178.250:5555"
FOLDER="/storage/9C33-6BBD/S9OfflineModels"
ARC_NAME="structural_upper_crop_512d.onnx"
OS_NAME="visual_backbone_512d.onnx"
ARC_URI=("https://huggingface.co/globalnebula/insightface-buffalo-l-onnx/"
         "resolve/main/arcface_w600k_r50.onnx")
ARC_SHA="4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43"
ARC_BYTES=174383860


def run(argv,timeout=45):
    p=subprocess.run(argv,capture_output=True,text=True,timeout=timeout)
    if p.returncode:
        raise RuntimeError("Command failed "+argv[0]+": "+p.stderr[:150])
    return p.stdout.strip()


def adb_shell(shell):
    return run(["adb","-s",PHONE,"shell",shell],timeout=25)


def remote_sha(name):
    p=subprocess.run(["adb","-s",PHONE,"shell",
                      "sha256sum "+FOLDER+"/"+name],text=True,
                     capture_output=True,timeout=35)
    if p.returncode:return ""
    found=re.match(r"^([0-9a-f]{64})\s+",p.stdout)
    return found.group(1) if found else ""


def file_sha(path):
    sha=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(65536),b""):sha.update(chunk)
    return sha.hexdigest()


def check_phone():
    devices=run(["adb","devices"])
    if PHONE+"\tdevice" not in devices:raise RuntimeError("S9 ADB offline")
    if adb_shell("getprop ro.product.cpu.abi")!="arm64-v8a":
        raise RuntimeError("Unexpected CPU ABI")
    recording_pid=adb_shell("pidof nl.kalenel.s9security")
    if not re.fullmatch(r"[0-9 ]+",recording_pid):
        raise RuntimeError("Cannot verify live recorder health")
    df=adb_shell("df -k /storage/9C33-6BBD")
    fields=df.splitlines()[-1].split()
    if len(fields)<4 or not fields[3].isdigit() or int(fields[3])<21*1024*1024:
        raise RuntimeError("Phone SD free space below hard reserve")
    return recording_pid


def stage_file(name,bytes_count,expected_sha,reader):
    if not re.fullmatch(r"[a-z0-9_]+[.]onnx",name):
        raise ValueError("Unsafe ONNX model filename")
    existing=remote_sha(name)
    if existing==expected_sha:
        return {"model":name,"result":"already_verified","sha256":expected_sha}
    if existing:raise RuntimeError("Existing model has wrong digest; no overwrite")
    part=FOLDER+"/"+name+".partial"
    exists=subprocess.run(["adb","-s",PHONE,"shell","test -e "+part],
                          capture_output=True,timeout=20)
    if exists.returncode==0:
        raise RuntimeError("Unknown partial model found; no overwrite")
    proc=subprocess.Popen(
        ["adb","-s",PHONE,"exec-in","sh","-c","umask 077; cat > '"+part+"'"],
        stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    actual=hashlib.sha256();total=0
    try:
        while True:
            chunk=reader.read(65536)
            if not chunk:break
            total+=len(chunk)
            if total>bytes_count:raise RuntimeError("Bounded stream exceeded size")
            actual.update(chunk)
            proc.stdin.write(chunk)
        proc.stdin.close()
        if proc.wait(timeout=65):
            raise RuntimeError("ADB stream failed")
        if total!=bytes_count or actual.hexdigest()!=expected_sha:
            raise RuntimeError("Artifact length or digest differs from pin")
        remote=adb_shell("sha256sum "+part).split()[0]
        if remote!=expected_sha:
            raise RuntimeError("Phone did not receive exact verified model")
        adb_shell("mv '"+part+"' '"+FOLDER+"/"+name+"'")
        if remote_sha(name)!=expected_sha:
            raise RuntimeError("Phone final digest mismatch")
        return {"model":name,"result":"installed","sha256":expected_sha,
                "bytes":total}
    except BaseException:
        try:
            if proc.poll() is None:proc.kill()
            proc.wait(timeout=5)
        except Exception:pass
        try:adb_shell("rm -f '"+part+"'")
        except Exception:pass
        raise


def stage_visual(path,manifest_path):
    if (path.is_symlink() or manifest_path.is_symlink()
            or not path.is_file() or not manifest_path.is_file()):
        raise RuntimeError("Missing verified local OSNet export and manifest")
    manifest=json.loads(manifest_path.read_text())
    n=path.stat().st_size
    if (not 1_000_000<n<180_000_000
        or manifest.get("architecture")!="osnet_x1_0"
        or manifest.get("pretrained") is not True
        or manifest.get("input_shape")!=[1,3,256,128]
        or manifest.get("output_shape")!=[1,512]
        or manifest.get("sha256")!=file_sha(path)
        or manifest.get("bytes")!=n
        or manifest.get("cosine_torch_onnx",0)<.999):
        raise RuntimeError("OSNet pretraining/ONNX equivalence not verified")
    with path.open("rb") as f:return stage_file(OS_NAME,n,manifest["sha256"],f)


def stage_structural():
    req=urllib.request.Request(ARC_URI,headers={"User-Agent":"S9Worker/1"})
    with urllib.request.urlopen(req,timeout=45) as source:
        if source.status!=200:raise RuntimeError("ArcFace HTTP unavailable")
        return stage_file(ARC_NAME,ARC_BYTES,ARC_SHA,source)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--install",action="store_true")
    parser.add_argument("--visual",type=Path)
    parser.add_argument("--manifest",type=Path)
    parser.add_argument("--structural",action="store_true")
    args=parser.parse_args()
    check_phone()
    if not args.install:
        print("S9_DUAL_ONNX_ASSET_PREFLIGHT_PASS "+
              json.dumps({"abi":"arm64-v8a","model_folder":FOLDER,
                          "structural_sha256":ARC_SHA,"structural_bytes":ARC_BYTES,
                          "phone_models_existing":{
                              OS_NAME:bool(remote_sha(OS_NAME)),
                              ARC_NAME:bool(remote_sha(ARC_NAME))},
                          "recordings_changed":False}),flush=True)
        return
    if (args.visual is None)!=(args.manifest is None):
        raise ValueError("Visual model and manifest are an inseparable pair")
    if not args.structural and args.visual is None:
        raise ValueError("No model was requested")
    adb_shell("umask 077; mkdir -p '"+FOLDER+"'")
    result=[]
    if args.visual is not None:
        result.append(stage_visual(args.visual,args.manifest))
    if args.structural:
        result.append(stage_structural())
    check_phone()
    print("S9_DUAL_ONNX_ASSETS_STAGED "+
          json.dumps({"results":result,"camera_apk_changed":False,
                      "recordings_changed":False,
                      "models_executed":False}),flush=True)


if __name__=="__main__":
    main()
