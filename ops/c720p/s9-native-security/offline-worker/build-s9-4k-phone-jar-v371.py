#!/usr/bin/env python3
"""OFFLINE BUILD ONLY: compile standalone, unhashed-at-runtime S9+ app_process DEX.

No adb, Android device connection, Camera2 APK modification, install, inference
or queue mutation is implemented. The resulting SHA256 must be independently
reviewed and enrolled before use by the already guarded V304 phone runner.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

AAR_SHA="04a4617a9c797cf49225595e45b5546081cb34c86ac817581141577d3b7dbfe2"
CLASSES=(
    "S9YuNetNativeQualityDecoderV370.java",
    "S9Original4KTimedDecoderV371.java",
    "S9Original4KGapAuditV370.java",
)
ROOT=Path(__file__).resolve().parent

def sha(path):
    dig=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(65536),b""):
            dig.update(chunk)
    return dig.hexdigest()

def require(ok,what):
    if not ok:raise ValueError(what)

def run(args):
    result=subprocess.run(args,capture_output=True,timeout=90,check=False)
    require(result.returncode==0,"trusted_local_build_failed")
    require(len(result.stdout)<=200000 and len(result.stderr)<=200000,
            "local_build_output_unbounded")

def build(output_dir,aar,android_jar,d8):
    output_dir=Path(output_dir).resolve()
    require(not output_dir.is_symlink(),"unsafe_output_symlink")
    require(not output_dir.exists(),"output_must_be_new")
    for name,path in (("onnx_aar",aar),("android_jar",android_jar),("d8",d8)):
        path=Path(path).resolve()
        require(path.is_file() and not path.is_symlink(),
                "missing_trusted_"+name)
    aar=Path(aar).resolve()
    require(sha(aar)==AAR_SHA,"onnx_aar_digest_mismatch")
    with tempfile.TemporaryDirectory(prefix="task9-s9-4k-jar-") as tmp:
        root=Path(tmp)
        classes=root/"classes";classes.mkdir()
        jar=root/"ort.jar"
        with zipfile.ZipFile(aar) as arc:
            require("classes.jar" in arc.namelist(),
                    "onnx_android_jar_missing")
            jar.write_bytes(arc.read("classes.jar"))
        java=[ROOT/n for n in CLASSES]
        for path in java:require(path.is_file(),"missing_phone_source")
        run(["javac","-source","8","-target","8",
             "-cp",str(jar)+os.pathsep+str(android_jar),"-d",str(classes),
             *(str(p) for p in java)])
        source_classes=sorted(classes.rglob("*.class"))
        require(len(source_classes)>=4,"missing_compiled_probe_classes")
        target=root/"dex";target.mkdir()
        run([str(d8),"--min-api","29","--output",str(target),
             *(str(p) for p in source_classes)])
        dex=target/"classes.dex"
        require(dex.is_file() and 100<dex.stat().st_size<300000,
                "bounded_dex_missing")
        archive=root/"s9_gap_v371.dex.jar"
        with zipfile.ZipFile(archive,"w",compression=zipfile.ZIP_STORED) as z:
            z.write(dex,"classes.dex")
        require(100<archive.stat().st_size<300000,
                "bounded_phone_artifact_invalid")
        receipt={"schema":"task9_offline_phone_jar_build_v371",
            "build_only":True,"camera_apk_modified":False,
            "phone_connected":False,"model_inference_performed":False,
            "originals_modified":False,"automatic_person_assignments":0,
            "onnx_android_aar_sha256":AAR_SHA,
            "android_platform_sha256":sha(Path(android_jar)),
            "d8_sha256":sha(Path(d8)),
            "source_sha256":{p.name:sha(p) for p in java},
            "phone_frame_jar_sha256":sha(archive),
            "phone_frame_jar_bytes":archive.stat().st_size,
            "entrypoint":"nl.kalenel.s9offline.S9Original4KGapAuditV370"}
        output_dir.mkdir(mode=0o700,parents=True)
        os.chmod(output_dir,0o700)
        shutil.copyfile(archive,output_dir/archive.name)
        os.chmod(output_dir/archive.name,0o600)
        receipt_file=output_dir/"build-receipt.json"
        receipt_file.write_text(json.dumps(receipt,indent=2,sort_keys=True)+"\n")
        os.chmod(receipt_file,0o600)
        require(sha(output_dir/archive.name)==receipt["phone_frame_jar_sha256"],
                "local_output_digest_changed")
        return {"output":str(output_dir),"jar_sha256":receipt["phone_frame_jar_sha256"],
                "build_only":True}

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--output-dir",type=Path,required=True)
    ap.add_argument("--onnx-aar",type=Path,required=True)
    ap.add_argument("--android-jar",type=Path,required=True)
    ap.add_argument("--d8",type=Path,required=True)
    args=ap.parse_args()
    print(json.dumps(build(args.output_dir,args.onnx_aar,
                           args.android_jar,args.d8),sort_keys=True))

if __name__=="__main__":main()
