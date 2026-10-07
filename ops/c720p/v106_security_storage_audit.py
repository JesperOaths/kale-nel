#!/usr/bin/env python3
from __future__ import annotations
import json, pathlib, subprocess, hashlib, re, shutil, urllib.request, urllib.parse, os, time

HOME=pathlib.Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
ROOT=pathlib.Path("/opt/homeassistant/config/www/frontyard-security-new")
EVENTS=ROOT/"events.json"
CLIPS=ROOT/"clips"
SNAPS=ROOT/"snapshots"
DET=BASE/"state/person-detection-index.json"
ARCH=BASE/"state/drive-security-archive.json"
ACFG=BASE/"config/drive-security-archive.json"
TRIM=BASE/"bin/c720p-archive-quota-trim-v869.py"
RET=BASE/"bin/c720p-drive-value-retention.py"
SERVER=BASE/"bin/c720p-drive-security-archive.py"
SAVED_UI=pathlib.Path("/opt/homeassistant/config/www/c720p-drive-saved.html")
OUT={"at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())}

def load(p,default):
    try:return json.loads(pathlib.Path(p).read_text())
    except Exception:return default

def rows_of_events(d):
    if isinstance(d,list):return d
    if isinstance(d,dict):
        for k in ("events","items","clips"):
            if isinstance(d.get(k),list):return d[k]
    return []

def pfor(base,v):
    if not v:return None
    p=pathlib.Path(str(v)); return p if p.is_absolute() else base/p.name

def sha(p):
    try:return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
    except:return None

def unit(name):
    r=subprocess.run(["systemctl","--user","show",name,"-p","ActiveState","-p","SubState","-p","UnitFileState","-p","ExecMainStatus"],text=True,capture_output=True)
    return {"rc":r.returncode,"out":r.stdout.strip(),"err":r.stderr.strip()}

def cat_unit(name):
    r=subprocess.run(["systemctl","--user","cat",name],text=True,capture_output=True)
    return r.stdout[-8000:] if r.returncode==0 else ""

def grep_rules(p,patterns):
    try:s=pathlib.Path(p).read_text(errors="ignore")
    except:return {"exists":False}
    lines=s.splitlines(); hits=[]
    for i,l in enumerate(lines,1):
        if any(re.search(x,l,re.I) for x in patterns):
            hits.append(f"{i}:{l[:500]}")
    return {"exists":True,"sha256":sha(p),"lines":len(lines),"hits":hits[:300]}

events=rows_of_events(load(EVENTS,[]))
detdoc=load(DET,{})
detitems=detdoc.get("items",{}) if isinstance(detdoc,dict) else {}
archdoc=load(ARCH,{})
architems=archdoc.get("items",[]) if isinstance(archdoc,dict) else []

stale=[]
status_counts={}
event_summary=[]
for e in events:
    cp=pfor(CLIPS,e.get("clip") or e.get("clip_name"))
    sp=pfor(SNAPS,e.get("snapshot") or e.get("snapshot_name"))
    cn=cp.name if cp else pathlib.Path(str(e.get("clip") or e.get("clip_name") or "")).name
    di=detitems.get("new:"+cn,{}) if isinstance(detitems,dict) else {}
    st=str(di.get("person_status") or e.get("person_status") or "unknown")
    status_counts[st]=status_counts.get(st,0)+1
    clip_ok=bool(cp and cp.is_file()); snap_ok=bool(sp and sp.is_file())
    if not clip_ok and not snap_ok:
        stale.append({"clip_no":e.get("clip_no"),"saved":bool(e.get("saved")),"clip":cn,"snapshot":sp.name if sp else None,"person_status":st})
    event_summary.append({
        "clip_no":e.get("clip_no"),"saved":bool(e.get("saved")),"clip":cn,
        "clip_present":clip_ok,"snapshot_present":snap_ok,"person_status":st,
        "person_confidence":di.get("person_confidence",e.get("person_confidence")),
        "highlight_score":di.get("highlight_score",e.get("highlight_score")),
        "det_keys":sorted(di.keys()) if isinstance(di,dict) else []
    })

states={}
verified=[]
for x in architems:
    states[str(x.get("state"))]=states.get(str(x.get("state")),0)+1
    if x.get("camera")=="new" and x.get("state")=="verified": verified.append(x)

remote_names=None; remote_error=None
cfg=load(ACFG,{})
try:
    f=((cfg.get("folders") or {}).get("new") or {}).get("id")
    cmd=[str(cfg.get("rclone") or "rclone"),"--config",str(cfg.get("rclone_config") or ""),"lsjson",str(cfg.get("remote") or "")+":","--drive-root-folder-id",str(f),"--files-only"]
    rr=subprocess.run(cmd,text=True,capture_output=True,timeout=120)
    if rr.returncode==0:
        remote_names={str(x.get("Name") or "") for x in (json.loads(rr.stdout) if rr.stdout.strip() else []) if isinstance(x,dict) and x.get("Name")}
    else: remote_error=(rr.stderr or rr.stdout)[-1000:]
except Exception as ex: remote_error=repr(ex)

remote_missing=[]
if remote_names is not None:
    for x in verified:
        n=pathlib.Path(str(x.get("remote_name") or "")).name
        if n and n not in remote_names:
            remote_missing.append({"clip_no":x.get("clip_no"),"remote_name":n,"timestamp":x.get("timestamp"),"person_status":x.get("person_status")})

api_saved=None;api_error=None
try:
    with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved?t="+str(time.time()),timeout=45) as r:
        api_saved=json.loads(r.read().decode())
except Exception as ex: api_error=repr(ex)

api_events=(api_saved or {}).get("events",[]) if isinstance(api_saved,dict) else []
api_names={str(x.get("remote_name") or "") for x in api_events if isinstance(x,dict)}
missing_still_in_api=[x for x in remote_missing if x["remote_name"] in api_names]

OUT.update({
 "disk":dict(zip(("total","used","free"),shutil.disk_usage("/"))),
 "local":{"events":len(events),"saved_rows":sum(bool(e.get("saved")) for e in events),"clips_on_disk":len([p for p in CLIPS.glob("*") if p.is_file()]),"snaps_on_disk":len([p for p in SNAPS.glob("*") if p.is_file()]),"status_counts":status_counts,"stale_rows":stale},
 "drive":{"archive_items":len(architems),"states":states,"verified_new":len(verified),"remote_inventory_count":len(remote_names) if remote_names is not None else None,"remote_inventory_error":remote_error,"verified_but_remote_missing":remote_missing},
 "saved_api":{"ok":(api_saved or {}).get("ok") if isinstance(api_saved,dict) else None,"count":len(api_events),"error":api_error,"remote_missing_still_returned":missing_still_in_api},
 "files":{
  "trim":grep_rules(TRIM,[r"TARGET_FREE|HARD_FLOOR|MIN_RECENT|SOFT_GRACE|person_status|confirmed_person|likely_person|saved|cloud_verified|rank|unlink|stale"]),
  "drive_retention":grep_rules(RET,[r"reserve|quota|delete|retention|person|confirmed|likely|highlight|rclone|unlink|remove"]),
  "archive_server":grep_rules(SERVER,[r"reconcile_remote|REMOTE_INV_TTL|api/saved|saved/delete|state.*verified|remote_missing|thumbnail|thumb|snapshot"]),
  "saved_ui":grep_rules(SAVED_UI,[r"thumb|snapshot_name|remote_name|api/saved|delete|state|person"])
 },
 "units":{
  "local_trim_service":unit("c720p-archive-quota-trim.service"),
  "local_trim_timer":unit("c720p-archive-quota-trim.timer"),
  "local_trim_timer_cat":cat_unit("c720p-archive-quota-trim.timer"),
  "drive_retention_service":unit("c720p-drive-value-retention.service"),
  "drive_retention_timer":unit("c720p-drive-value-retention.timer"),
  "drive_retention_timer_cat":cat_unit("c720p-drive-value-retention.timer"),
  "archive_server":unit("c720p-drive-security-archive.service")
 },
 "tools":{
   "ffmpeg":shutil.which("ffmpeg"),"ffprobe":shutil.which("ffprobe")
 },
 "person_index_sample":[
   {"key":k,"keys":sorted(v.keys()),"person_status":v.get("person_status"),"person_confidence":v.get("person_confidence"),"highlight_score":v.get("highlight_score"),
    "interesting":{kk:v.get(kk) for kk in v.keys() if any(t in kk.lower() for t in ("frame","time","second","thumb","snap","bbox","person"))}}
   for k,v in list(detitems.items())[:20] if isinstance(v,dict)
 ],
 "event_sample":event_summary[:20],
 "drive_config":{k:v for k,v in cfg.items() if k not in ("token","secret","password","client_secret","refresh_token","access_token")}
})
print(json.dumps(OUT,indent=2,sort_keys=True,default=str))
