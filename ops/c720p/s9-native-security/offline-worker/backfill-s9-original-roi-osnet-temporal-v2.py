#!/usr/bin/env python3
"""Bounded live-source-verified standalone S9+ person crop -> OSNet backfill.

The C720P orchestrates by reading archive/review catalogs and running ADB
commands. It NEVER decodes a recording, runs Torch/ONNX, downloads videos or
selects a guessed identity. All SSD detection and OSNet inference run in
separate app_process processes on the S9+ from already saved originals.
Each generated JPEG, ROI provenance and embedding is append-only.
"""
import argparse
import hashlib
import json
import math
from pathlib import PurePosixPath
import re
import subprocess
import urllib.parse
import urllib.request

PHONE="192.168.178.250:5555"
BASE="http://127.0.0.1:8795"
ROOT="/data/local/tmp/s9_worker"
VIDEO="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K/"
OSNET="/storage/9C33-6BBD/S9OfflineModels/visual_backbone_512d.onnx"
OSNET_SHA="ee5717ad7a90cf0c915afa1fb6a5399b966562c5d42aa6f4a0c6c84a5349e47d"
DETECT_SHA="e4b118e5e4531945de2e659742c7c590f7536f8d0ed26d135abcfe83b4779d13"
CLIP=re.compile(r"motion_[0-9]{13}[.]mp4\Z")
KEY=re.compile(r"[a-f0-9]{64}\Z")


def request(endpoint,limit=6_000_000):
    with urllib.request.urlopen(BASE+endpoint,timeout=34) as r:
        if r.status!=200:raise RuntimeError("Verified archive API unavailable")
        payload=r.read(limit+1)
    if len(payload)>limit:raise RuntimeError("Archive response exceeds bound")
    value=json.loads(payload)
    if value.get("ok") is not True:
        raise RuntimeError("Archive source not verified")
    return value


def adb(*args,timeout=80,check=True):
    proc=subprocess.run(["adb","-s",PHONE,*args],capture_output=True,
                        text=True,timeout=timeout)
    if check and proc.returncode:
        raise RuntimeError("Phone-side operation failed, code="+str(proc.returncode)
                           +" reason="+proc.stderr[-150:])
    return proc


def get_person_count(record):
    number=record.get("person_count")
    return number if type(number) is int and number>=0 else 0


def primary_events():
    doc=request("/new/api/saved")
    if doc.get("archive_mode")!="S9-microSD-only":
        raise RuntimeError("Unexpected archive source")
    events={}
    for event in doc.get("events",[]):
        clip=event.get("clip_no")
        if isinstance(clip,str) and CLIP.fullmatch(clip):
            if clip in events:raise RuntimeError("Duplicate primary original")
            events[clip]=event
    if len(events)<150:raise RuntimeError("Incomplete S9 verified catalog")
    return events


def approved_names():
    """Reference originals from manual explicit links + all verified V40 pages."""
    manual=request("/new/api/s9-manual-recording-links")
    if manual.get("manual_links_only") is not True or not isinstance(manual.get("items"),dict):
        raise RuntimeError("Manual review provenance index unavailable")
    assigned=set()
    for code,entry in manual["items"].items():
        if not code.startswith("sd:") or not isinstance(entry,dict):
            continue
        clip=code[3:]
        if CLIP.fullmatch(clip) and entry.get("folder") is not None:
            assigned.add(clip)
    doc=request("/new/api/visual-review?workflow=clip_folders_v40&tab=all&offset=0&limit=100")
    folders=doc.get("folders")
    if not isinstance(folders,list):raise RuntimeError("Saved-person folders unavailable")
    for folder in folders:
        if not isinstance(folder,dict) or folder.get("id") is None:continue
        offset=0
        for _ in range(250):
            query=urllib.parse.urlencode({
                "workflow":"clip_folders_v40","tab":"approved",
                "folder":str(folder["id"]),"offset":offset,"limit":24})
            page=request("/new/api/visual-review?"+query)
            records=page.get("items")
            if not isinstance(records,list):raise RuntimeError("Unverified approved page")
            for item in records:
                clip=item.get("clip")
                if isinstance(clip,str) and CLIP.fullmatch(clip):
                    assigned.add(clip)
            total=page.get("total")
            if type(total) is not int or total>5000:
                raise RuntimeError("Approved index bounds invalid")
            offset+=len(records)
            if offset>=total:break
            if not records:raise RuntimeError("Approved index pagination truncated")
        else:raise RuntimeError("Too many approved reference pages")
    return assigned


