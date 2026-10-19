#!/usr/bin/env python3
"""Uniform V2 upper torso HSV32 descriptors for verified S9 OSNet crops.

Read-only source videos and preexisting V40 crop records. Every pixel is
binned on the S9+, using the SAME HSV32 implementation for both cohorts.
Never reuses the old V40 differently binned HSV histograms. Never overwrites
v1 ranking outputs, feature sidecars, originals or human decisions.
"""
import argparse
from collections import Counter
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request

ROOT="/data/local/tmp/s9_worker"
PHONE="192.168.178.250:5555"
API="http://127.0.0.1:8795"
SOURCE="s9_sd"
VISUAL="ee5717ad7a90cf0c915afa1fb6a5399b966562c5d42aa6f4a0c6c84a5349e47d"
DETECT="e4b118e5e4531945de2e659742c7c590f7536f8d0ed26d135abcfe83b4779d13"
CLIP=re.compile(r"motion_[0-9]{13}[.]mp4\Z")
HEX=re.compile(r"[a-f0-9]{64}\Z")
METHOD="hue8_saturation2_value2_center_torso_v2"


def sibling(filename,alias):
    path=Path(__file__).with_name(filename)
    if not path.is_file():raise RuntimeError("Pinned source-qualified helper missing: "+filename)
    spec=importlib.util.spec_from_file_location(alias,path)
    module=importlib.util.module_from_spec(spec)
    sys.modules[spec.name]=module
    spec.loader.exec_module(module)
    return module


def adb(*args,timeout=90,required=True):
    proc=subprocess.run(["adb","-s",PHONE,*args],
                        capture_output=True,text=True,timeout=timeout)
    if required and proc.returncode:
        raise RuntimeError("S9 unavailable or private command failed: "+
                           str(proc.returncode)+" "+proc.stderr[-180:])
    return proc


def phone_json(path):
    data=adb("exec-out","cat",path,timeout=25).stdout
    if not 70<len(data)<140000:raise RuntimeError("Private feature sidecar invalid length")
    return json.loads(data)


def remote_sha(path):
    output=adb("shell","sha256sum "+path,timeout=40).stdout.split()
    if len(output)!=2 or not HEX.fullmatch(output[0]):
        raise RuntimeError("Missing phone-side SHA256")
    return output[0]


def remote_exists(path):
    # The only proven absence is remote "test -s" exit 1 with no ADB stderr.
    # Transport loss, shell permission errors or any other code must abort
    # rather than silently discarding original verified descriptor rows.
    result=adb("shell","test -s "+path,timeout=15,required=False)
    if result.returncode==0:return True
    if result.returncode==1 and not result.stderr.strip():return False
    raise RuntimeError("S9 sidecar presence indeterminate, aborting verification")


def safe_visual(key,cropsha):
    doc=phone_json(ROOT+"/features/"+key+"-visual.json")
    vec=doc.get("visual_embedding")
    if (doc.get("source_qualified_key")!=key
        or doc.get("model_sha256")!=VISUAL or doc.get("crop_sha256")!=cropsha
        or not isinstance(vec,list) or len(vec)!=512
        or not all(type(x) in (float,int) and math.isfinite(x) for x in vec)
        or abs(sum(x*x for x in vec)-1)>.001):
        raise RuntimeError("OSNet feature sidecar failed full provenance/L2 check")
    return True


