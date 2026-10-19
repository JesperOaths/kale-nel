#!/usr/bin/env python3
"""Bounded temporary CPU-only OSNet export environment on C720P.

Never pip-installs to system Python or Home Assistant. No camera, recorder,
Docker image, server process or user archive modifications. Jobs can be run
one phase at a time to fit management queue timeouts. The exported artifact
must pass export-osnet-512d.py numerical equivalence before phone staging.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT=Path("/tmp/s9_osnet_export_cpu")
VENV=ROOT/"venv"
PHASES={
 "torch":["torch==2.8.0+cpu","torchvision==0.23.0+cpu"],
 "support":["torchreid==0.2.5","onnx==1.19.0","onnxruntime==1.22.1",
            "gdown","numpy<3","pillow","opencv-python-headless",
            "scipy","imageio","h5py","scikit-learn","tqdm","yacs",
            "tensorboard","cython"],
}


def available():
    return shutil.disk_usage("/tmp").free,shutil.disk_usage("/").free


def test_resources():
    tmp,root=available()
    mem={}
    with open("/proc/meminfo",encoding="ascii") as f:
        for line in f:
            if line.startswith(("MemAvailable:","SwapFree:")):
                key,value,*_=line.split();mem[key[:-1]]=int(value)*1024
    return {"tmp_free":tmp,"root_free":root,
            "mem_available":mem.get("MemAvailable",0),
            "swap_free":mem.get("SwapFree",0)}


def run(argv,timeout):
    cmd=["nice","-n","15",*argv]
    result=subprocess.run(cmd,check=False,capture_output=True,text=True,
                          timeout=timeout,env={
        **os.environ,"PIP_NO_CACHE_DIR":"1","PIP_DISABLE_PIP_VERSION_CHECK":"1",
        "PIP_DEFAULT_TIMEOUT":"20","TORCH_NUM_THREADS":"1",
        "OMP_NUM_THREADS":"1","MALLOC_ARENA_MAX":"2",
        "TMPDIR":"/tmp"})
    if result.returncode:
        raise RuntimeError("Dependency install failed: "+
                           result.stderr[-1600:].replace("\n"," | "))
    return result.stdout[-600:]


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("phase",choices=["preflight","torch","support"])
    args=parser.parse_args()
    resources=test_resources()
    if args.phase=="preflight":
        print("C720P_OSNET_TEMP_ENV_PREFLIGHT "+json.dumps(resources),flush=True)
        return
    # Large Torch wheels can temporarily occupy hundreds of MB; do not
    # risk saturating the hub's filesystem while its other services run.
    minimum=1_000_000_000 if args.phase=="torch" else 350_000_000
    if resources["tmp_free"]<minimum or resources["root_free"]<250_000_000:
        raise RuntimeError("Insufficient C720P filesystem reserve for "+args.phase)
    if resources["mem_available"]<650_000_000 or resources["swap_free"]<1_000_000_000:
        raise RuntimeError("Insufficient RAM/swap reserve for offline export")
    if not (VENV/"bin"/"python").is_file():
        ROOT.mkdir(parents=True,exist_ok=True)
        subprocess.run([sys.executable,"-m","venv",str(VENV)],check=True,timeout=35)
    pip=str(VENV/"bin"/"python")
    params=[pip,"-m","pip","install","--no-cache-dir","--retries","1","--timeout","25"]
    if args.phase=="torch":
        params+=["--index-url","https://download.pytorch.org/whl/cpu"]
    params+=PHASES[args.phase]
    run(params,230)
    modules=["torch","torchvision"] if args.phase=="torch" else ["torchreid","onnx","onnxruntime"]
    script="import importlib; [importlib.import_module(x) for x in "+repr(modules)+"];print('dependencies_imported')"
    test=run([pip,"-c",script],55)
    print("C720P_OSNET_TEMP_ENV_STAGE_PASS "+json.dumps({
        "phase":args.phase,"modules":modules,"import_test":test.strip(),
        "resources_after":test_resources(),
        "system_python_changed":False,"camera_changed":False}),flush=True)

if __name__=="__main__":
    main()