def candidates(events,approved,mode):
    records=[]
    for clip,record in events.items():
        isapproved=clip in approved
        if mode=="approved" and not isapproved:continue
        if mode=="person" and get_person_count(record)!=1:continue
        if (get_person_count(record)!=1 or
            (record.get("frames_with_distinct_multiple_person_boxes") or 0)>0):
            continue
        records.append((not isapproved,clip,record))
    records.sort(key=lambda x:(x[0],x[1]))
    return records


def readiness():
    camera=adb("shell","pidof nl.kalenel.s9security",timeout=15).stdout.strip()
    if not re.fullmatch(r"[0-9 ]+",camera):
        raise RuntimeError("Live camera PID unavailable; refusing offline backfill")
    for name,expected in (
       (ROOT+"/models/person_detect.tflite",DETECT_SHA),
       (OSNET,OSNET_SHA)):
        observed=adb("shell","sha256sum "+name,timeout=75).stdout.split()[0]
        if observed!=expected:raise RuntimeError("Required S9 model integrity failed")
    # New class is append-only and deliberately does not replace the tested
    # three-frame source detector.
    for name in ("s9-offline-person-roi-temporal-v2.jar","s9-crop-worker.jar"):
        if adb("shell","test -s "+ROOT+"/"+name,check=False).returncode:
            raise RuntimeError("Standalone detector/OSNet DEX missing")
    temp=adb("shell","dumpsys battery",timeout=15).stdout
    match=re.search(r"temperature:\s*(\d+)",temp)
    if not match:raise RuntimeError("Phone thermal telemetry unavailable")
    celsius=int(match.group(1))/10
    if celsius>42:
        raise RuntimeError("Phone battery temperature above 42 C; retry later")
    return camera,celsius


def assert_camera_safe(expected_pid):
    """Fail closed between archived clips, not just at both ends of a batch."""
    observed=adb("shell","pidof nl.kalenel.s9security",timeout=15).stdout.strip()
    if observed!=expected_pid:
        raise RuntimeError("Camera2 process changed during offline backfill")
    report=adb("shell","dumpsys battery",timeout=15).stdout
    match=re.search(r"temperature:\s*(\d+)",report)
    if match is None:
        raise RuntimeError("Phone thermal telemetry unavailable")
    temperature=int(match.group(1))/10
    if temperature>42:
        raise RuntimeError("Phone battery temperature above 42 C; stop batch")
    return temperature


def detector_provenance(clip,key,metadata):
    """Require the immutable ROI source record before trusting any embedding."""
    record=json.loads(adb("exec-out","cat",metadata,timeout=20).stdout)
    sha=record.get("crop_sha256") if isinstance(record,dict) else None
    if (not isinstance(record,dict)
        or record.get("schema")!="s9_offline_single_person_roi_v1"
        or record.get("source")!="s9_sd"
        or record.get("source_clip")!=clip
        or record.get("source_qualified_key")!=key
        or record.get("detector_sha256")!=DETECT_SHA
        or record.get("identity_verified") is not False
        or record.get("requires_human_review") is not True
        or not isinstance(sha,str) or not KEY.fullmatch(sha)):
        raise RuntimeError("Untrusted detector ROI provenance")
    return sha


def valid_visual(doc,key,crop_sha):
    """Reject nonfinite, fabricated or unrelated existing OSNet sidecars."""
    if not isinstance(doc,dict):return False
    vec=doc.get("visual_embedding")
    return (
        doc.get("schema")=="s9_offline_appearance_embedding_v1"
        and doc.get("source_qualified_key")==key
        and doc.get("crop_sha256")==crop_sha
        and doc.get("model_sha256")==OSNET_SHA
        and doc.get("model_type")=="visual"
        and doc.get("appearance_only") is True
        and doc.get("human_review_required") is True
        and doc.get("verified_same_person") is False
        and isinstance(vec,list) and len(vec)==512
        and all(type(x) in (float,int) and math.isfinite(x) for x in vec)
        and abs(sum(x*x for x in vec)-1)<=0.001
    )