def inventory(include_unreviewed=False):
    old=sibling("backfill-v40-person-rois-on-s9.py","s9_v40_uniform")
    # Preserve V2's exact legacy-approved source behaviour by default.
    # V3 archive expansion must use the newer zero-detection-aware temporal
    # controller, not the historical approved-only selector.
    new=(sibling("backfill-s9-original-roi-osnet-temporal-v2.py",
                 "s9_temporal_original_uniform") if include_unreviewed
         else sibling("backfill-s9-original-person-roi-osnet.py",
                      "s9_original_uniform"))
    source_map=old.record_index()
    items=old.catalog_items()
    lookup={}
    for item in items:
        crop=item.get("full_crop")
        clip=item.get("clip")
        if (isinstance(crop,dict) and isinstance(clip,str)
            and CLIP.fullmatch(clip) and crop.get("sha256")):
            lookup[(clip,crop["sha256"])]=crop
    result=[]
    for row in old.planned(items,source_map):
        if row["source"]!=SOURCE:continue
        candidates=[(clip,crop) for (clip,digest),crop in lookup.items()
                    if digest==row["crop_sha256"]
                    and hashlib.sha256("\x00".join((SOURCE,clip,digest)).encode()).hexdigest()==row["source_key"]]
        if len(candidates)!=1:raise RuntimeError("Ambiguous V40 full-person source")
        clip,crop=candidates[0]
        result.append({"key":row["source_key"],"clip":clip,
                       "crop_sha256":row["crop_sha256"],
                       "crop_name":row["crop_name"],
                       "crop_bytes":row["crop_bytes"],"cohort":"v40"})
    events=new.primary_events()
    approved=new.approved_names()
    # Optional v3 inventory additionally includes recovered unassigned clips.
    # Prior V2 callers retain the approved-only source cohort unchanged.
    mode="archive" if include_unreviewed else "approved"
    for _,clip,_ in new.candidates(events,approved,mode):
        key=hashlib.sha256(("s9_sd\x00"+clip).encode()).hexdigest()
        sidecar=ROOT+"/features/"+key+"-detector.json"
        if (not remote_exists(sidecar) or
            not remote_exists(ROOT+"/features/"+key+"-visual.json")):
            # A partial extractor run is never reported as a verified vector.
            continue
        meta=phone_json(sidecar)
        sha=meta.get("crop_sha256")
        if (meta.get("schema")!="s9_offline_single_person_roi_v1"
            or meta.get("source")!=SOURCE or meta.get("source_clip")!=clip
            or meta.get("source_qualified_key")!=key
            or meta.get("detector_sha256")!=DETECT
            or meta.get("identity_verified") is not False
            or not isinstance(sha,str) or not HEX.fullmatch(sha)):
            raise RuntimeError("Newer S9 person crop provenance invalid")
        result.append({"key":key,"clip":clip,"crop_sha256":sha,
                       "crop_name":key+".jpg","crop_bytes":None,
                       "cohort":"approved_new" if clip in approved else "archive_unassigned"})
    if len(result)<51 or len(result)>400:
        raise RuntimeError("Missing verified V40/approved crop cohort")
    if len(set(x["key"] for x in result))!=len(result):
        raise RuntimeError("Duplicate source-qualified crop keys")
    return sorted(result,key=lambda x:(x["cohort"],x["key"]))


def ensure_crop(row):
    key=row["key"]
    inbox=ROOT+"/inbox/"+key+".jpg"
    if remote_exists(inbox):
        if remote_sha(inbox)!=row["crop_sha256"]:
            raise RuntimeError("Existing private original crop digest differs")
        return inbox,False
    if row["cohort"]!="v40":
        raise RuntimeError("S9 original crop missing; never fabricate or replace")
    # Rehydrate only the verified original V40 JPEG, without modifying it.
    endpoint=API+"/new/api/visual-review/crop/"+urllib.parse.quote(row["crop_name"],safe="")
    with urllib.request.urlopen(endpoint,timeout=33) as response:
        if response.status!=200:raise RuntimeError("V40 crop API missing")
        image=response.read(2_000_001)
    if (len(image)!=row["crop_bytes"]
        or not image.startswith(b"\xff\xd8")
        or hashlib.sha256(image).hexdigest()!=row["crop_sha256"]):
        raise RuntimeError("V40 original crop SHA/length mismatch")
    with tempfile.TemporaryDirectory(prefix="s9-hsv-full-person-") as folder:
        file=Path(folder)/"full-person.jpg"
        file.write_bytes(image)
        adb("shell","mkdir -p "+ROOT+"/inbox "+ROOT+"/features",timeout=15)
        pending=inbox+".hsv-v2-pending"
        try:
            adb("push",str(file),pending,timeout=35)
            if remote_sha(pending)!=row["crop_sha256"]:
                raise RuntimeError("Phone transfer digest mismatch")
            adb("shell","mv "+pending+" "+inbox+"; chmod 600 "+inbox,timeout=20)
            if remote_sha(inbox)!=row["crop_sha256"]:
                raise RuntimeError("Private crop digest mismatch")
        finally:
            adb("shell","rm -f "+pending,required=False,timeout=15)
    return inbox,True


