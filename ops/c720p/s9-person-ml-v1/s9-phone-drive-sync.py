#!/usr/bin/env python3
"""S9+ -> verified Drive -> existing Security Saved Clips. No large hub video cache.

Conservative behavior: preserve every source and SD video. Only verified Drive objects
enter the archive index, and only SHA-256-verified source streams qualify.
"""
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess as sp
import sys
import time

BASE=Path("/home/jespern/c720p-home-hub")
APP=BASE/"bin/c720p-drive-security-upload.py"
CFG=BASE/"config/drive-security-archive.json"
INDEX=BASE/"state/drive-security-archive.json"
LOCK=BASE/"state/drive-security-archive.lock"
STATE=BASE/"state/s9-phone-drive-sync.json"
SECURITY=Path("/opt/homeassistant/config/www/frontyard-security-new")
THUMB=BASE/"drive-archive-thumbs/new"
SNAP=SECURITY/"s9-phone-thumbs"
PUBL=SECURITY/"s9-phone-events.json"
ADB="192.168.178.250:5555"
SD="/storage/9C33-6BBD/Android/data/nl.kalenel.s9edge/files/SecurityClips"
NAMES=re.compile(r"^rec_20\d{2}-\d{2}-\d{2}_\d{2}-\d{2}\.mp4$")
MAX_CLIPS_RUN=4
MAX_SIZE=350*1024*1024
MAX_THUMB=2*1024*1024

