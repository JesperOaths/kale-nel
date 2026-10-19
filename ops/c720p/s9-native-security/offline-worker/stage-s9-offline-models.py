#!/usr/bin/env python3
"""S9+ offline model-asset provisioning via authenticated local ADB transport.

Executes on the C720P as a transfer relay, NOT as a model inference worker.
No camera APK/service, recordings, review decisions, or archive metadata touched.
Stream bytes to a separate microSD folder; never write a C720P model copy.
This provisions the ONNX file only, not a working Android ONNX runtime.
"""
import argparse
import hashlib
import json
import re
import shlex
import subprocess
import urllib.request

PHONE="192.168.178.250:5555"
DIRECTORY="/storage/9C33-6BBD/S9OfflineModels"
ASSET="structural_upper_crop_512d.onnx"
URL=("https://huggingface.co/globalnebula/insightface-buffalo-l-onnx/"
     "resolve/main/arcface_w600k_r50.onnx")
SIZE=174383860
SHA="4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43"

def adb(*args, timeout=30, check=True):
    proc=subprocess.run(["adb","-s",PHONE,*args],
                        text=True,capture_output=True,timeout=timeout)
    if check and proc.returncode:
        raise RuntimeError("ADB command failed: "+proc.stderr[:150])
    return proc.stdout.strip()

def local_status():
    devices=adb("devices")
    if PHONE not in devices or "\tdevice" not in devices:
        raise RuntimeError("S9 not connected and authorized")
    if adb("shell","getprop","ro.product.cpu.abi") != "arm64-v8a":
        raise RuntimeError("Unexpected phone architecture")
    if adb("shell","getprop","ro.build.version.sdk") != "29":
        raise RuntimeError("Unexpected Android SDK")
    state=adb("shell","pidof","nl.kalenel.s9security",check=False)
    if not re.fullmatch(r"[0-9 ]+",state):
        raise RuntimeError("Live camera health baseline unavailable")
    free=adb("shell","df","-k","/storage/9C33-6BBD")
    fields=free.splitlines()[-1].split()
    if len(fields)<4 or not fields[3].isdigit() or int(fields[3])*1024<20*1024**3:
        raise RuntimeError("Insufficient microSD reserve")
    return state

def remote_sha(path):
    response=adb("shell","sha256sum",path,check=False)
    found=re.match(r"^([0-9a-f]{64})\s+",response)
    return found.group(1) if found else ""

def provision():
    original_pid=local_status()
    q=shlex.quote
    final=DIRECTORY+"/"+ASSET
    tmp=final+".transfer-partial"
    # Never place a model in the camera's Security4K directory.
    assert "/Security4K/" not in final
    adb("shell","mkdir","-p",DIRECTORY)
    before=remote_sha(final)
    if before==SHA:
        print("S9_ARCFACE_ASSET_VERIFIED "+
              json.dumps({"status":"existing","bytes":SIZE,"sha256":SHA,
                          "phone":True,"camera_apk_changed":False}),flush=True)
        return
    if before:
        raise RuntimeError("Existing model conflicts with pinned hash; no overwrite")
    if adb("shell","test","-e",tmp,check=False)=="":
        # ADB's shell 'test' emits no text regardless of its exit code.
        # Never reuse a transfer-partial path from an unknown previous job.
        status=subprocess.run(["adb","-s",PHONE,"shell","test","-e",tmp],
                              capture_output=True,timeout=12)
        if status.returncode==0:
            raise RuntimeError("Existing partial transfer; explicit cleanup required")
    input_argv=["adb","-s",PHONE,"exec-in","sh","-c",
                "umask 077; cat > "+q(tmp)]
    sender=subprocess.Popen(input_argv,stdin=subprocess.PIPE,
                            stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    sha=hashlib.sha256()
    total=0
    try:
        req=urllib.request.Request(URL,headers={"User-Agent":"S9OfflineAsset/1"})
        with urllib.request.urlopen(req,timeout=50) as response:
            if response.status!=200:
                raise RuntimeError("Model HTTP status is not 200")
            while True:
                packet=response.read(65536)
                if not packet: break
                total+=len(packet)
                if total>SIZE:
                    raise RuntimeError("Model oversized relative to pinned manifest")
                sha.update(packet)
                sender.stdin.write(packet)
        sender.stdin.close()
        rc=sender.wait(timeout=55)
        if rc!=0:
            raise RuntimeError("ADB streaming failed: "+sender.stderr.read(200).decode(errors="replace"))
        if total!=SIZE or sha.hexdigest()!=SHA:
            raise RuntimeError("Downloaded model size or sha256 mismatch")
        if remote_sha(tmp)!=SHA:
            raise RuntimeError("Phone-side SHA256 verification failed")
        adb("shell","mv",tmp,final)
        if remote_sha(final)!=SHA:
            raise RuntimeError("Final model SHA256 verification failed")
        # PID liveness rather than PID stability: Android services can restart
        # independently, and we must never interact with the recorder here.
        after=adb("shell","pidof","nl.kalenel.s9security",check=False)
        if not re.fullmatch(r"[0-9 ]+",after):
            raise RuntimeError("Recording process no longer observable")
        print("S9_ARCFACE_ASSET_VERIFIED "+json.dumps({
            "status":"new","bytes":total,"sha256":SHA,"phone":True,
            "camera_apk_changed":False,"recorder_manipulated":False,
            "runtime_inference_verified":False,
            "path":final}),flush=True)
    except BaseException:
        try:
            if sender.poll() is None: sender.kill()
            sender.wait(timeout=4)
        except Exception:pass
        try: adb("shell","rm","-f",tmp,timeout=15)
        except Exception:pass
        raise

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--install",action="store_true")
    args=parser.parse_args()
    original=local_status()
    if args.install:
        provision()
    else:
        print("S9_ARCFACE_ASSET_PREFLIGHT_PASS "+json.dumps({
            "expected_size":SIZE,"expected_sha256":SHA,
            "phone":"SM-G965F","camera_pid_detected":bool(original),
            "mount":DIRECTORY,"streaming_only":True,
            "camera_apk_changed":False}),flush=True)

if __name__=="__main__":
    main()
