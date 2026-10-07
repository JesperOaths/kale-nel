#!/usr/bin/env python3
from __future__ import annotations
import json,pathlib,time,os,shutil,urllib.request

HOME=pathlib.Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
ROOT=pathlib.Path("/opt/homeassistant/config/www/frontyard-security-new")
EVENTS=ROOT/"events.json";CLIPS=ROOT/"clips";SNAPS=ROOT/"snapshots"
DET=BASE/"state/person-detection-index.json";ARCH=BASE/"state/drive-security-archive.json"
TARGET_FREE=1600*1024*1024;HARD_FLOOR=900*1024*1024
MIN_RECENT=6;MIN_CONFIRMED_RECENT=20
REPORT={"policy_version":"v106-person-protected-elastic","started_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"deleted":[],"stale_rows_removed":[]}

def load(p,d):
    try:return json.loads(pathlib.Path(p).read_text())
    except:return d
def atomic(p,obj):
    q=pathlib.Path(str(p)+".tmp-v106");q.write_text(json.dumps(obj,indent=2,ensure_ascii=False)+"\n");os.replace(q,p)
def path_for(base,v):
    if not v:return None
    p=pathlib.Path(str(v));return p if p.is_absolute() else base/p.name
def files(e):
    out=[]
    for base,key in ((CLIPS,"clip"),(SNAPS,"snapshot")):
        p=path_for(base,e.get(key) or e.get(key+"_name"))
        if p and p.is_file():out.append(p)
    return out
def epoch(e):
    vals=[]
    for p in files(e):
        try:vals.append(p.stat().st_mtime)
        except:pass
    if vals:return max(vals)
    for k in ("timestamp","created_at","event_timestamp","recorded_at"):
        v=e.get(k)
        if isinstance(v,(int,float)):return float(v)
        if isinstance(v,str):
            for fmt in ("%Y-%m-%d %H:%M:%S","%Y-%m-%dT%H:%M:%S"):
                try:return time.mktime(time.strptime(v[:19],fmt))
                except:pass
    return 0.0
def disk_free():return shutil.disk_usage("/").free
def media_bytes():
    n=0
    for b in (CLIPS,SNAPS):
        if b.exists():
            for p in b.iterdir():
                try:
                    if p.is_file():n+=p.stat().st_size
                except:pass
    return n
def load_events():
    d=load(EVENTS,[])
    if isinstance(d,list):return d,"list",d
    if isinstance(d,dict):
        for k in ("events","items","clips"):
            if isinstance(d.get(k),list):return d[k],k,d
    return [],"list",[]

det=load(DET,{});ditems=det.get("items",{}) if isinstance(det,dict) else {}
arch=load(ARCH,{});aitems=arch.get("items",[]) if isinstance(arch,dict) else []
cloud=set()
for x in aitems if isinstance(aitems,list) else []:
    if x.get("camera")=="new" and x.get("state")=="verified":
        n=pathlib.Path(str(x.get("local_clip_name") or "")).name
        if n:cloud.add(n)

events,key,container=load_events()
REPORT["events_before"]=len(events);REPORT["bytes_before"]=media_bytes();REPORT["free_before"]=disk_free()

# Dead rows should not linger in the Security UI. The archive index remains the
# historical record, so a local event with no local media is not useful to keep.
live=[]
for e in events:
    if not files(e):
        REPORT["stale_rows_removed"].append({"clip_no":e.get("clip_no"),"saved":bool(e.get("saved")),"reason":"local_media_missing"})
    else:live.append(e)
events=live

def info(e):
    cp=path_for(CLIPS,e.get("clip") or e.get("clip_name"))
    name=cp.name if cp else pathlib.Path(str(e.get("clip") or e.get("clip_name") or "")).name
    di=ditems.get("new:"+name,{}) if isinstance(ditems,dict) else {}
    st=str(di.get("person_status") or e.get("person_status") or "unknown")
    try:pc=float(di.get("person_confidence") or e.get("person_confidence") or 0)
    except:pc=0.0
    try:hs=float(di.get("highlight_score") or e.get("highlight_score") or 0)
    except:hs=0.0
    age=max(0,(time.time()-epoch(e))/3600) if epoch(e) else 99999
    return name,st,pc,hs,age,name in cloud

ordered=sorted(events,key=epoch,reverse=True)
protected_ids={id(e) for e in ordered[:MIN_RECENT]}
confirmed=[e for e in ordered if info(e)[1]=="confirmed_person"]
protected_ids.update(id(e) for e in confirmed[:MIN_CONFIRMED_RECENT])
protected_ids.update(id(e) for e in events if bool(e.get("saved")))

pressure=disk_free()<TARGET_FREE; emergency=disk_free()<HARD_FLOOR
REPORT["pressure_active"]=pressure;REPORT["emergency_active"]=emergency
REPORT["protected_newest"]=min(MIN_RECENT,len(ordered))
REPORT["protected_confirmed_recent"]=min(MIN_CONFIRMED_RECENT,len(confirmed))
REPORT["manual_saved_protected"]=sum(bool(e.get("saved")) for e in events)

rows=[]
for e in events:
    if id(e) in protected_ids:continue
    fs=files(e)
    if not fs:continue
    name,st,pc,hs,age,cloud_ok=info(e)
    eligible=False;why=""
    if st in ("confirmed_no_person","no_person_sampled"):
        eligible = age >= (0 if emergency else 6); why="no_person"
    elif st in ("uncertain","unknown",""):
        eligible = age >= (6 if emergency else 24); why="uncertain"
    elif st=="likely_person":
        threshold=(24 if cloud_ok else 72) if emergency else (72 if cloud_ok else 168)
        eligible=age>=threshold;why="likely_person_age_gate"
    elif st=="confirmed_person":
        # Strong evidence is never sacrificed under ordinary pressure. In an
        # actual disk emergency only a cloud-verified copy older than 14 days
        # may lose its local duplicate, and the newest 20 confirmed clips stay.
        eligible=emergency and cloud_ok and age>=14*24;why="confirmed_person_emergency_cloud_copy"
    else:
        eligible=age >= (6 if emergency else 24);why="fallback"
    if not eligible:continue
    size=sum(p.stat().st_size for p in fs if p.is_file())
    rank={"confirmed_no_person":0,"no_person_sampled":1,"uncertain":2,"unknown":3,"":3,"likely_person":4,"confirmed_person":9}.get(st,3)
    # Cloud copies are safer to sacrifice locally, except confirmed-person rules above.
    if cloud_ok and st!="confirmed_person":rank-=1
    rows.append({"event":e,"files":fs,"name":name,"status":st,"person":pc,"highlight":hs,"age_h":age,"cloud":cloud_ok,"size":size,"rank":rank,"why":why})

if pressure:
    rows.sort(key=lambda x:(x["rank"],-x["age_h"],x["highlight"],x["person"],-x["size"]))
    for x in rows:
        if disk_free()>=TARGET_FREE:break
        freed=0;gone=[]
        for p in x["files"]:
            try:sz=p.stat().st_size;p.unlink();freed+=sz;gone.append(str(p))
            except FileNotFoundError:pass
            except Exception as ex:gone.append(str(p)+":ERROR:"+repr(ex))
        if freed:
            events=[e for e in events if e is not x["event"]]
            REPORT["deleted"].append({"clip_no":x["event"].get("clip_no"),"freed_bytes":freed,"age_h":round(x["age_h"],1),"person_status":x["status"],"person_confidence":x["person"],"highlight_score":x["highlight"],"cloud_verified":x["cloud"],"rule":x["why"],"files":gone})

if REPORT["stale_rows_removed"] or REPORT["deleted"]:
    doc=events if key=="list" else dict(container)
    if key!="list":doc[key]=events
    atomic(EVENTS,doc)

REPORT.update({"events_after":len(events),"bytes_after":media_bytes(),"free_after":disk_free(),"eligible_candidates":len(rows),"finished_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())})
try:
    token=(HOME/".config/c720p-agent/security-token").read_text().strip()
    req=urllib.request.Request("https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/c720p-security-control?action=health",data=json.dumps({"observed_at":REPORT["finished_at"],"maintenance":{"v106_local_retention":REPORT}},separators=(",",":")).encode(),method="POST",headers={"content-type":"application/json","x-c720p-token":token})
    with urllib.request.urlopen(req,timeout=15) as r:REPORT["health_post_status"]=r.status
except Exception as ex:REPORT["health_post_error"]=repr(ex)
print(json.dumps(REPORT,indent=2,sort_keys=True))
