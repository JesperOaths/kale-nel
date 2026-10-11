#!/usr/bin/env python3
"""Local thumbnails for verified historical Drive recordings.

Only reads the verified local Drive index and remote Drive media; writes JPEG
previews to the C720P's existing local thumbnail cache. Never modifies,
removes, renames, uploads or overwrites original Drive recordings.
Default invocation is read-only --status. --install installs a guarded local
systemd worker/timer. --batch performs limited, low-priority backfill.
"""
from __future__ import annotations
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.request
import shutil
import subprocess
import sys
import tempfile
import time

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
BIN=BASE/"bin"
CONFIG=BASE/"config/drive-security-archive.json"
INDEX=BASE/"state/drive-security-archive.json"
DISK_CACHE=BASE/"drive-archive-thumbs/new"
CACHE=Path("/tmp/c720p-drive-archive-thumbs-new")
BACKEND=BIN/"c720p-drive-security-archive.py"
STATUS=BASE/"state/google-drive-thumbnail-backfill-v1.json"
SCRIPT=BIN/"c720p-drive-archive-thumb-backfill-v1.py"
UNIT=HOME/".config/systemd/user"
SERVICE=UNIT/"c720p-drive-archive-thumb-backfill-v1.service"
TIMER=UNIT/"c720p-drive-archive-thumb-backfill-v1.timer"
SAFE_JPG=re.compile(r"^[A-Za-z0-9._-]{1,180}\.jpe?g$",re.I)
SAFE_MP4=re.compile(r"^[A-Za-z0-9._-]{1,180}\.mp4$",re.I)
VERSION="C720P_DRIVE_ARCHIVE_THUMB_BACKFILL_V1"
MAX_VIDEO_BYTES=85*1024*1024

def read_json(path,default=None):
    try:return json.loads(Path(path).read_text())
    except (FileNotFoundError,ValueError,OSError):return default if default is not None else {}

def verified_rows():
    rows=read_json(INDEX).get("items",[])
    if not isinstance(rows,list):raise RuntimeError("Drive archive index is malformed")
    result=[]
    for row in rows:
        if row.get("state")!="verified" or row.get("camera")!="new":continue
        snapshot=str(row.get("snapshot_name") or "")
        video=str(row.get("remote_name") or "")
        if not SAFE_JPG.fullmatch(snapshot) or not SAFE_MP4.fullmatch(video) or ".." in snapshot or ".." in video:continue
        result.append(row)
    # Process recent recordings first: that is the first visible archive month.
    return sorted(result,key=lambda x:str(x.get("timestamp") or ""),reverse=True)

def valid(path):
    try:
        if not path.is_file() or path.is_symlink() or path.stat().st_size<2500 or path.stat().st_size>8_000_000:return False
        with path.open("rb") as fd:return fd.read(2)==b"\xff\xd8"
    except OSError:return False

def ready(snapshot):
    return valid(DISK_CACHE/snapshot) or valid(CACHE/snapshot)

def coverage(rows):
    ready=sum(ready(row["snapshot_name"]) for row in rows)
    return {"verified_clips":len(rows),"thumbnails_ready":ready,"remaining":len(rows)-ready}

def atomic_status(data):
    STATUS.parent.mkdir(parents=True,exist_ok=True)
    tmp=STATUS.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data,sort_keys=True,indent=2)+"\n")
    os.replace(tmp,STATUS)

def remote_inventory(cfg):
    cmd=[str(cfg["rclone"]),"--config",str(cfg["rclone_config"]),
         "lsjson",str(cfg["remote"])+":","--drive-root-folder-id",
         str(cfg["folders"]["new"]["id"]),"--files-only"]
    res=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                       text=True,timeout=85)
    if res.returncode:raise RuntimeError("Drive read-only inventory unavailable (exit "+str(res.returncode)+")")
    records=json.loads(res.stdout)
    return {str(x.get("Name")):int(x.get("Size") or 0)
            for x in records if isinstance(x,dict)}

def rclone_copy(cfg,name,dest,limit=80):
    cmd=[str(cfg["rclone"]),"--config",str(cfg["rclone_config"]),
         "copyto",str(cfg["remote"])+":"+name,str(dest),
         "--drive-root-folder-id",str(cfg["folders"]["new"]["id"]),
         "--transfers","1","--checkers","1","--retries","1",
         "--low-level-retries","2"]
    proc=subprocess.run(cmd,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,
                        timeout=limit)
    return proc.returncode==0 and dest.is_file()

def video_frame(src,target):
    for seek in ("2","0.25"):
        proc=subprocess.run([
            "/usr/bin/ffmpeg","-hide_banner","-loglevel","error","-nostdin",
            "-y","-ss",seek,"-i",str(src),"-frames:v","1",
            "-vf","scale=960:-2:force_original_aspect_ratio=decrease",
            "-q:v","5","-threads","2",str(target)
        ],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=45)
        if proc.returncode==0 and valid(target):return True
    return False

