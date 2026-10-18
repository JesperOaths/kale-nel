#!/usr/bin/env python3
"""Fast, private, incremental index of NEW Camera2 4K clips.

The original catalog retains responsibility for historical reconciliation.
This metadata-only companion adds newly verified phone recordings without
waiting several minutes for a 271+ clip full rescan. No MP4 bytes copied,
no model inference on C720P, no video deletion or phone settings mutation.
"""
import datetime
import fcntl
import importlib.util
import json
import os
import re
import subprocess
import sys
from pathlib import Path
try:
    import phone_archive_catalog_v1 as phone_catalog
except ImportError:
    phone_catalog=None

ROOT=Path("/opt/homeassistant/config/www/frontyard-security-new")
INDEX=ROOT/"s9-phone-events.json"
CATALOG=Path("/home/jespern/c720p-home-hub/bin/c720p-s9-local-sd-catalog.py")
LOCK=Path("/home/jespern/c720p-home-hub/state/s9-fast-clip-index.lock")
CATALOG_LOCK=Path("/home/jespern/c720p-home-hub/state/s9-native-catalog.lock")
PHONE="192.168.178.250:5555"
FOLDER="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K"
VIDEO=re.compile(r"motion_[0-9]{13}[.]mp4\Z")
DIGEST=re.compile(r"[a-f0-9]{64}\Z")


MANIFEST_MAX_BYTES=32768

def decode_manifest(raw):
 if not isinstance(raw,bytes) or len(raw)>MANIFEST_MAX_BYTES:
  raise ValueError("manifest_too_large_or_invalid")
 value=json.loads(raw)
 if not isinstance(value,dict):raise ValueError("manifest_not_object")
 return value

def adb(*args,limit=160000,timeout=17):
    proc=subprocess.run(["adb","-s",PHONE,*args],stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,timeout=timeout)
    if proc.returncode:raise RuntimeError("phone_adb_error")
    if len(proc.stdout)>limit:raise RuntimeError("phone_metadata_too_large")
    return proc.stdout

def module():
    spec=importlib.util.spec_from_file_location("s9_original_sd_catalog",str(CATALOG))
    if not spec or not spec.loader:raise RuntimeError("catalog_missing")
    m=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

def row_from_manifest(name,m,actual_bytes,thumb,helpers):
    if not VIDEO.fullmatch(name) or not isinstance(m,dict):raise ValueError("invalid_name")
    size=m.get("bytes")
    if type(size) is not int or not 100000<size<800000000 or actual_bytes!=size:
        raise ValueError("incomplete_or_unsafe_video")
    sha=m.get("sha256")
    if m.get("name")!=name or not isinstance(sha,str) or not DIGEST.fullmatch(sha):
        raise ValueError("unverified_manifest")
    if m.get("width")!=3840 or m.get("height")!=2160:
        raise ValueError("not_4k")
    group=m.get("scene_category","motion_other")
    if group not in ("one_person","multiple_people","motion_other"):group="unreviewed"
    when=datetime.datetime.fromtimestamp(int(name.split("_")[1].split(".")[0])/1000)
    count=m.get("person_count",0)
    if type(count) is not int or not 0<=count<=20:count=0
    return {
        "name":name,"timestamp":when.strftime("%Y-%m-%d %H:%M"),
        "size":size,"drive_verified":False,"sd_verified":True,"sd_only":True,
        "scene_category":group,"person_count":count,
        **helpers.safe_native_detection_stats(m),
        **helpers.safe_capture_event_metadata(m,name),
        "thumbnail":thumb,"resolution":"3840x2160","codec":"H.264",
        "content_categories":m.get("categories",[]) if isinstance(m.get("categories"),list) else [],
        **helpers.anonymous_clip_metadata(m),
        **helpers.safe_face_review_metadata(m),
        "storage":"S9 native 4K Security microSD"
    }

