#!/usr/bin/env python3
from __future__ import annotations
import json, pathlib, time, shutil, os, urllib.request

HOME=pathlib.Path("/home/jespern")
ROOT=pathlib.Path("/opt/homeassistant/config/www/frontyard-security-new")
EVENTS=ROOT/"events.json"
CLIPS=ROOT/"clips"
SNAPS=ROOT/"snapshots"
REPORT={"started_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"deleted":[]}
QUOTA=450*1024*1024
MIN_RECENT=6

def load_events():
    try:
        d=json.loads(EVENTS.read_text())
        if isinstance(d,list): return d,"list",d
        if isinstance(d,dict):
            for k in ("events","items","clips"):
                if isinstance(d.get(k),list): return d[k],k,d
    except Exception as e:
        REPORT["events_error"]=repr(e)
    return [],"list",[]

def path_for(base, v):
    if not v: return None
    p=pathlib.Path(str(v))
    if p.is_absolute(): return p
    name=p.name
    q=base/name
    return q

def event_files(e):
    out=[]
    for base,key in ((CLIPS,"clip"),(SNAPS,"snapshot")):
        p=path_for(base,e.get(key) or e.get(key+"_name"))
        if p and p.exists(): out.append(p)
    return out

def mtime(e):
    vals=[]
    for p in event_files(e):
        try: vals.append(p.stat().st_mtime)
        except Exception: pass
    if vals: return max(vals)
    for k in ("timestamp","created_at","event_timestamp","recorded_at"):
        v=e.get(k)
        if isinstance(v,(int,float)): return float(v)
    return 0.0

def total_bytes():
    n=0
    for base in (CLIPS,SNAPS):
        if not base.exists(): continue
        for p in base.iterdir():
            try:
                if p.is_file(): n+=p.stat().st_size
            except Exception: pass
    return n

events,container_key,container=load_events()
REPORT["events_before"]=len(events)
REPORT["bytes_before"]=total_bytes()

# Preserve every manually saved event and at least the six newest unsaved events.
ordered=sorted(events,key=mtime,reverse=True)
protected_ids={id(e) for e in ordered[:MIN_RECENT]}
candidates=[e for e in sorted(events,key=mtime)
            if not bool(e.get("saved")) and id(e) not in protected_ids]

remaining=list(events)
for e in candidates:
    if total_bytes() <= QUOTA: break
    deleted_files=[]
    freed=0
    for p in event_files(e):
        try:
            sz=p.stat().st_size
            p.unlink()
            freed+=sz
            deleted_files.append(str(p))
        except FileNotFoundError: pass
        except Exception as ex:
            deleted_files.append(str(p)+":ERROR:"+repr(ex))
    if freed>0:
        remaining=[x for x in remaining if x is not e]
        REPORT["deleted"].append({
            "clip_no":e.get("clip_no"),"saved":bool(e.get("saved")),
            "freed_bytes":freed,"files":deleted_files
        })

# Atomic event-index rewrite only if we actually removed an event.
if len(remaining)!=len(events):
    if container_key=="list":
        newdoc=remaining
    else:
        newdoc=dict(container)
        newdoc[container_key]=remaining
    tmp=EVENTS.with_suffix(".json.tmp-v869")
    tmp.write_text(json.dumps(newdoc,indent=2,ensure_ascii=False)+"\n")
    os.replace(tmp,EVENTS)

REPORT["events_after"]=len(remaining)
REPORT["bytes_after"]=total_bytes()
REPORT["quota_bytes"]=QUOTA
REPORT["protected_newest"]=min(MIN_RECENT,len(events))
REPORT["manual_saved_preserved"]=sum(1 for e in events if bool(e.get("saved")))
REPORT["finished_at"]=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())

try:
    token=(HOME/".config/c720p-agent/security-token").read_text().strip()
    payload={"observed_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
             "maintenance":{"v869_archive_quota_trim_990034":REPORT}}
    req=urllib.request.Request(
      "https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/c720p-security-control?action=health",
      data=json.dumps(payload,separators=(",",":")).encode(),method="POST",
      headers={"content-type":"application/json","x-c720p-token":token})
    with urllib.request.urlopen(req,timeout=20) as r: REPORT["health_post_status"]=r.status
except Exception as e: REPORT["health_post_error"]=repr(e)

print(json.dumps(REPORT,indent=2,sort_keys=True))