def compute_one(clip):
    key=hashlib.sha256(("s9_sd\x00"+clip).encode()).hexdigest()
    if not KEY.fullmatch(key):raise RuntimeError("Invalid source qualified key")
    roi=ROOT+"/inbox/"+key+".jpg"
    metadata=ROOT+"/features/"+key+"-detector.json"
    sidecar=ROOT+"/features/"+key+"-visual.json"
    existing=adb("shell","test -s "+sidecar,check=False)
    if existing.returncode==0:
        # Previously generated features count only if detector provenance and
        # the full normalized model output are independently validated.
        sha=detector_provenance(clip,key,metadata)
        obj=json.loads(adb("exec-out","cat",sidecar,timeout=25).stdout)
        if not valid_visual(obj,key,sha):
            raise RuntimeError("Previously staged vector failed integrity checks")
        return "already_verified"
    if adb("shell","test -e "+metadata,check=False).returncode!=0:
        detector=("export LD_LIBRARY_PATH="+ROOT+"/lib; "
                  "export CLASSPATH="+ROOT+"/s9-offline-person-roi-temporal-v2.jar; "
                  "app_process -Djava.library.path="+ROOT+"/lib /system/bin "
                  "nl.kalenel.s9offline.S9StandalonePersonRoiTemporalV2 --extract "
                  +VIDEO+clip+" "+roi+" "+metadata+" "+key)
        result=adb("shell",detector,timeout=135)
        if "S9_OFFLINE_SINGLE_PERSON_ROI_NOT_FOUND" in result.stdout:
            return "no_qualified_person_box"
        if "S9_OFFLINE_SINGLE_PERSON_ROI_STAGED" not in result.stdout:
            raise RuntimeError("Detector did not confirm private crop staging")
    sha=detector_provenance(clip,key,metadata)
    if adb("shell","sha256sum "+roi,timeout=25).stdout.split()[0]!=sha:
        raise RuntimeError("Detector crop checksum mismatch")
    onnx=("export LD_LIBRARY_PATH="+ROOT+"/lib; "
          "export CLASSPATH="+ROOT+"/s9-crop-worker.jar; "
          "app_process -Djava.library.path="+ROOT+"/lib /system/bin "
          "nl.kalenel.s9offline.S9OnnxCropWorker --extract visual "
          +OSNET+" "+roi+" "+sidecar+" "+key+" "+sha)
    out=adb("shell",onnx,timeout=145)
    if "S9_OFFLINE_REAL_CROP_512D_PERSISTED visual" not in out.stdout:
        raise RuntimeError("Phone OSNet did not persist verified 512-D descriptor")
    doc=json.loads(adb("exec-out","cat",sidecar,timeout=25).stdout)
    if not valid_visual(doc,key,sha):
        raise RuntimeError("Phone OSNet real-vector readback failed")
    return "new_real_512d_vector"


def main():
    opts=argparse.ArgumentParser()
    opts.add_argument("--apply",action="store_true")
    opts.add_argument("--mode",choices=("approved","person","all"),default="approved")
    opts.add_argument("--limit",type=int,default=1)
    opts.add_argument("--offset",type=int,default=0)
    args=opts.parse_args()
    if args.offset<0 or not 1<=args.limit<=5:
        raise RuntimeError("Only bounded batches of up to 5 originals")
    events=primary_events()
    approved=approved_names()
    selected=candidates(events,approved,args.mode)
    current=selected[args.offset:args.offset+args.limit]
    if not args.apply:
        print("S9_TEMPORAL_FALLBACK_ROI_OSNET_BACKFILL_DRY_RUN "+json.dumps({
          "primary_originals":len(events),"approved_originals":len(approved),
          "eligible_for_mode":len(selected),"selected_count":len(current),
          "mode":args.mode,"vectors_written":0,
          "camera_or_review_modified":False}),flush=True)
        return
    camera,temp=readiness()
    temperatures=[temp]
    counts={}
    for _,clip,_ in current:
        try:
            temperatures.append(assert_camera_safe(camera))
            status=compute_one(clip)
            temperatures.append(assert_camera_safe(camera))
        except Exception as e:
            counts["failed_"+type(e).__name__]=counts.get("failed_"+type(e).__name__,0)+1
            break
        counts[status]=counts.get(status,0)+1
    if adb("shell","pidof nl.kalenel.s9security",timeout=15).stdout.strip()!=camera:
        raise RuntimeError("Live camera PID changed during offline model work")
    if not set(events).issubset(primary_events()):
        raise RuntimeError("One or more saved originals disappeared")
    print("S9_TEMPORAL_FALLBACK_ROI_OSNET_BACKFILL_BATCH "+json.dumps({
       "eligible":len(selected),"offset":args.offset,
       "attempted":sum(counts.values()),"counts":counts,
       "phone_temp_initial_c":temp,
       "phone_temp_max_checked_c":max(temperatures),
       "thermal_checked_between_clips":True,
       "model_execution_location":"Samsung_S9_plus",
       "human_review_required":True,
       "camera_apk_modified":False,"recordings_modified":False,
       "review_decisions_modified":False}),flush=True)
    if any(x.startswith("failed_") for x in counts):
        raise RuntimeError("Phone detector/embedding backfill needs repair")


if __name__=="__main__":
    main()