def atomic(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name(path.name+".s9tmp")
    tmp.write_text(json.dumps(obj,indent=2,ensure_ascii=False)+"\n")
    os.replace(tmp,path)

def adb_bytes(path,limit):
    p=sp.run(["adb","-s",ADB,"exec-out","cat",path],capture_output=True,timeout=35)
    if p.returncode or not p.stdout or len(p.stdout)>limit:
        raise RuntimeError("phone_data_unavailable")
    return p.stdout

def storage_manifest(name):
    data=adb_bytes(SD+"/"+name+".verified.json",15000)
    d=json.loads(data.decode())
    if d.get("name")!=name or not re.fullmatch("[0-9a-f]{64}",str(d.get("sha256",""))):
        raise RuntimeError("bad_phone_manifest")
    size=int(d.get("bytes",0))
    if not 10000<=size<=MAX_SIZE:raise RuntimeError("invalid_phone_video_size")
    return d

def md5(path):
    h=hashlib.md5()
    with open(path,"rb") as f:
        for part in iter(lambda:f.read(1024*1024),b""):h.update(part)
    return h.hexdigest()

def stream_phone_file(path,rclone,conf,remote,folder,expected,expected_sha):
    command=[rclone,"--config",conf,"rcat",remote,
         "--drive-root-folder-id",folder,"--drive-chunk-size","8M",
         "--retries","2","--low-level-retries","3","--size",str(expected)]
    video=sp.Popen(["adb","-s",ADB,"exec-out","cat",path],stdout=sp.PIPE,stderr=sp.PIPE)
    upload=sp.Popen(command,stdin=sp.PIPE,stdout=sp.DEVNULL,stderr=sp.PIPE)
    hh=hashlib.sha256();mm=hashlib.md5();n=0
    try:
        while True:
            block=video.stdout.read(1024*1024)
            if not block:break
            n+=len(block)
            if n>expected:raise RuntimeError("source_larger_than_manifest")
            hh.update(block);mm.update(block)
            upload.stdin.write(block)
        upload.stdin.close()
        vr=video.wait(timeout=25)
        ur=upload.wait(timeout=240)
        if vr or ur:raise RuntimeError("source_or_drive_stream_failed")
        if n!=expected or hh.hexdigest()!=expected_sha:
            raise RuntimeError("stream_sha256_mismatch")
        return mm.hexdigest()
    finally:
        if video.poll() is None:video.kill()
        if upload.poll() is None:upload.kill()
        video.stdout.close()
        if upload.stdin and not upload.stdin.closed:upload.stdin.close()
        if video.stderr:video.stderr.close()
        if upload.stderr:upload.stderr.close()

def phone_names():
    p=sp.run(["adb","-s",ADB,"shell","ls","-1",SD],text=True,capture_output=True,timeout=20)
    if p.returncode:raise RuntimeError("sd_directory_unavailable")
    return sorted({x.strip() for x in p.stdout.splitlines() if NAMES.fullmatch(x.strip())})

def ts_from_name(n):
    stamp=n[len("rec_"):-len(".mp4")]
    return dt.datetime.strptime(stamp,"%Y-%m-%d_%H-%M").strftime("%Y-%m-%d %H:%M:00")

def thumb_from_phone(name):
    photo=SNAP/(name+".thumb.jpg")
    # Read the tiny phone JPEG again because person-aware thumbnails can improve after capture.
    try:
        data=adb_bytes(SD+"/"+name+".thumb.jpg",MAX_THUMB)
        if not(data[:3]==b"\xff\xd8\xff" and len(data)>4000):return None
        SNAP.mkdir(parents=True,exist_ok=True)
        tmp=photo.with_suffix(photo.suffix+".part");tmp.write_bytes(data);os.replace(tmp,photo)
        return photo
    except Exception:return None

def remote_details(c,name):
    p=sp.run([c["rclone"],"--config",c["rclone_config"],
        "lsjson",c["remote"]+":"+name,
        "--drive-root-folder-id",str(c["folders"]["new"]["id"]),
        "--hash","--files-only"],
        text=True,capture_output=True,timeout=40)
    if p.returncode:return None
    try:
        arr=json.loads(p.stdout)
        return arr[0] if isinstance(arr,list) and arr else arr if isinstance(arr,dict) else None
    except Exception:return None

def verified_remote(c,name,size,md5hash):
    d=remote_details(c,name)
    if not d or int(d.get("Size",-1))!=size:return False
    hashes=d.get("Hashes") or {}
    actual=str(next((v for k,v in hashes.items() if k.lower()=="md5"),"")).lower()
    return bool(actual and actual==md5hash)

def save_row(name,size,hashmd5,snap_name,remote_name):
    # Caller holds the same archive lock as the original Drive uploader.
    d=json.loads(INDEX.read_text()) if INDEX.exists() else {"version":1,"items":[]}
    for item in d.get("items",[]):
        if item.get("camera")=="new" and item.get("remote_name")==remote_name and item.get("state")=="verified":
            return
    rows=d.setdefault("items",[])
    when=ts_from_name(name)
    rows.append(dict(
      camera="new",clip_no=220000+int(dt.datetime.strptime(when,"%Y-%m-%d %H:%M:%S").timestamp())%100000000,
      timestamp=when,reason="S9+ on-phone recording; human presence not independently verified",
      method="s9-phone-original-verified",duration_target_seconds=18,
      remote_name=remote_name,snapshot_name=snap_name,
      size=size,md5=hashmd5,uploaded_at=dt.datetime.now().astimezone().isoformat(),
      person_confidence=None,person_status="unreviewed",person_status_reason="no_per_clip_ground_truth",
      selection_reason="s9-phone-microSD-original",highlight_score=0,
      archive_profile="s9-original-quality-unmodified",source_size=size,archive_transcoded=False,
      local_clip_name=name,local_snapshot_name="",local_cleaned=True,
      source_retained_on_phone=True,phone_verified_sd=True,state="verified"))
    atomic(INDEX,d)

def main():
    LOCK.parent.mkdir(parents=True,exist_ok=True)
    with open(LOCK,"a+") as guard:
      fcntl.flock(guard,fcntl.LOCK_EX)
      c=json.loads(CFG.read_text())
      # Reuse the original uploader's pinned Drive OAuth/account verification;
      # never embed/copy tokens to the phone or a public asset.
      spec=importlib.util.spec_from_file_location("c720p_original_drive_uploader",APP)
      mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
      if not mod.remote_ready(c):
          raise RuntimeError("existing_drive_auth_or_identity_check_failed")
      free=mod.drive_free_bytes(c)
      reserve=int(float(c.get("reserve_free_gb",5))*1024**3)
      if free is None:raise RuntimeError("drive_space_unknown")
      conn=sp.run(["adb","connect",ADB],capture_output=True,text=True,timeout=10)
      names=phone_names()
      original=json.loads(INDEX.read_text()) if INDEX.exists() else {"items":[]}
      have={str(item.get("local_clip_name")):item for item in original.get("items",[])
       if item.get("camera")=="new" and item.get("method")=="s9-phone-original-verified"
       and item.get("state")=="verified"}
      summary={"updated_at":dt.datetime.now().astimezone().isoformat(),"source":"s9-phone-SD",
          "total_phone_files":len(names),"drive_free_bytes":free,"reserve_bytes":reserve,
          "uploaded_this_run":[],"pending":[],"errors":[],"phone_recordings":[]}
      for name in reversed(names):
        info={"name":name,"timestamp":ts_from_name(name)}
        rec=have.get(name)
        info["drive_verified"]=bool(rec)
        info["remote_name"]=rec.get("remote_name") if rec else None
        photo=thumb_from_phone(name)
        info["thumbnail"]=f"s9-phone-thumbs/{name}.thumb.jpg" if photo else None
        summary["phone_recordings"].append(info)
      # Refresh upgraded thumbnails independently of the already verified MP4.
      for name in names:
        if name not in have:continue
        photo=thumb_from_phone(name)
        if not photo:continue
        row=have[name]
        remote_name=str(row.get("remote_name") or "")
        if not remote_name:continue
        candidate="S9PHONE_"+name+".jpg"
        original=THUMB/candidate
        newhash=md5(photo)
        if original.is_file() and md5(original)==newhash and row.get("snapshot_name")==candidate:
          continue
        try:
          if free-reserve<photo.stat().st_size+32*1024*1024:continue
          result=sp.run([c["rclone"],"--config",c["rclone_config"],
              "copyto",str(photo),c["remote"]+":"+candidate,
              "--drive-root-folder-id",str(c["folders"]["new"]["id"]),"--retries","2"],
              stdout=sp.DEVNULL,stderr=sp.DEVNULL,timeout=95)
          if result.returncode or not verified_remote(c,candidate,photo.stat().st_size,newhash):
            summary["errors"].append("thumbnail_refresh_failed_"+name);continue
          THUMB.mkdir(parents=True,exist_ok=True)
          original.write_bytes(photo.read_bytes())
          index2=json.loads(INDEX.read_text())
          for item in index2.get("items",[]):
            if item.get("camera")=="new" and item.get("remote_name")==remote_name and item.get("state")=="verified":
              item["snapshot_name"]=candidate
          atomic(INDEX,index2)
          have[name]["snapshot_name"]=candidate
          summary.setdefault("thumbnails_refreshed",[]).append(name)
          free-=photo.stat().st_size
        except Exception as exc:
          summary["errors"].append("thumbnail_refresh:"+type(exc).__name__)
      count=0
      for name in names:
        if name in have:continue
        if count>=MAX_CLIPS_RUN:
            summary["pending"].append(name);continue
        try:
          manifest=storage_manifest(name)
          size=int(manifest["bytes"])
          if free-reserve< size+32*1024*1024:
             summary["pending"].append(name)
             summary["errors"].append("drive_reserve_blocks_"+name)
             continue
          remote_name="S9PHONE_"+name
          destination=c["remote"]+":"+remote_name
          # A successful local stream is NOT sufficient. Check remote Drive MD5.
          filemd5=stream_phone_file(SD+"/"+name,c["rclone"],c["rclone_config"],
             destination,str(c["folders"]["new"]["id"]),size,str(manifest["sha256"]))
          if not verified_remote(c,remote_name,size,filemd5):
             summary["errors"].append("remote_verification_failed_"+name)
             continue
          snap_name=""
          thumb=thumb_from_phone(name)
          if thumb:
            candidate="S9PHONE_"+name+".jpg"
            # ~50kB local thumbnail only, never a full MP4.
            p=sp.run([c["rclone"],"--config",c["rclone_config"],
                "copyto",str(thumb),c["remote"]+":"+candidate,
                "--drive-root-folder-id",str(c["folders"]["new"]["id"]),"--retries","2"],
                stdout=sp.DEVNULL,stderr=sp.DEVNULL,timeout=100)
            if p.returncode==0 and verified_remote(c,candidate,thumb.stat().st_size,md5(thumb)):
               snap_name=candidate
               THUMB.mkdir(parents=True,exist_ok=True)
               dest=THUMB/candidate
               if not dest.exists():dest.write_bytes(thumb.read_bytes())
          save_row(name,size,filemd5,snap_name,remote_name)
          count+=1
          summary["uploaded_this_run"].append(name)
          free-=size+(thumb.stat().st_size if thumb else 0)
          for row in summary["phone_recordings"]:
              if row["name"]==name:
                  row["drive_verified"]=True;row["remote_name"]=remote_name
        except Exception as e:
          summary["pending"].append(name)
          summary["errors"].append(type(e).__name__+":"+str(e)[:90])
      summary["archived_total"]=sum(1 for i in summary["phone_recordings"] if i["drive_verified"])
      # Sanitized static feed for the local Security view. No auth credentials.
      atomic(PUBL,summary)
      atomic(STATE,summary)
      print(json.dumps({k:summary[k] for k in
          ("total_phone_files","archived_total","uploaded_this_run","pending","errors")}))
if __name__=="__main__":
 try:main()
 except Exception as e:
    print("S9_DRIVE_BRIDGE_ERROR",type(e).__name__,str(e)[:130],file=sys.stderr)
    sys.exit(1)