def new_records(index, remote_names, helpers):
    records=index.get("phone_recordings")
    if not isinstance(records,list):raise ValueError("catalog_missing_rows")
    current={row.get("name") for row in records if isinstance(row,dict)}
    recent=sorted((x for x in remote_names if VIDEO.fullmatch(x) and x not in current),
        reverse=True)[:12]
    added=[]
    for name in recent:
        metadata=adb("exec-out","cat",FOLDER+"/"+name+".verified.json",limit=MANIFEST_MAX_BYTES)
        m=decode_manifest(metadata)
        size_raw=adb("shell","stat","-c","%s",FOLDER+"/"+name,limit=64)
        size=int(size_raw.strip())
        thumbnail=None
        try:
            img=adb("exec-out","cat",FOLDER+"/"+name+".thumb.jpg",limit=2200000)
            if img[:3]==bytes((255,216,255)) and 4000<len(img)<2200000:
                p=ROOT/"s9-phone-thumbs"/(name+".thumb.jpg")
                p.parent.mkdir(parents=True,exist_ok=True)
                if not p.exists() or p.read_bytes()!=img:
                    part=p.with_suffix(".jpg.s9-fast-tmp")
                    part.write_bytes(img)
                    os.replace(part,p)
                thumbnail="s9-phone-thumbs/"+p.name
        except (OSError,subprocess.TimeoutExpired,RuntimeError):pass
        added.append(row_from_manifest(name,m,size,thumbnail,helpers))
    return added

def recent_existing_face_updates(index,latest_manifest_names,phone_video_names,helpers,limit=8):
    """Incremental V26 sidecar refresh, no MP4 decode, images or identities read.

    The S9+ edits verified JSON after a historical 4K face rescue. These clips
    are already in the index, so the old new-clip-only fast timer ignored them
    until a 4-hour full scan. Check only the most recently touched manifests.
    """
    records=index.get("phone_recordings",[])
    prior={row.get("name"):row for row in records
           if isinstance(row,dict) and VIDEO.fullmatch(str(row.get("name","")))}
    updates=[]
    checked=0
    for suffix in latest_manifest_names:
        if not suffix.endswith(".verified.json"):continue
        name=suffix[:-len(".verified.json")]
        if not VIDEO.fullmatch(name) or name not in prior or name not in phone_video_names:
            continue
        if checked>=limit:break
        checked+=1
        old=prior[name]
        if old.get("sd_verified") is not True:continue
        size=old.get("size")
        if type(size) is not int or not 100000<size<800000000:continue
        try:
            raw=adb("exec-out","cat",FOLDER+"/"+suffix,limit=MANIFEST_MAX_BYTES,timeout=16)
            manifest=json.loads(raw)
            if manifest.get("bytes")!=size:continue
            fresh=row_from_manifest(name,manifest,size,old.get("thumbnail"),helpers)
            merged=dict(old)
            merged.update(fresh)
            if merged!=old:updates.append(merged)
        except (OSError,RuntimeError,subprocess.TimeoutExpired,ValueError,TypeError,json.JSONDecodeError):
            continue
    return updates

def update_index(existing,added):
    if not added:return existing
    out=dict(existing)
    records=out.get("phone_recordings")
    if not isinstance(records,list):raise ValueError("index_format")
    distinct={r.get("name"):r for r in records if isinstance(r,dict) and isinstance(r.get("name"),str)}
    for item in added:distinct[item["name"]]=item
    out["phone_recordings"]=sorted(distinct.values(),key=lambda row:row.get("timestamp",""))
    out["total_phone_files"]=len(distinct)
    out["archived_total"]=len(distinct)
    out["last_new_clip_fast_index_utc"]=datetime.datetime.now(datetime.timezone.utc).isoformat()
    return out

