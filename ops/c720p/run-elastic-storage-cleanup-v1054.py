#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import pathlib
import shutil
import subprocess
import tarfile
import time

HOME=pathlib.Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
REPORT={"started_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"deleted":[],"commands":[]}

def run(cmd,timeout=120):
    try:
        p=subprocess.run(cmd,text=True,capture_output=True,timeout=timeout)
        REPORT["commands"].append({"cmd":cmd,"rc":p.returncode,"stdout":p.stdout[-4000:],"stderr":p.stderr[-4000:]})
        return p
    except Exception as e:
        REPORT["commands"].append({"cmd":cmd,"rc":99,"error":repr(e)})
        return None

def size(p):
    p=pathlib.Path(p)
    if not p.exists():
        return 0
    if p.is_file():
        try:return p.stat().st_size
        except:return 0
    n=0
    for q in p.rglob("*"):
        try:
            if q.is_file():n+=q.stat().st_size
        except:pass
    return n

def remove_tree(p,reason):
    p=pathlib.Path(p)
    if not p.exists():
        return
    before=size(p)
    shutil.rmtree(p,ignore_errors=True)
    REPORT["deleted"].append({"path":str(p),"bytes":before,"reason":reason})

def remove_file(p,reason):
    p=pathlib.Path(p)
    if not p.exists():
        return
    try:
        before=p.stat().st_size
        p.unlink()
        REPORT["deleted"].append({"path":str(p),"bytes":before,"reason":reason})
    except Exception:
        pass

REPORT["df_before"]=shutil.disk_usage("/")._asdict()

# Fresh compact recovery checkpoint before deleting old backup copies.
outdir=HOME/"c720p-backups"
outdir.mkdir(parents=True,exist_ok=True)
stamp=time.strftime("%Y%m%d_%H%M%S")
checkpoint=outdir/f"c720p-elastic-v1054-{stamp}.tar.gz"
sources=[
    BASE/"bin/c720p-archive-quota-trim-v869.py",
    BASE/"bin/c720p-security-disk-guard.py",
    BASE/"config/elastic-storage-policy.json",
    HOME/".config/systemd/user/c720p-archive-quota-trim.service",
    HOME/".config/systemd/user/c720p-archive-quota-trim.timer",
    pathlib.Path("/opt/homeassistant/config/configuration.yaml"),
    pathlib.Path("/opt/homeassistant/config/scripts.yaml"),
    pathlib.Path("/opt/homeassistant/config/automations.yaml"),
]
with tarfile.open(checkpoint,"w:gz") as tar:
    for p in sources:
        if p.exists():
            tar.add(p,arcname=str(p).lstrip("/"))
REPORT["checkpoint"]=str(checkpoint)
REPORT["checkpoint_bytes"]=checkpoint.stat().st_size

# Disposable caches. Authentication/session stores are deliberately not touched.
for p in [
    HOME/".cache/pip",
    HOME/".cache/mesa_shader_cache_db",
    HOME/".cache/c720p-kiosk-chromium",
    HOME/".cache/c720p-spotify-chromium",
    BASE/"drive-playback-cache",
]:
    remove_tree(p,"regenerable_cache")

# Recreate browser cache roots expected by some launchers.
for p in [HOME/".cache/c720p-kiosk-chromium",HOME/".cache/c720p-spotify-chromium"]:
    p.mkdir(parents=True,exist_ok=True)

# Old local agent payload/result caches are mirrored by the control-plane history.
for root in [HOME/".cache/c720p-agent/jobs",HOME/".cache/c720p-agent/results"]:
    if root.exists():
        cutoff=time.time()-7*86400
        for p in root.rglob("*"):
            try:
                if p.is_file() and p.stat().st_mtime<cutoff:
                    remove_file(p,"old_agent_cache_over_7d")
            except Exception:
                pass

# Retired S3 recovery payload: S3 has been retired from active camera service.
remove_tree(HOME/"c720p-backups/s3-ipwebcam-apk-20260907_233533","retired_s3_backup")

# Obsolete HA duplicate backups. A fresh v1054 checkpoint was made above.
for p in [
    pathlib.Path("/opt/homeassistant/config.backup.2026-05-20-0511"),
    pathlib.Path("/opt/homeassistant/config.backup.2026-05-20-0512"),
]:
    remove_tree(p,"obsolete_ha_config_copy")

ha_backups=pathlib.Path("/opt/homeassistant/config/backups")
if ha_backups.exists():
    cutoff=time.time()-45*86400
    for p in list(ha_backups.iterdir()):
        try:
            if p.is_dir() and p.stat().st_mtime<cutoff:
                remove_tree(p,"old_ha_backup_over_45d")
        except Exception:
            pass

# Bound text logs without removing the newest diagnostics.
for root in [BASE/"logs",HOME/"c720p-security-camera-new/logs"]:
    if not root.exists():
        continue
    for p in root.rglob("*"):
        try:
            if not p.is_file():
                continue
            age=time.time()-p.stat().st_mtime
            if age>30*86400 and p.suffix in {".log",".txt",".jsonl"}:
                remove_file(p,"log_over_30d")
                continue
            if p.stat().st_size>8*1024*1024:
                data=b""
                with p.open("rb") as f:
                    f.seek(max(0,p.stat().st_size-2*1024*1024))
                    data=f.read()
                old=p.stat().st_size
                p.write_bytes(data)
                REPORT["deleted"].append({"path":str(p),"bytes":old-len(data),"reason":"large_log_tail_compaction"})
        except Exception:
            pass

# Opportunistic root-owned cache cleanup only when passwordless sudo is already allowed.
run(["sudo","-n","apt-get","clean"],120)
run(["sudo","-n","journalctl","--vacuum-size=35M"],120)

REPORT["freed_known_bytes"]=sum(int(x.get("bytes") or 0) for x in REPORT["deleted"])
REPORT["df_after"]=shutil.disk_usage("/")._asdict()
REPORT["finished_at"]=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())
print(json.dumps(REPORT,indent=2,sort_keys=True))
