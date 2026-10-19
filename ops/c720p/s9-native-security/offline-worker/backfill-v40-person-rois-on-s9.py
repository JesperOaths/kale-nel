#!/usr/bin/env python3
"""Backfill actual V40 detector *full-person* crops using S9 ONNX OSNet.

C720P transfers existing hash-verified crops; all inference happens ON S9+.
Only append-only private feature sidecars created under /data/local/tmp/s9_worker.
No C720P Torch/ORT, no camera APK/service/recording/review modifications.
Unaligned upper person crops are NOT passed through an ArcFace face model.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.parse
import urllib.request

PHONE="192.168.178.250:5555"
WORKER="/data/local/tmp/s9_worker"
MODEL="/storage/9C33-6BBD/S9OfflineModels/visual_backbone_512d.onnx"
MODEL_SHA="ee5717ad7a90cf0c915afa1fb6a5399b966562c5d42aa6f4a0c6c84a5349e47d"
BASE="http://127.0.0.1:8795"
HEX=re.compile(r"^[a-f0-9]{64}$")
ALLOWED=re.compile(r"^[a-zA-Z0-9_.-]{1,180}$")


def req_json(path,max_bytes=6000000):
    with urllib.request.urlopen(BASE+path,timeout=35) as rsp:
        if rsp.status!=200:raise RuntimeError("Authenticated catalog unavailable")
        raw=rsp.read(max_bytes+1)
    if len(raw)>max_bytes:raise RuntimeError("Catalog exceeded bound")
    result=json.loads(raw)
    if result.get("ok") is not True:raise RuntimeError("Catalog not verified")
    return result


def adb(*args,timeout=65,checked=True):
    cmd=["adb","-s",PHONE,*args]
    r=subprocess.run(cmd,capture_output=True,text=True,timeout=timeout)
    if checked and r.returncode:
        raise RuntimeError("ADB operation failed: "+r.stderr[-200:])
    return r


def record_index():
    sd=req_json("/new/api/saved")["events"]
    drive=req_json("/new/api/drive-saved")["events"]
    keys={}
    for source,items in (("s9_sd",sd),("gdrive_archive",drive)):
        for row in items:
            for field in ("remote_name","clip_no"):
                clip=row.get(field)
                if not isinstance(clip,str) or not ALLOWED.fullmatch(clip):
                    continue
                keys.setdefault(clip,set()).add(source)
    return keys


def catalog_items():
    first=req_json("/new/api/visual-review?workflow=clip_folders_v40&tab=all&offset=0&limit=100")
    total=first.get("total")
    if not isinstance(total,int) or not 0<=total<=5000:
        raise RuntimeError("Unexpected V40 item count")
    items=first.get("items")
    if not isinstance(items,list):raise RuntimeError("V40 items unavailable")
    for offset in range(len(items),total,100):
        page=req_json("/new/api/visual-review?workflow=clip_folders_v40&tab=all&offset="+str(offset)+"&limit=100")
        items+=page.get("items",[])
    if len(items)!=total:raise RuntimeError("Incomplete V40 person crop inventory")
    return items


def planned(items,source_map):
    result=[]
    seen=set()
    for item in items:
        crop=item.get("full_crop")
        clip=item.get("clip")
        if not isinstance(crop,dict) or not isinstance(clip,str):
            continue
        name,sha=crop.get("name"),crop.get("sha256")
        if (not isinstance(name,str) or not ALLOWED.fullmatch(name)
            or not isinstance(sha,str) or not HEX.fullmatch(sha)):
            continue
        size=crop.get("bytes")
        if not isinstance(size,int) or not 100<size<2_000_000:
            continue
        owners=source_map.get(clip,set())
        source=next(iter(owners)) if len(owners)==1 else "legacy_v40_unresolved"
        source_id=hashlib.sha256(("\x00".join((source,clip,sha))).encode()).hexdigest()
        if source_id in seen:continue
        seen.add(source_id)
        result.append({"source":source,"source_key":source_id,"crop_name":name,
                       "crop_sha256":sha,"crop_bytes":size})
    return result


def extract_one(row):
    key=row["source_key"]
    out=WORKER+"/features/"+key+"-visual.json"
    inbox=WORKER+"/inbox/"+key+".jpg"
    if adb("shell","test -f "+out,checked=False).returncode==0:
        return "already_indexed"
    endpoint="/new/api/visual-review/crop/"+urllib.parse.quote(row["crop_name"],safe="")
    with urllib.request.urlopen(BASE+endpoint,timeout=35) as rsp:
        if rsp.status!=200:raise RuntimeError("Original detector crop unavailable")
        data=rsp.read(2_000_001)
    if (len(data)!=row["crop_bytes"] or not data.startswith(b"\xff\xd8")
        or hashlib.sha256(data).hexdigest()!=row["crop_sha256"]):
        raise RuntimeError("Detector crop SHA/length invalid")
    with tempfile.TemporaryDirectory(prefix="s9-one-crop-") as tmp:
        local=Path(tmp)/"crop.jpg"
        local.write_bytes(data)
        adb("shell","umask 077; mkdir -p "+WORKER+"/inbox "+WORKER+"/features",timeout=20)
        try:
            adb("push",str(local),inbox,timeout=30)
            remote=adb("shell","sha256sum "+inbox,timeout=25).stdout.split()[0]
            if remote!=row["crop_sha256"]:
                raise RuntimeError("S9 crop transfer SHA mismatch")
            command=("export LD_LIBRARY_PATH="+WORKER+"/lib; "
                     "export CLASSPATH="+WORKER+"/s9-crop-worker.jar; "
                     "app_process -Djava.library.path="+WORKER+"/lib /system/bin "
                     "nl.kalenel.s9offline.S9OnnxCropWorker --extract visual "
                     +MODEL+" "+inbox+" "+out+" "+key+" "+row["crop_sha256"])
            response=adb("shell",command,timeout=130)
            if "S9_OFFLINE_REAL_CROP_512D_PERSISTED visual" not in response.stdout:
                raise RuntimeError("S9 actual detector crop inference did not complete")
            read=adb("exec-out","cat",out,timeout=18).stdout
            saved=json.loads(read)
            values=saved.get("visual_embedding")
            if (not isinstance(values,list) or len(values)!=512 or
                saved.get("source_qualified_key")!=key or
                saved.get("crop_sha256")!=row["crop_sha256"] or
                saved.get("model_sha256")!=MODEL_SHA or
                abs(sum(float(v)**2 for v in values)-1)>0.001):
                raise RuntimeError("Persisted feature sidecar failed validation")
            return "verified_new"
        finally:
            adb("shell","rm -f "+inbox,timeout=15,checked=False)


def main():
    cli=argparse.ArgumentParser()
    cli.add_argument("--write",action="store_true")
    cli.add_argument("--limit",type=int,default=2)
    cli.add_argument("--offset",type=int,default=0)
    args=cli.parse_args()
    if not 1<=args.limit<=20 or args.offset<0:
        raise ValueError("Bounded backfill 1-20 per job")
    phone_id=adb("shell","pidof nl.kalenel.s9security").stdout.strip()
    if not re.fullmatch("[0-9 ]+",phone_id):
        raise RuntimeError("Live camera health baseline unavailable")
    source_map=record_index()
    rows=planned(catalog_items(),source_map)
    subset=rows[args.offset:args.offset+args.limit]
    if not args.write:
        print("S9_REAL_PERSON_CROP_BACKFILL_DRY_RUN "+json.dumps({
            "available_real_full_person_crops":len(rows),
            "qualified_sources":dict(Counter(x["source"] for x in rows)),
            "selected":len(subset),"offset":args.offset,
            "vectors_written":0,"camera_modified":False}),flush=True)
        return
    results=[]
    for row in subset:
        try:
            results.append(extract_one(row))
        except Exception as error:
            # Do not turn one imperfect crop into a stale or fake feature.
            results.append("failed_"+type(error).__name__)
    after=adb("shell","pidof nl.kalenel.s9security").stdout.strip()
    if after!=phone_id:
        raise RuntimeError("Live camera process changed during offline run")
    stats=dict(Counter(results))
    print("S9_REAL_PERSON_CROP_BACKFILL_BATCH "+json.dumps({
        "total_possible":len(rows),"range":[args.offset,args.offset+len(subset)],
        "counts":stats,
        "vectors_verified":stats.get("verified_new",0)+stats.get("already_indexed",0),
        "structural_arcface_applied_to_unaligned_crops":False,
        "original_crops_modified":False,
        "camera_apk_modified":False,
        "review_decisions_modified":False}),flush=True)
    if any(str(x).startswith("failed") for x in results):
        raise RuntimeError("Backfill partial failure: inspect source and retry missing keys")


if __name__=="__main__":
    main()
