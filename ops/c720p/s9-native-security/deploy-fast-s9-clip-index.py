#!/usr/bin/env python3
"""Guarded rollout of metadata-only quick-refresh S9 native camera clip index."""
import datetime
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request

HOME=Path("/home/jespern/c720p-home-hub")
BIN=HOME/"bin"
UNIT=Path.home()/".config/systemd/user"
SCRIPT=BIN/"s9-fast-recent-clip-index.py"
SERVICE=UNIT/"c720p-s9-fast-recent-clips.service"
TIMER=UNIT/"c720p-s9-fast-recent-clips.timer"
STAGED=Path("/home/jespern/c720p-home-hub/build/s9-fast-index/fast-recent-s9-clip-index.py")
INDEX=Path("/opt/homeassistant/config/www/frontyard-security-new/s9-phone-events.json")
NAME="motion_1791739041453.mp4"
BACK_ROOT=HOME/"backups/s9-fast-clip-index"

SERVICE_TEXT="""[Unit]
Description=Quick metadata-only refresh of new S9 native 4K security clips
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /home/jespern/c720p-home-hub/bin/s9-fast-recent-clip-index.py
TimeoutStartSec=55
Nice=12
CPUQuota=12%
IOSchedulingClass=best-effort
IOSchedulingPriority=7
"""
TIMER_TEXT="""[Unit]
Description=Quick S9 new native security clip index every minute
[Timer]
OnBootSec=75s
OnUnitInactiveSec=60s
AccuracySec=10s
RandomizedDelaySec=4s
Persistent=true
[Install]
WantedBy=timers.target
"""

def run(*args,timeout=55):
    return subprocess.run(args,check=True,capture_output=True,text=True,timeout=timeout).stdout.strip()

def api():
    with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved",timeout=15) as response:
        d=json.load(response)
    if d.get("archive_mode")!="S9-microSD-only":raise RuntimeError("incorrect_archive_mode")
    return d

def backup_copy(file,dest):
    if file.is_file():
        shutil.copy2(file,dest)
        return True
    return False

def main():
    if not STAGED.is_file() or not INDEX.is_file():
        raise RuntimeError("staging_or_original_index_missing")
    run(sys.executable,"-m","py_compile",str(STAGED))
    before=api()
    old={x.get("clip_no") for x in before.get("events",[])}
    if len(old)<200:raise RuntimeError("catalog_baseline_not_healthy")
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup=BACK_ROOT/stamp
    backup.mkdir(parents=True,exist_ok=False)
    paths=(SCRIPT,SERVICE,TIMER,INDEX)
    backed={p:backup_copy(p,backup/p.name) for p in paths}
    print("FAST_INDEX_BACKUP",str(backup),flush=True)
    try:
        BIN.mkdir(parents=True,exist_ok=True)
        UNIT.mkdir(parents=True,exist_ok=True)
        temp=SCRIPT.with_suffix(".py.s9fast-stage")
        shutil.copy2(STAGED,temp)
        temp.chmod(0o700)
        os.replace(temp,SCRIPT)
        SERVICE.write_text(SERVICE_TEXT)
        TIMER.write_text(TIMER_TEXT)
        run("systemctl","--user","daemon-reload",timeout=30)
        # Seed the current missing clip before waiting for the first timer tick.
        out=run("systemctl","--user","start",SERVICE.name,timeout=65)
        after=api()
        names={x.get("clip_no") for x in after.get("events",[])}
        if not old.issubset(names):raise RuntimeError("existing_clips_disappeared")
        if NAME not in names:raise RuntimeError("new_s9_clip_not_indexed")
        added=next(x for x in after["events"] if x.get("clip_no")==NAME)
        if not added.get("remote_name")==NAME or not int(added.get("size") or 0)>1_000_000:
            raise RuntimeError("new_video_invalid")
        run("systemctl","--user","enable","--now",TIMER.name,timeout=30)
        state=run("systemctl","--user","is-active",TIMER.name,timeout=15)
        if state!="active":raise RuntimeError("fast_timer_not_active")
        print("S9_FAST_INDEX_LIVE",json.dumps({"new_clip":NAME,
            "listed":True,"new_video_size":added.get("size"),
            "previous_clips_preserved":len(old),
            "archive_total":len(after["events"]),
            "timer":state,"backup":str(backup)},sort_keys=True),flush=True)
    except Exception:
        try:run("systemctl","--user","disable","--now",TIMER.name,timeout=25)
        except Exception:pass
        for file in paths:
            b=backup/file.name
            try:
                if backed[file]:shutil.copy2(b,file)
                elif file.is_file():file.unlink()
            except Exception:pass
        try:run("systemctl","--user","daemon-reload",timeout=30)
        except Exception:pass
        raise

if __name__=="__main__":main()
