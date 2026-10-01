#!/usr/bin/env python3
from __future__ import annotations

import json
import pathlib
import py_compile
import shutil
import time

HOME = pathlib.Path("/home/jespern")
BASE = HOME / "c720p-home-hub"
TRIM = BASE / "bin/c720p-archive-quota-trim-v869.py"
GUARD = BASE / "bin/c720p-security-disk-guard.py"
CFG = BASE / "config/elastic-storage-policy.json"
MARKER = "C720P_ELASTIC_STORAGE_V1054"

stamp = time.strftime("%Y%m%d_%H%M%S")
backup = HOME / f"c720p-backups/v1054-elastic-storage-{stamp}"
backup.mkdir(parents=True, exist_ok=True)

for p in (TRIM, GUARD, CFG):
    if p.exists():
        shutil.copy2(p, backup / (p.name + ".before"))

trim_source = r'''#!/usr/bin/env python3
from __future__ import annotations

import datetime
import json
import os
import pathlib
import shutil
import time
import urllib.request

# C720P_ELASTIC_STORAGE_V1054
HOME=pathlib.Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
ROOT=pathlib.Path("/opt/homeassistant/config/www/frontyard-security-new")
EVENTS=ROOT/"events.json"
CLIPS=ROOT/"clips"
SNAPS=ROOT/"snapshots"
DET=BASE/"state/person-detection-index.json"
ARCH=BASE/"state/drive-security-archive.json"
TARGET_FREE=1600*1024*1024
HARD_FLOOR=900*1024*1024
MIN_RECENT=6
SOFT_GRACE_HOURS=6.0
REPORT={
    "policy_version":"v1054-elastic-free-space",
    "started_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
    "target_free_bytes":TARGET_FREE,
    "hard_floor_bytes":HARD_FLOOR,
    "minimum_recent_protected":MIN_RECENT,
    "soft_grace_hours":SOFT_GRACE_HOURS,
    "deleted":[],
    "stale_index_rows_removed":0,
}

def disk_free():
    return shutil.disk_usage("/").free

def load_json(p, default):
    try:
        return json.loads(pathlib.Path(p).read_text())
    except Exception:
        return default

def atomic_json(p, obj):
    p=pathlib.Path(p)
    q=p.with_suffix(p.suffix+".tmp-v1054")
    q.write_text(json.dumps(obj,indent=2,ensure_ascii=False)+"\n")
    os.replace(q,p)

def load_events():
    d=load_json(EVENTS,[])
    if isinstance(d,list):
        return d,"list",d
    if isinstance(d,dict):
        for k in ("events","items","clips"):
            if isinstance(d.get(k),list):
                return d[k],k,d
    return [],"list",[]

def path_for(base,v):
    if not v:
        return None
    p=pathlib.Path(str(v))
    return p if p.is_absolute() else base/p.name

def event_files(e):
    out=[]
    for base,key in ((CLIPS,"clip"),(SNAPS,"snapshot")):
        p=path_for(base,e.get(key) or e.get(key+"_name"))
        if p and p.exists() and p.is_file():
            out.append(p)
    return out

def event_epoch(e):
    vals=[]
    for p in event_files(e):
        try:
            vals.append(p.stat().st_mtime)
        except Exception:
            pass
    if vals:
        return max(vals)
    for k in ("timestamp","created_at","event_timestamp","recorded_at"):
        v=e.get(k)
        if isinstance(v,(int,float)):
            return float(v)
        if isinstance(v,str):
            for fmt in ("%Y-%m-%d %H:%M:%S","%Y-%m-%dT%H:%M:%S"):
                try:
                    return time.mktime(time.strptime(v[:19],fmt))
                except Exception:
                    pass
    return 0.0

def total_bytes():
    n=0
    for base in (CLIPS,SNAPS):
        if not base.exists():
            continue
        for p in base.iterdir():
            try:
                if p.is_file():
                    n+=p.stat().st_size
            except Exception:
                pass
    return n

def unique_bytes(events):
    seen=set()
    n=0
    for e in events:
        for p in event_files(e):
            try:
                key=str(p.resolve())
                if key in seen:
                    continue
                seen.add(key)
                n+=p.stat().st_size
            except Exception:
                pass
    return n

det_doc=load_json(DET,{})
det_items=det_doc.get("items",{}) if isinstance(det_doc,dict) else {}
arch_doc=load_json(ARCH,{})
arch_items=arch_doc.get("items",[]) if isinstance(arch_doc,dict) else []
cloud_verified=set()
for a in arch_items if isinstance(arch_items,list) else []:
    if a.get("camera")!="new" or a.get("state")!="verified":
        continue
    n=pathlib.Path(str(a.get("local_clip_name") or "")).name
    if n:
        cloud_verified.add((n,str(a.get("timestamp") or "")))

events,container_key,container=load_events()
REPORT["events_before"]=len(events)
REPORT["bytes_before"]=total_bytes()
REPORT["free_before"]=disk_free()

# Remove only stale unsaved index rows whose media is already gone.
live=[]
for e in events:
    if not bool(e.get("saved")) and not event_files(e):
        REPORT["stale_index_rows_removed"]+=1
        continue
    live.append(e)
events=live

ordered=sorted(events,key=event_epoch,reverse=True)
protected_newest=ordered[:MIN_RECENT]
protected_ids={id(e) for e in protected_newest}
protected=[e for e in events if bool(e.get("saved")) or id(e) in protected_ids]
protected_floor=unique_bytes(protected)

now=time.time()
rows=[]
for e in events:
    if bool(e.get("saved")) or id(e) in protected_ids:
        continue
    files=event_files(e)
    if not files:
        continue
    ep=event_epoch(e)
    age_h=max(0.0,(now-ep)/3600.0) if ep else 99999.0
    cp=path_for(CLIPS,e.get("clip") or e.get("clip_name"))
    clip_name=cp.name if cp else pathlib.Path(str(e.get("clip") or "")).name
    di=det_items.get("new:"+clip_name,{}) if isinstance(det_items,dict) else {}
    status=str(di.get("person_status") or "unknown")
    try:
        highlight=float(di.get("highlight_score") or 0.0)
    except Exception:
        highlight=0.0
    try:
        person=float(di.get("person_confidence") or 0.0)
    except Exception:
        person=0.0
    exact_cloud=(clip_name,str(e.get("timestamp") or "")) in cloud_verified
    size=sum(p.stat().st_size for p in files if p.exists())
    rows.append({
        "e":e,"files":files,"age_h":age_h,"status":status,
        "highlight":highlight,"person":person,"exact_cloud":exact_cloud,
        "size":size,
    })

# Lower tuple = safer to sacrifice first. Recency still matters: older first within class.
rank={
    "confirmed_no_person":0,
    "no_person_sampled":1,
    "uncertain":2,
    "unknown":3,
    "":3,
    "likely_person":4,
    "confirmed_person":5,
}
for x in rows:
    x["rank"]=-1 if x["exact_cloud"] else rank.get(x["status"],3)

free_now=disk_free()
pressure=free_now<TARGET_FREE
emergency=free_now<HARD_FLOOR
REPORT["pressure_active"]=pressure
REPORT["emergency_active"]=emergency

if pressure:
    soft=[x for x in rows if x["age_h"]>=SOFT_GRACE_HOURS]
    pool=soft
    if emergency:
        # In a true disk emergency, all unsaved non-newest-six events may be
        # considered, but the value ordering below still sacrifices weakest first.
        pool=rows
    pool.sort(key=lambda x:(x["rank"],-x["age_h"],x["highlight"],x["person"],-x["size"]))
    for x in pool:
        if disk_free()>=TARGET_FREE:
            break
        freed=0
        deleted=[]
        for p in x["files"]:
            try:
                sz=p.stat().st_size
                p.unlink()
                freed+=sz
                deleted.append(str(p))
            except FileNotFoundError:
                pass
            except Exception as ex:
                deleted.append(str(p)+":ERROR:"+repr(ex))
        if freed:
            events=[e for e in events if e is not x["e"]]
            REPORT["deleted"].append({
                "clip_no":x["e"].get("clip_no"),
                "freed_bytes":freed,
                "age_h":round(x["age_h"],2),
                "person_status":x["status"],
                "person_confidence":x["person"],
                "highlight_score":x["highlight"],
                "cloud_verified":x["exact_cloud"],
                "files":deleted,
            })

if len(events)!=REPORT["events_before"]-REPORT["stale_index_rows_removed"]:
    pass

# Always rewrite if stale rows or media deletions changed the effective list.
if REPORT["stale_index_rows_removed"] or REPORT["deleted"]:
    newdoc=events if container_key=="list" else dict(container)
    if container_key!="list":
        newdoc[container_key]=events
    atomic_json(EVENTS,newdoc)

after_bytes=total_bytes()
free_after=disk_free()
REPORT.update({
    "events_after":len(events),
    "bytes_after":after_bytes,
    "free_after":free_after,
    "manual_saved_preserved":sum(1 for e in ordered if bool(e.get("saved"))),
    "protected_newest":min(MIN_RECENT,len(ordered)),
    "protected_floor_bytes":protected_floor,
    # This is the archive size the machine can hold *right now* while still
    # preserving the shared free-space reserve. It moves automatically as other
    # laptop workloads consume or release disk.
    "elastic_capacity_bytes":max(protected_floor,after_bytes+max(0,free_after-TARGET_FREE)),
    "fixed_quota_removed":True,
    "finished_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
})

try:
    token=(HOME/".config/c720p-agent/security-token").read_text().strip()
    payload={"observed_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
             "maintenance":{"v1054_elastic_archive":REPORT}}
    req=urllib.request.Request(
      "https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/c720p-security-control?action=health",
      data=json.dumps(payload,separators=(",",":")).encode(),method="POST",
      headers={"content-type":"application/json","x-c720p-token":token})
    with urllib.request.urlopen(req,timeout=20) as r:
        REPORT["health_post_status"]=r.status
except Exception as e:
    REPORT["health_post_error"]=repr(e)

print(json.dumps(REPORT,indent=2,sort_keys=True))
'''

