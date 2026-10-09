#!/usr/bin/env python3
"""Read-only SSD vs TFHub EfficientDet on existing C720P cached native S9 thumbnails.

Usage (isolated venv, no camera APK installation):
  .../venv/bin/python hub-readonly-compare.py [--max-images 16]

The results are agreement/latency only: no human labels, no precision/recall,
no face embeddings, no media is uploaded or modified.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import statistics
import time
import urllib.request
import zipfile

BASE=Path("/home/jespern/c720p-home-hub/build/s9-detector-benchmark")
CACHE=Path("/opt/homeassistant/config/www/frontyard-security-new/s9-phone-thumbs")
OUTPUT=BASE/"results/ssd-vs-lite0-hub-cpu.json"
MODELS={
 "ssd":("baseline.tflite","e4b118e5e4531945de2e659742c7c590f7536f8d0ed26d135abcfe83b4779d13",
   ["TFLite_Detection_PostProcess","TFLite_Detection_PostProcess:1","TFLite_Detection_PostProcess:2","TFLite_Detection_PostProcess:3"],300),
 "lite0":("efficientdet_lite0_tfhub_candidate.tflite",
   "2e04c53bfeac0ac2a30c057c7e2a777594ce39baaac35a92f74fb1e8c4fc4e0b",
   ["StatefulPartitionedCall:3","StatefulPartitionedCall:2","StatefulPartitionedCall:1","StatefulPartitionedCall:0"],320)
}
THRESHOLDS=(0.30,0.50,0.70)

def status():
    with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=7) as r:
        d=json.load(r)
    if not d.get("ok") or d.get("mode")!="watching":
        raise RuntimeError("live_recorder_busy_or_offline")
    if float(d.get("temperature_c",100))>=38:
        raise RuntimeError("phone_hot")
    return d

def validate_sources(paths):
    if not paths:
        raise RuntimeError("no_cached_native_thumbnails")
    prefix=CACHE.resolve()
    for p in paths:
        if not p.is_file() or p.is_symlink() or p.resolve().parent!=prefix:
            raise RuntimeError("invalid_source_path")
        if not p.name.startswith("motion_") or not p.name.endswith(".mp4.thumb.jpg"):
            raise RuntimeError("unexpected_source_filename")
    old=(BASE.parent/"s9-person-ml-v1/assets/labelmap.txt").read_text().splitlines()
    # First raw COCO class index is person for both verified detector families.
    assert len(old)>1 and old[1].strip().lower()=="person"
    tfhub=BASE/"assets/efficientdet_lite0_tfhub_candidate.tflite"
    with zipfile.ZipFile(tfhub) as z:
        lines=z.read("labelmap.txt").decode("utf-8").splitlines()
    assert lines and lines[0].strip().lower()=="person"
    return True

def run(model,paths,results):
    import numpy as np
    from PIL import Image
    from ai_edge_litert.interpreter import Interpreter
    filename,expected,roles,dimension=MODELS[model]
    path=BASE/"assets"/filename
    assert path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest()==expected
    network=Interpreter(model_path=str(path),num_threads=1)
    network.allocate_tensors()
    inputs=network.get_input_details()
    assert len(inputs)==1 and inputs[0]["dtype"]==np.uint8
    shape=tuple(map(int,inputs[0]["shape"]))
    assert shape==(1,dimension,dimension,3)
    by_name={x["name"]:x for x in network.get_output_details()}
    assert len(by_name)==4 and all(x in by_name for x in roles)
    assert tuple(by_name[roles[0]]["shape"]) in ((1,10,4),(1,25,4))
    assert tuple(by_name[roles[3]]["shape"])==(1,)
    rows={}
    for i,p in enumerate(paths):
        if i%4==0:status()
        with Image.open(p) as image:
            rgb=np.asarray(image.convert("RGB").resize(
                (dimension,dimension),Image.Resampling.BILINEAR),dtype=np.uint8).reshape(shape)
        network.set_tensor(inputs[0]["index"],rgb)
        t=time.perf_counter_ns()
        network.invoke()
        elapsed=(time.perf_counter_ns()-t)/1e6
        boxes,classes,scores,count=[network.get_tensor(by_name[k]["index"]) for k in roles]
        n=int(round(float(count.reshape(-1)[0])))
        assert 0<=n<=boxes.shape[1] and n<=scores.shape[1]
        confident=[float(scores[0,k]) for k in range(n)
                   if round(float(classes[0,k]))==0]
        maximum=max(confident,default=0.0)
        assert 0<=maximum<=1.01
        rows[p.name]={
            "input_sha256":hashlib.sha256(p.read_bytes()).hexdigest(),
            "person_score":round(maximum,5),
            "inference_ms":round(elapsed,2),
            "positive_at":{str(t):bool(maximum>=t) for t in THRESHOLDS}
        }
        time.sleep(.1)
    results[model]={
        "model_sha256":expected,
        "model_input":list(shape),
        "output_names":roles,
        "frames":rows,
        "latency_ms":{
            "p50":round(statistics.median(v["inference_ms"] for v in rows.values()),1),
            "first":rows[paths[0].name]["inference_ms"]
        }
    }
    del network

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--max-images",type=int,default=16)
    options=ap.parse_args()
    if not 1<=options.max_images<=16:
        raise SystemExit("max-images must be 1..16")
    sources=sorted(CACHE.glob("motion_*.mp4.thumb.jpg"),reverse=True)[:options.max_images]
    validate_sources(sources)
    before=status()
    results={}
    for model in ("ssd","lite0"):
        run(model,sources,results)
    after=status()
    summary={
      "count":len(sources),
      "host":"C720P x86_64 1-thread CPU",
      "no_ground_truth":True,
      "image_selection_bias":"original SSD-selected clip thumbnails",
      "nighttime_only_at_initial_capture":True,
      "camera_before":before.get("mode"),
      "camera_after":after.get("mode"),
      "temp_after_c":after.get("temperature_c"),
      "models":{},
      "agreement":{}
    }
    for model in results:
        samples=results[model]["frames"]
        summary["models"][model]={
            "positive_images":{str(t):sum(v["positive_at"][str(t)] for v in samples.values()) for t in THRESHOLDS},
            "p50_inference_ms":results[model]["latency_ms"]["p50"]
        }
    a=results["ssd"]["frames"]
    b=results["lite0"]["frames"]
    for t in THRESHOLDS:
        t=str(t)
        summary["agreement"][t]={
            "both":sum(a[k]["positive_at"][t] and b[k]["positive_at"][t] for k in a),
            "ssd_only":sum(a[k]["positive_at"][t] and not b[k]["positive_at"][t] for k in a),
            "lite0_only":sum(not a[k]["positive_at"][t] and b[k]["positive_at"][t] for k in a),
            "neither":sum(not a[k]["positive_at"][t] and not b[k]["positive_at"][t] for k in a)
        }
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    temp=OUTPUT.with_suffix(".json.tmp")
    temp.write_text(json.dumps({"summary":summary,"per_image":results},indent=2)+"\n")
    os.chmod(temp,0o600)
    os.replace(temp,OUTPUT)
    print("S9_LOCAL_AB_REPRODUCIBLE_PASS",json.dumps(summary))
    print("RESULT_PATH",str(OUTPUT))

if __name__=="__main__":
    main()