def batch(max_items,video_limit):
    CACHE.mkdir(parents=True,exist_ok=True)
    rows=verified_rows()
    cfg=read_json(CONFIG)
    for key in ("rclone","rclone_config","remote","folders"):
        if key not in cfg:raise RuntimeError("Drive config missing "+key)
    remote=remote_inventory(cfg)
    pending=[row for row in rows if not ready(row["snapshot_name"])]
    # Prefer small remote JPEGs before downloading any legacy videos.
    pending.sort(key=lambda row:row["snapshot_name"] not in remote)
    before=coverage(rows)
    success=[];errors=[];videos=0
    for row in pending:
        if len(success)+len(errors)>=max_items:break
        if shutil.disk_usage(CACHE).free<300_000_000:
            errors.append({"clip":"<disk>","reason":"tmpfs_reserve_below_300mb"})
            break
        snap=row["snapshot_name"];clip=row["remote_name"]
        with tempfile.TemporaryDirectory(prefix=".drive-thumb-",dir=CACHE) as t:
            tmp=Path(t);jpg=tmp/"preview.jpg"
            method=None
            try:
                if snap in remote and 0<remote[snap]<=8_000_000:
                    if rclone_copy(cfg,snap,jpg,limit=65) and valid(jpg):method="remote_jpeg"
                if method is None and clip in remote and videos<video_limit:
                    length=remote[clip]
                    tmpfs=Path("/tmp")
                    free_tmp=shutil.disk_usage(tmpfs).free
                    free_ram=shutil.disk_usage(CACHE).free
                    if not (0<length<=MAX_VIDEO_BYTES and free_tmp>=length+250_000_000
                            and free_ram>=length+250_000_000):
                        errors.append({"clip":clip,"reason":"insufficient_temp_space_or_oversized_video"})
                        continue
                    videos+=1
                    # /tmp is a separate tmpfs on C720P: the video is deleted at
                    # the end of this block and never fills its root filesystem.
                    with tempfile.TemporaryDirectory(prefix="drive-thumb-video-",dir=tmpfs) as vd:
                        clipfile=Path(vd)/"source.mp4"
                        if rclone_copy(cfg,clip,clipfile,limit=150) and video_frame(clipfile,jpg):
                            method="video_frame"
                if method is None:
                    errors.append({"clip":clip,"reason":"preview_source_not_accessible"})
                    continue
                target=CACHE/snap
                if ready(snap):continue
                os.replace(jpg,target)
                if not valid(target):raise RuntimeError("thumbnail_validation_failed")
                success.append({"clip":clip,"method":method})
            except (OSError,subprocess.TimeoutExpired,ValueError,RuntimeError) as error:
                errors.append({"clip":clip,"reason":type(error).__name__})
    after=coverage(rows)
    result={
        "version":VERSION,"at":datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "ok":True,"before":before,"after":after,
        "remote_snapshot_count":sum(row["snapshot_name"] in remote for row in rows),
        "remote_video_count":sum(row["remote_name"] in remote for row in rows),
        "generated":len(success),"video_generated":sum(x["method"]=="video_frame" for x in success),
        "failed":errors[:12],"original_drive_media_modified":False,
        "original_local_clips_modified":False
    }
    atomic_status(result)
    print(json.dumps(result,separators=(",",":")))
    return 0

def backend_with_tmpfs(text):
    if "C720P_DRIVE_RAM_THUMB_V1" in text:return text
    marker="if root in f.parents and f.is_file():self.local_file(f,'image/jpeg');return"
    if text.count(marker)!=1:raise RuntimeError("archive snapshot route anchor changed")
    index=text.index(marker)
    indent=text[:index].rsplit("\n",1)[-1]
    if not indent or indent.strip():raise RuntimeError("invalid archive route indentation")
    deeper=indent+" "
    replacement=marker+"\n"+(
        indent+"# C720P_DRIVE_RAM_THUMB_V1: temporary Drive JPEGs; originals untouched.\n"+
        indent+'if cam=="new":'+"\n"+
        deeper+'ram_root=pathlib.Path("/tmp/c720p-drive-archive-thumbs-new").resolve()'+"\n"+
        deeper+"ram=(ram_root/n).resolve()"+"\n"+
        deeper+"if ram_root in ram.parents and ram.is_file() and not ram.is_symlink() and 2500<=ram.stat().st_size<=8_000_000:"+"\n"+
        deeper+" self.local_file(ram,'image/jpeg');return")
    data=text.replace(marker,replacement,1)
    compile(data,str(BACKEND),"exec")
    return data