def v2_histogram(row):
    output=ROOT+"/features/"+row["key"]+"-hsv-v2.json"
    if not remote_exists(output):
        inbox,staged=ensure_crop(row)
        try:
            command=("export CLASSPATH="+ROOT+"/s9-torso-hsv-v2.jar; "
              "app_process /system/bin nl.kalenel.s9offline.S9OfflineTorsoHistogramV2 "
              "--extract "+inbox+" "+output+" "+row["key"]+" "+row["crop_sha256"])
            value=adb("shell",command,timeout=75).stdout
            if "S9_UNIFORM_TORSO_HSV32_V2_WRITTEN" not in value:
                raise RuntimeError("Phone histogram generator did not verify")
        finally:
            if staged:
                # Only erase our temporary private copy; NEVER original
                # archived crop, video, already persisted feature or review.
                adb("shell","rm -f "+inbox,timeout=15,required=False)
    doc=phone_json(output)
    bins=doc.get("upper_hsv32")
    if (doc.get("schema")!="s9_uniform_upper_torso_hsv32_v2"
        or doc.get("method")!=METHOD
        or doc.get("source_qualified_key")!=row["key"]
        or doc.get("crop_sha256")!=row["crop_sha256"]
        or doc.get("verified_same_person") is not False
        or doc.get("human_review_required") is not True
        or doc.get("identity_probability") is not False
        or not isinstance(bins,list) or len(bins)!=32
        or not all(type(x) in (float,int) and math.isfinite(x) and 0<=x<=1 for x in bins)
        or abs(sum(bins)-1)>0.0001):
        raise RuntimeError("Uniform v2 histogram sidecar invalid")
    safe_visual(row["key"],row["crop_sha256"])
    return "verified_histogram_and_osnet"


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--write",action="store_true")
    parser.add_argument("--include-unreviewed",action="store_true",
        help="V3-only: include provenance-verified, unassigned archive crops")
    parser.add_argument("--missing-only",action="store_true",
        help="Only compute absent uniform HSV32 sidecars (for bounded V3 runs)")
    parser.add_argument("--offset",type=int,default=0)
    parser.add_argument("--limit",type=int,default=5)
    opts=parser.parse_args()
    if opts.offset<0 or not 1<=opts.limit<=10:
        raise ValueError("Only small v2 backfill batches accepted")
    catalog=inventory(include_unreviewed=opts.include_unreviewed)
    if opts.missing_only:
        if not opts.include_unreviewed or opts.offset!=0:
            raise RuntimeError("Missing-only is reserved for V3 archive mode at offset zero")
        catalog=[r for r in catalog if not remote_exists(
            ROOT+"/features/"+r["key"]+"-hsv-v2.json")]
    chosen=catalog[opts.offset:opts.offset+opts.limit]
    if not opts.write:
        print("S9_HSV32_V2_BACKFILL_DRY_RUN "+json.dumps({
            "verified_full_person_crops":len(catalog),
            "cohorts":dict(Counter(r["cohort"] for r in catalog)),
            "selected":len(chosen),"offset":opts.offset,
            "histograms_generated":0,"v1_rankings_changed":False,
            "include_unreviewed":opts.include_unreviewed,
            "missing_only":opts.missing_only}),flush=True)
        return
    initial=adb("shell","pidof nl.kalenel.s9security",timeout=20).stdout.strip()
    if not re.fullmatch(r"[0-9 ]+",initial):
        raise RuntimeError("Camera2 PID not available")
    if not remote_exists(ROOT+"/s9-torso-hsv-v2.jar"):
        raise RuntimeError("Standalone S9 descriptor DEX not yet installed")
    thermal=adb("shell","dumpsys battery",timeout=20).stdout
    m=re.search(r"temperature:\s*(\d+)",thermal)
    if m is None or int(m.group(1))>420:
        raise RuntimeError("Battery temperature above guarded 42C threshold")
    summary=Counter()
    for row in chosen:
        try:summary[v2_histogram(row)]+=1
        except Exception as e:
            summary["failed_"+type(e).__name__]+=1
            break
    after=adb("shell","pidof nl.kalenel.s9security",timeout=20).stdout.strip()
    if after!=initial:raise RuntimeError("Camera2 PID changed")
    print("S9_HSV32_V2_BACKFILL_VERIFIED "+json.dumps({
        "selected":len(chosen),"offset":opts.offset,"counts":dict(summary),
        "phone_battery_initial_c":int(m.group(1))/10,
        "missing_only":opts.missing_only,
        "v1_rankings_changed":False,"camera_apk_modified":False,
        "recordings_modified":False,"human_reviews_modified":False}),flush=True)
    if any(x.startswith("failed_") for x in summary):
        raise RuntimeError("Incomplete v2 histogram group; inspect before retry")


if __name__=="__main__":main()
