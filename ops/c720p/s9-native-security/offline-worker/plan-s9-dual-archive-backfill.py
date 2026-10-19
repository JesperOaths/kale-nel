#!/usr/bin/env python3
"""Read-only, source-qualified inventory for the isolated S9+ feature backfill.

This planner does NOT generate embeddings, assign people, erase crop records,
modify camera state, download videos, or claim that cropped JPEGs are aligned.
It reconciles raw S9 SD MP4 and JPEG inventory with authenticated SD/Drive
catalog metadata; including records outside the current 175-clip SD catalog.
Outputs a private, append-only-ready JSONL work plan only when requested.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.request

ROOT="http://127.0.0.1:8795"
S9="192.168.178.250:5555"
PHONE_DIR="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K"
PHONE_OUT="/data/local/tmp/s9_worker"
CLIP_RE=re.compile(r"^[A-Za-z0-9][A-Za-z0-9_. ()-]{0,230}[.](?i:mp4|mov|mkv|avi)$")
DRIVE_RE=CLIP_RE
MAX_CATALOG=50000
MAX_LIST=50000


def get_events(route):
    with urllib.request.urlopen(ROOT+route,timeout=28) as response:
        if response.status != 200:raise RuntimeError("Catalog not available")
        doc=json.loads(response.read(8000000))
    if doc.get("ok") is not True or not isinstance(doc.get("events"),list):
        raise RuntimeError("Unverified catalog response")
    events=doc["events"]
    if len(events)>MAX_CATALOG:raise RuntimeError("Oversized source catalog")
    return events


def remote_list():
    p=subprocess.run(["adb","-s",S9,"shell","ls "+PHONE_DIR],
                     capture_output=True,text=True,timeout=35)
    if p.returncode:raise RuntimeError("S9 SD archive listing unavailable")
    names=[s.strip() for s in p.stdout.splitlines() if s.strip()]
    if len(names)>MAX_LIST or len(set(names))!=len(names):
        raise RuntimeError("Unsafe or duplicated SD directory listing")
    return set(names)


def safe_clip(item,source):
    rule=CLIP_RE if source=="s9_sd" else DRIVE_RE
    # Historical Google Drive uses integer clip_no; remote_name is the
    # actual filename. Do not confuse source-scoped database ID with filename.
    for raw in (item.get("clip_no"),item.get("remote_name")):
        if (isinstance(raw,str) and raw and "/" not in raw
            and "\\" not in raw and ".." not in raw and rule.fullmatch(raw)):
            return raw
    return None


def one_row(source,clip,artifact="",kind="recording",
            status="awaiting_inference",inspection_only=False,exists=False,
            source_id=None):
    if source not in ("s9_sd","gdrive_archive"):
        raise ValueError("Unexpected provenance source")
    pattern=CLIP_RE if source=="s9_sd" else DRIVE_RE
    if not pattern.fullmatch(clip) or ".." in clip:
        raise ValueError("Unsafe clip reference")
    if artifact and (len(artifact)>240 or not re.fullmatch(r"[A-Za-z0-9_.-]+",artifact)):
        raise ValueError("Unsafe crop/thumbnail reference")
    source_id=str(source_id if source_id is not None else clip)
    if len(source_id)>240 or not source_id or "/" in source_id or "\\" in source_id:
        raise ValueError("Unsafe source-scoped identifier")
    key=hashlib.sha256(("\0".join((source,source_id,kind,artifact))).encode()).hexdigest()
    return {
        "key":key,"source":source,"source_id":source_id,"clip":clip,
        "crop_ref":artifact or None,"kind":kind,
        "inspection_only":bool(inspection_only),
        "original_on_s9":bool(exists),
        "feature_schema":"s9_person_appearance_features_v1",
        "visual_embedding":None,"structural_crop_embedding":None,
        "embedding_status":status,"human_review_required":True,
        "verified_same_person":False,"model_ready":False,
        "source_identity_probability":False,
    }


def plan(sd_events,drive_events,sd_files):
    raw_mp4={v for v in sd_files if CLIP_RE.fullmatch(v) and ".." not in v}
    sd_indexed={v for x in sd_events if (v:=safe_clip(x,"s9_sd"))}
    drive_rows=[(x,v) for x in drive_events
                if (v:=safe_clip(x,"gdrive_archive"))]
    drive_indexed={v for _,v in drive_rows}
    # Do not reject an index entry when its original is missing. This is
    # evidence requiring repair, not permission to delete an old crop record.
    all_sd=raw_mp4 | sd_indexed
    rows=[one_row("s9_sd",clip,status=("awaiting_inference"
              if clip in raw_mp4 else "original_missing_or_unmounted"),
              exists=clip in raw_mp4) for clip in sorted(all_sd)]
    rows += [one_row("gdrive_archive",clip,status="drive_requires_verified_source_decode",
             exists=False,source_id=item.get("clip_no") if isinstance(item.get("clip_no"),int)
             else clip) for item,clip in drive_rows]
    # Existing sidecars and crop JPEGs are preserved without parsing their
    # identity content. Even an inspection-only crop remains indexed as such.
    stems=sorted(((clip[:-4],clip) for clip in all_sd if clip.lower().endswith(".mp4")),
                 key=lambda pair:len(pair[0]),reverse=True)
    for filename in sorted(sd_files):
        if not filename.lower().endswith(".jpg"):
            continue
        if filename.endswith(".thumb.jpg") or filename.startswith("preview_motion_"):
            continue
        # Preserve unusual legacy/inspection crops as unlinked records rather
        # than silently discarding them or assigning an invented parent.
        clip=next((item for stem,item in stems
                   if filename.startswith((stem+"__",stem+".",stem+"-",stem+"_"))),
                  None)
        if clip is None:
            # Unknown crop provenance stays explicit and non-comparable.
            clip="unlinked_recording.mp4"
        rows.append(one_row("s9_sd",clip,filename,"saved_crop",
                            "inspection_only_unverified_alignment",
                            inspection_only=True,exists=clip in raw_mp4))
    # Catalog snapshot references can be relevant even when the physical
    # JPEG was moved. Preserve metadata references, never drop missing crops.
    for source,events in (("s9_sd",sd_events),("gdrive_archive",drive_events)):
        for event in events:
            clip=safe_clip(event,source)
            if clip is None:continue
            snapshot=event.get("snapshot_name")
            if (isinstance(snapshot,str)
                and re.fullmatch(r"[A-Za-z0-9_.-]{1,240}",snapshot)):
                rows.append(one_row(source,clip,snapshot,"catalog_snapshot",
                  "not_an_aligned_face_evidence",
                  inspection_only=True,exists=source=="s9_sd" and snapshot in sd_files,
                  source_id=(event.get("clip_no") if source=="gdrive_archive"
                             and isinstance(event.get("clip_no"),int) else clip)))
    distinct={}
    for row in rows:distinct[row["key"]]=row
    return list(sorted(distinct.values(),key=lambda x:(x["source"],x["clip"],x["kind"],str(x["crop_ref"])))),{
        "sd_raw_mp4":len(raw_mp4),
        "sd_catalog_clips":len(sd_indexed),
        "sd_raw_not_in_catalog":len(raw_mp4-sd_indexed),
        "sd_catalog_missing_original":len(sd_indexed-raw_mp4),
        "drive_catalog_clips":len(drive_rows),
        "drive_distinct_filenames":len(drive_indexed),
        "source_qualified_recordings":len(all_sd)+len(drive_rows),
        "saved_crop_or_snapshot_rows":sum(bool(x["crop_ref"]) for x in distinct.values()),
        "inspection_only_rows":sum(x["inspection_only"] for x in distinct.values()),
    }


def write_private(rows,destination):
    path=Path(destination)
    if path.is_symlink() or path.exists():
        raise RuntimeError("Refuse overwrite/symlink: append-only work-plan versions")
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,name=tempfile.mkstemp(prefix=".s9-backfill-",dir=path.parent)
    try:
        with os.fdopen(fd,"w",encoding="utf-8") as w:
            for row in rows:w.write(json.dumps(row,sort_keys=True,separators=(",",":"))+"\n")
            w.flush();os.fsync(w.fileno())
        os.chmod(name,0o600)
        os.replace(name,path)
    finally:
        if os.path.exists(name):os.unlink(name)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--write-plan",type=Path,default=None)
    args=parser.parse_args()
    sd_events=get_events("/new/api/saved")
    drive_events=get_events("/new/api/drive-saved")
    files=remote_list()
    rows,stats=plan(sd_events,drive_events,files)
    if len(rows)<len(sd_events)+len(drive_events):
        raise RuntimeError("Catalog records unexpectedly missing from work plan")
    if args.write_plan:
        stats["plan_sha256"]=write_private(rows,args.write_plan)
        stats["plan_written"]=True
    else:stats["plan_written"]=False
    print("S9_DUAL_ARCHIVE_BACKFILL_PLAN_VERIFIED "+json.dumps({
        **stats,"rows":len(rows),
        "existing_recordings_or_crops_modified":False,
        "embeddings_created":False,"camera_apk_changed":False,
        "auto_identity_grouping_enabled":False}),flush=True)


if __name__=="__main__":
    main()