def install():
    if not INDEX.exists() or not CONFIG.exists():raise RuntimeError("required verified Drive configuration missing")
    if shutil.disk_usage("/").free<12_000_000:raise RuntimeError("C720P root free space below safe install floor")
    rows=verified_rows()
    if not rows:raise RuntimeError("no verified Drive clips; refusing empty install")
    UNIT.mkdir(parents=True,exist_ok=True);BIN.mkdir(parents=True,exist_ok=True)
    backup=BASE/"backups/drive-archive-thumb-backfill-v1"/datetime.datetime.now().strftime("%Y%m%dT%H%M%SZ")
    if not BACKEND.is_file():raise RuntimeError("original Drive archive backend unavailable")
    original_backend=BACKEND.read_text()
    patched_backend=backend_with_tmpfs(original_backend)
    staged=[
      (BACKEND,patched_backend),
      (SCRIPT,Path(__file__).read_text()),
      (SERVICE,f"""[Unit]
Description=C720P safe historical Google Drive thumbnail backfill
After=network-online.target c720p-drive-security-archive.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/flock -n -E 0 /run/user/1000/c720p-drive-thumb-v1.lock /usr/bin/python3 {SCRIPT} --batch 10 --video-limit 1
TimeoutStartSec=9min
Nice=16
IOSchedulingClass=idle
MemoryMax=450M
"""),
      (TIMER,f"""[Unit]
Description=C720P historical Drive thumbnail backfill timer

[Timer]
OnBootSec=2min
OnUnitInactiveSec=2min
RandomizedDelaySec=15s
Persistent=true
Unit={SERVICE.name}

[Install]
WantedBy=timers.target
""")
    ]
    originals={}
    for path,text in staged:
        originals[path]=path.read_bytes() if path.exists() else None
    backup.mkdir(parents=True,exist_ok=False)
    for path,data in originals.items():
        if data is not None:(backup/(path.name+".before")).write_bytes(data)
    try:
        for path,text in staged:
            temp=path.with_name(path.name+".tmp-v1")
            temp.write_text(text)
            if path==SCRIPT:temp.chmod(0o755)
            os.replace(temp,path)
        subprocess.run(["/usr/bin/python3","-m","py_compile",str(SCRIPT),str(BACKEND)],check=True,timeout=12)
        subprocess.run(["systemctl","--user","restart","c720p-drive-security-archive.service"],check=True,timeout=25)
        subprocess.run(["systemctl","--user","daemon-reload"],check=True,timeout=20)
        subprocess.run(["systemctl","--user","enable","--now",TIMER.name],check=True,timeout=30)
        t=subprocess.run(["systemctl","--user","is-active",TIMER.name],capture_output=True,text=True,timeout=8)
        if t.stdout.strip()!="active":raise RuntimeError("backfill timer failed to activate")
    except Exception:
        for path,contents in originals.items():
            if contents is None:path.unlink(missing_ok=True)
            else:path.write_bytes(contents)
        subprocess.run(["systemctl","--user","daemon-reload"],timeout=20)
        subprocess.run(["systemctl","--user","restart","c720p-drive-security-archive.service"],timeout=25)
        raise
    # A first small sample confirms the authenticated Drive JPEG route, new
    # tmpfs cache and archive-serving fallback all function together.
    batch(1,0)
    new_cached=next((row for row in rows if valid(CACHE/row["snapshot_name"])),None)
    if not new_cached:raise RuntimeError("Drive worker failed to populate a fresh preview")
    sample_url="http://127.0.0.1:8794/new/saved/snap/"+new_cached["snapshot_name"]
    with urllib.request.urlopen(urllib.request.Request(sample_url,method="HEAD"),timeout=12) as response:
        if response.status!=200 or "image/jpeg" not in response.headers.get("Content-Type",""):
            raise RuntimeError("Archive HTTP thumbnail readback failed")
    print(json.dumps({"installed":True,"version":VERSION,"verified_drive_clips":len(rows),
                      "coverage":coverage(rows),"http_preview_verified":True,
                      "timer_active":True,"backup":str(backup)},separators=(",",":")))

def main():
    parser=argparse.ArgumentParser()
    act=parser.add_mutually_exclusive_group(required=True)
    act.add_argument("--status",action="store_true")
    act.add_argument("--batch",type=int)
    act.add_argument("--install",action="store_true")
    parser.add_argument("--video-limit",type=int,default=1)
    a=parser.parse_args()
    if a.status:
        print(json.dumps({"version":VERSION,"coverage":coverage(verified_rows()),"last_batch":read_json(STATUS)},separators=(",",":")))
    elif a.install:install()
    else:
        if a.batch<1 or a.batch>100 or a.video_limit<0 or a.video_limit>2:
            raise ValueError("unsafe batch limit")
        return batch(a.batch,a.video_limit)
    return 0

if __name__=="__main__":sys.exit(main())
