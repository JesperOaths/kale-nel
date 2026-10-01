#!/usr/bin/env python3
from __future__ import annotations
import json,os,pathlib,shutil,subprocess,tarfile,time

HOME=pathlib.Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
REPORT={"version":"v1054b","started_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"deleted":[],"commands":[]}

def run(cmd,timeout=120):
    try:
        p=subprocess.run(cmd,text=True,capture_output=True,timeout=timeout)
        REPORT["commands"].append({"cmd":cmd,"rc":p.returncode,"stdout":p.stdout[-3000:],"stderr":p.stderr[-3000:]})
        return p
    except Exception as e:
        REPORT["commands"].append({"cmd":cmd,"rc":99,"error":repr(e)})
        return None

def dsize(p):
    p=pathlib.Path(p)
    if not p.exists(): return 0
    if p.is_file():
        try:return p.stat().st_size
        except:return 0
    total=0
    for q in p.rglob("*"):
        try:
            if q.is_file(): total+=q.stat().st_size
        except: pass
    return total

def rm_tree(p,reason):
    p=pathlib.Path(p)
    if not p.exists(): return
    n=dsize(p)
    shutil.rmtree(p,ignore_errors=True)
    if not p.exists(): REPORT["deleted"].append({"path":str(p),"bytes":n,"reason":reason})

def rm_file(p,reason):
    p=pathlib.Path(p)
    try:
        n=p.stat().st_size;p.unlink()
        REPORT["deleted"].append({"path":str(p),"bytes":n,"reason":reason})
    except: pass

REPORT["df_before"]=dict(zip(("total","used","free"),shutil.disk_usage("/")))

# Fresh compact rollback checkpoint before removing obsolete backup/cache material.
outdir=HOME/"c720p-backups";outdir.mkdir(parents=True,exist_ok=True)
stamp=time.strftime("%Y%m%d_%H%M%S")
cp=outdir/f"c720p-elastic-v1054b-{stamp}.tar.gz"
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
with tarfile.open(cp,"w:gz") as tar:
    for p in sources:
        if p.exists(): tar.add(p,arcname=str(p).lstrip("/"))
REPORT["checkpoint"]=str(cp);REPORT["checkpoint_bytes"]=cp.stat().st_size

# Regenerable caches only: keep cookies, Local Storage, IndexedDB, credentials,
# Spotify Widevine and browser profiles intact.
for p in [
 HOME/".cache/pip",
 HOME/".cache/mesa_shader_cache_db",
 HOME/".cache/c720p-kiosk-chromium",
 HOME/".cache/c720p-spotify-chromium",
 BASE/"drive-playback-cache",
 HOME/".config/c720p-kiosk-chromium/Default/Cache",
 HOME/".config/c720p-kiosk-chromium/Default/Code Cache",
 HOME/".config/c720p-kiosk-chromium/Default/GPUCache",
 HOME/".config/c720p-kiosk-chromium/Default/Service Worker/CacheStorage",
 HOME/".config/c720p-kiosk-chromium/GPUPersistentCache",
 HOME/".config/c720p-kiosk-chromium/component_crx_cache",
 HOME/".config/c720p-spotify-chromium/Default/Cache",
 HOME/".config/c720p-spotify-chromium/Default/Code Cache",
 HOME/".config/c720p-spotify-chromium/Default/GPUCache",
 HOME/".config/c720p-spotify-chromium/Default/Service Worker/CacheStorage",
 HOME/".config/c720p-spotify-chromium/GPUPersistentCache",
 HOME/".config/c720p-spotify-chromium/component_crx_cache",
]:
    rm_tree(p,"regenerable_cache")

for p in [HOME/".cache/c720p-kiosk-chromium",HOME/".cache/c720p-spotify-chromium"]:
    p.mkdir(parents=True,exist_ok=True)

# Retired S3 material. Current S3 services/timers are absent and security relay
# explicitly reports the S3 camera as retired.
for p in [
 HOME/"c720p-backups/s3-ipwebcam-apk-20260907_233533",
 HOME/"c720p-backups/ipwebcam-pro-v7685-vendor-signed-from-s9.apk",
 HOME/"c720p-security-camera",
 pathlib.Path("/opt/homeassistant/config/www/frontyard-security"),
]:
    if p.is_file(): rm_file(p,"retired_s3_material")
    else: rm_tree(p,"retired_s3_material")

# Obsolete HA backup copies; the fresh checkpoint above replaces their recovery role.
for p in [
 pathlib.Path("/opt/homeassistant/config.backup.2026-05-20-0511"),
 pathlib.Path("/opt/homeassistant/config.backup.2026-05-20-0512"),
]:
    rm_tree(p,"obsolete_ha_config_copy")

oldha=pathlib.Path("/opt/homeassistant/config/backups")
if oldha.exists():
    cutoff=time.time()-45*86400
    for p in list(oldha.iterdir()):
        try:
            if p.is_dir() and p.stat().st_mtime<cutoff: rm_tree(p,"ha_backup_over_45d")
        except: pass

# Local agent command/result cache is disposable after a week; authoritative job
# history is in the Supabase control plane.
cutoff=time.time()-7*86400
for root in [HOME/".cache/c720p-agent/jobs",HOME/".cache/c720p-agent/results"]:
    if root.exists():
        for p in root.rglob("*"):
            try:
                if p.is_file() and p.stat().st_mtime<cutoff: rm_file(p,"agent_cache_over_7d")
            except: pass

# Keep two weeks of ordinary text diagnostics; compact any single runaway log.
for root in [BASE/"logs",HOME/"c720p-security-camera-new/logs"]:
    if not root.exists(): continue
    for p in root.rglob("*"):
        try:
            if not p.is_file(): continue
            age=time.time()-p.stat().st_mtime
            if age>14*86400 and p.suffix.lower() in {".log",".txt",".jsonl"}:
                rm_file(p,"diagnostic_log_over_14d");continue
            n=p.stat().st_size
            if n>8*1024*1024:
                with p.open("rb") as f:
                    f.seek(max(0,n-2*1024*1024));tail=f.read()
                p.write_bytes(tail)
                REPORT["deleted"].append({"path":str(p),"bytes":n-len(tail),"reason":"large_log_tail_compaction"})
        except: pass

# These can reclaim additional system cache only if passwordless sudo is already
# configured. -n guarantees no password prompt.
run(["sudo","-n","apt-get","clean"],120)
run(["sudo","-n","journalctl","--vacuum-size=35M"],120)

REPORT["freed_known_bytes"]=sum(int(x.get("bytes") or 0) for x in REPORT["deleted"])
REPORT["df_after"]=dict(zip(("total","used","free"),shutil.disk_usage("/")))
REPORT["finished_at"]=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())
print(json.dumps(REPORT,indent=2,sort_keys=True))