TRIM.write_text(trim_source, encoding="utf-8")

guard = GUARD.read_text(encoding="utf-8")
if "# C720P_ELASTIC_STORAGE_V1054" not in guard:
    old="MIN=2400*1024*1024; HARD=1250*1024*1024"
    new="# C720P_ELASTIC_STORAGE_V1054\nMIN=1600*1024*1024; HARD=900*1024*1024"
    if old not in guard:
        raise SystemExit("PATCH_ABORT=disk_guard_threshold_anchor_missing")
    guard=guard.replace(old,new,1)
    old_cache="""for cache in (pathlib.Path('/home/jespern/.cache/c720p-kiosk-chromium'), pathlib.Path('/home/jespern/.cache/mozilla/firefox')):"""
    new_cache="""for cache in (
  pathlib.Path('/home/jespern/.cache/c720p-kiosk-chromium'),
  pathlib.Path('/home/jespern/.cache/c720p-spotify-chromium'),
  pathlib.Path('/home/jespern/.cache/mozilla/firefox'),
  pathlib.Path('/home/jespern/.cache/pip'),
  pathlib.Path('/home/jespern/c720p-home-hub/drive-playback-cache'),
):"""
    if old_cache in guard:
        guard=guard.replace(old_cache,new_cache,1)
    GUARD.write_text(guard,encoding="utf-8")

CFG.parent.mkdir(parents=True, exist_ok=True)
CFG.write_text(json.dumps({
    "version":"v1054",
    "mode":"elastic_shared_free_space",
    "target_free_mb":1600,
    "hard_floor_mb":900,
    "minimum_recent_protected":6,
    "soft_grace_hours":6,
    "fixed_local_archive_quota":None,
    "principle":"camera archive may use any disk above the shared reserve and shrinks first under pressure"
},indent=2)+"\n",encoding="utf-8")

py_compile.compile(str(TRIM),doraise=True)
py_compile.compile(str(GUARD),doraise=True)

print("PATCH=APPLIED")
print("VERSION=v1054")
print(f"BACKUP={backup}")
print("FIXED_450MB_QUOTA=REMOVED")
print("TARGET_FREE_MB=1600")
print("HARD_FLOOR_MB=900")
print("PROTECTED_NEWEST=6")
print("MANUAL_SAVES_PROTECTED=1")
