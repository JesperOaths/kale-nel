#!/usr/bin/env python3
"""Aggregate failure categories for unchanged offline phone person-ROI detector.

C720P only fetches private catalog metadata and starts independent app_process
on S9+; the phone decodes up to three frames from stored original MP4.
No images, bounding boxes, source IDs or video data cross back to C720P.
"""
import argparse
from collections import Counter
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys

DIR=Path(__file__).resolve().parent
ROOT="/data/local/tmp/s9_worker"
PHONE="192.168.178.250:5555"
ARCHIVE="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K/"
DETECT="e4b118e5e4531945de2e659742c7c590f7536f8d0ed26d135abcfe83b4779d13"
LABEL="c7e79c855f73cbba9f33d649d60e1676eb0a974021a41696d1ac0d4b7f7e0211"
REASONS={
  "video_frame_unavailable","no_person_above_045",
  "multiple_people_above_045","person_confidence_045_to_056",
  "invalid_person_coordinates","person_box_clipped_by_frame_edge",
  "person_box_too_small","person_box_aspect_invalid",
  "person_box_area_too_small","eligible_single_full_person",
}
MARK="S9_OFFLINE_ROI_REJECTION_AUDIT "


def backing():
    helper=DIR/"backfill-s9-original-person-roi-osnet.py"
    if not helper.is_file():raise RuntimeError("Pinned real-source helper missing")
    spec=importlib.util.spec_from_file_location("original_roi_inventory",helper)
    mod=importlib.util.module_from_spec(spec)
    sys.modules[spec.name]=mod
    spec.loader.exec_module(mod)
    return mod


def adb(*args,timeout=100):
    p=subprocess.run(["adb","-s",PHONE,*args],capture_output=True,
                     text=True,timeout=timeout)
    if p.returncode:
        raise RuntimeError("Independent S9 diagnostics failed, exit "+
                           str(p.returncode))
    return p.stdout.strip()


def source_selection(mode,offset,limit):
    m=backing()
    events=m.primary_events()
    approved=m.approved_names()
    selected=m.candidates(events,approved,mode)
    return events,selected[offset:offset+limit],len(selected)


def readiness():
    camera=adb("shell","pidof nl.kalenel.s9security",timeout=16)
    if not re.fullmatch(r"[0-9 ]+",camera):
        raise RuntimeError("Camera2 not running")
    battery=adb("shell","dumpsys battery",timeout=14)
    match=re.search(r"temperature:\s*(\d+)",battery)
    if not match or int(match.group(1))>420:
        raise RuntimeError("Phone thermal cutoff >42C")
    if not adb("shell","sha256sum "+ROOT+"/models/person_detect.tflite",timeout=30).startswith(DETECT):
        raise RuntimeError("Detector SHA mismatch")
    if not adb("shell","sha256sum "+ROOT+"/models/labelmap.txt",timeout=30).startswith(LABEL):
        raise RuntimeError("Labelmap SHA mismatch")
    jar=adb("shell","sha256sum "+ROOT+"/s9-offline-person-roi-audit-v1.jar",timeout=25)
    if not re.fullmatch(r"[a-f0-9]{64}\s+.+",jar):
        raise RuntimeError("Independent diagnostic class DEX unavailable")
    return camera,int(match.group(1))/10


def audit_one(clip):
    if not re.fullmatch(r"motion_[0-9]{13}[.]mp4",clip):
        raise RuntimeError("Unsafe source clip")
    command=("export CLASSPATH="+ROOT+"/s9-offline-person-roi-audit-v1.jar; "
      "export LD_LIBRARY_PATH="+ROOT+"/lib; "
      "app_process -Djava.library.path="+ROOT+"/lib /system/bin "
      "nl.kalenel.s9offline.S9StandalonePersonRoiAudit --audit "+
      ARCHIVE+clip)
    output=adb("shell",command,timeout=140)
    lines=[line[len(MARK):] for line in output.splitlines()
           if line.startswith(MARK)]
    if len(lines)!=1:raise RuntimeError("Read-only detector rejected private original")
    doc=json.loads(lines[0])
    reasons=doc.get("categories")
    if (doc.get("schema")!="s9_roi_rejection_audit_v1"
        or doc.get("source")!="s9_sd"
        or doc.get("frames_requested")!=3
        or doc.get("frames_scanned")!=3
        or doc.get("recordings_modified") is not False
        or doc.get("person_assignment_modified") is not False
        or doc.get("crop_images_saved")!=0
        or not isinstance(reasons,dict)
        or set(reasons)-REASONS
        or any(type(n)!=int or n<0 or n>3 for n in reasons.values())
        or sum(reasons.values())!=3):
        raise RuntimeError("Phone rejection-reason response failed strict schema")
    return reasons


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--run",action="store_true")
    p.add_argument("--mode",choices=("approved","person"),default="person")
    p.add_argument("--offset",type=int,default=0)
    p.add_argument("--limit",type=int,default=5)
    opts=p.parse_args()
    if opts.offset<0 or not 1<=opts.limit<=5:
        raise RuntimeError("Read-only diagnostic limited to five archived originals")
    events,selected,total=source_selection(opts.mode,opts.offset,opts.limit)
    if not opts.run:
        print("S9_ROI_REJECTION_DIAGNOSTICS_PREFLIGHT "+json.dumps({
          "primary_originals":len(events),"eligible_for_mode":total,
          "selected":len(selected),"offset":opts.offset,
          "images_exported":0,"recordings_modified":False}),flush=True)
        return
    initial,temp=readiness()
    summary=Counter()
    clips=0
    for _,clip,_ in selected:
        summary.update(audit_one(clip))
        clips+=1
    if adb("shell","pidof nl.kalenel.s9security",timeout=15)!=initial:
        raise RuntimeError("Camera2 process changed unexpectedly")
    if not set(events).issubset(backing().primary_events()):
        raise RuntimeError("A primary original disappeared")
    print("S9_ROI_REJECTION_DIAGNOSTICS_AGGREGATE "+json.dumps({
       "scanned_originals":clips,"scanned_frames":clips*3,
       "categories":dict(sorted(summary.items())),
       "initial_phone_battery_c":temp,
       "images_exported":0,"camera_apk_changed":False,
       "recordings_modified":False,"manual_review_changes":0}),flush=True)


if __name__=="__main__":main()