def native_updates(source,snapshot,helpers):
    """Use phone-side deltas/stat validation; no ADB process or video decode."""
    prior={r.get("name"):r for r in source.get("phone_recordings",[]) if isinstance(r,dict)}
    updates=[]
    for name,entry in snapshot["records"].items():
        old=prior.get(name,{})
        dest=ROOT/"s9-phone-thumbs"/(name+".thumb.jpg")
        if (old.get("phone_catalog_version")==entry["version"] and
            (not entry["thumbnail"] or (old.get("phone_thumbnail_version")==entry["thumbnail_version"] and
                phone_catalog.valid_cached_thumbnail(dest,entry["thumbnail_version"])))):continue
        available,thumb_version=phone_catalog.cache_thumbnail(entry,dest,old.get("phone_thumbnail_version"))
        thumbnail="s9-phone-thumbs/"+dest.name if available else None
        fresh=row_from_manifest(name,entry["manifest"],entry["bytes"],thumbnail,helpers)
        fresh.update(phone_catalog_version=entry["version"],phone_thumbnail_version=thumb_version)
        updates.append({**old,**fresh})
    return updates

def index_once():
    LOCK.parent.mkdir(parents=True,exist_ok=True)
    with LOCK.open("a+") as guard:
        fcntl.flock(guard,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if not INDEX.is_file():raise RuntimeError("full_catalog_missing")
        helpers=module()
        source=json.loads(INDEX.read_text())
        if source.get("storage_policy")!="local_microSD":raise RuntimeError("wrong_archive_mode")
        snapshot=None
        if phone_catalog is not None:
            try:snapshot=phone_catalog.load_catalog()
            except phone_catalog.Unavailable:pass
        if snapshot is not None:
            updates=native_updates(source,snapshot,helpers)
            known={row.get("name") for row in source["phone_recordings"] if isinstance(row,dict)}
            added=[row for row in updates if row["name"] not in known]
            changed=[row for row in updates if row["name"] in known]
        else:
            listing=adb("shell","ls","-1",FOLDER,limit=500000,timeout=15).decode().splitlines()
            added=new_records(source,listing,helpers)
        # Existing recordings gain deep face-review JSON long after the MP4
        # is saved. Refresh up to eight recent sidecars per minute, retaining
        # all other rows, custom evidence and original source media.
            recent=adb("shell","ls","-1t",FOLDER,limit=500000,timeout=16).decode().splitlines()
            changed=recent_existing_face_updates(source,recent,set(listing),helpers)
        if not added and not changed:
            print("S9_FAST_INDEX_NO_NEW_CLIPS_OR_FACE_UPDATES",flush=True)
            return
        # Re-read immediately before atomic write to avoid using a stale
        # index if the slow full scanner finished during these few ADB calls.
        latest=json.loads(INDEX.read_text())
        if latest!=source:
            # A concurrent full-catalog rebuild may have newer scan evidence.
            # Never replace its rows using our prior index snapshot.
            changed=[]
            known={row.get("name") for row in latest["phone_recordings"] if isinstance(row,dict)}
            added=[row for row in added if row["name"] not in known]
            if not added:
                print("S9_FAST_INDEX_DEFER_TO_NEWER_CATALOG",flush=True)
                return
        next_index=update_index(latest,added+changed)
        if not next_index["phone_recordings"]:raise RuntimeError("unsafe_empty_index")
        target=INDEX.with_name(INDEX.name+".s9-fast-tmp")
        target.write_text(json.dumps(next_index,indent=2)+"\n")
        os.chmod(target,INDEX.stat().st_mode&0o777)
        os.replace(target,INDEX)
        print("S9_FAST_INDEX_ADDED",len(added),[r["name"] for r in added],flush=True)
        print("S9_FAST_INDEX_TOTAL",len(next_index["phone_recordings"]),flush=True)
        print("S9_FAST_FACE_METADATA_REFRESH",len(changed),flush=True)

def main():
    CATALOG_LOCK.parent.mkdir(parents=True,exist_ok=True)
    with CATALOG_LOCK.open("a+") as guard:
        try:fcntl.flock(guard,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            print("S9_FAST_INDEX_DEFER_FULL_CATALOG_BUSY",flush=True)
            return
        index_once()

if __name__=="__main__":
    main()

