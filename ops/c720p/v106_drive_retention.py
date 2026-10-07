#!/usr/bin/env python3
from __future__ import annotations
import json,pathlib,subprocess,time,os,datetime,shutil,urllib.request

HOME=pathlib.Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
IDX=BASE/"state/drive-security-archive.json"
CFG=BASE/"config/drive-security-archive.json"
DET=BASE/"state/person-detection-index.json"
EVENTS=pathlib.Path("/opt/homeassistant/config/www/frontyard-security-new/events.json")
CACHE=BASE/"drive-playback-cache"
TH=BASE/"drive-archive-thumbs"
REPORT={"policy_version":"v106-person-protected-drive","started_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"deleted":[]}

def load(p,d):
    try:return json.loads(pathlib.Path(p).read_text())
    except:return d
def atomic(p,obj):
    q=pathlib.Path(str(p)+".tmp-v106");q.write_text(json.dumps(obj,indent=2,sort_keys=True)+"\n");os.replace(q,p)
def safe(v):return pathlib.Path(str(v or "")).name
def parse_ts(v):
    if isinstance(v,(int,float)):return float(v)
    if isinstance(v,str):
        s=v[:19]
        for f in ("%Y-%m-%dT%H:%M:%S","%Y-%m-%d %H:%M:%S"):
            try:return time.mktime(time.strptime(s,f))
            except:pass
    return 0
def event_rows(d):
    if isinstance(d,list):return d
    if isinstance(d,dict):
        for k in ("events","items","clips"):
            if isinstance(d.get(k),list):return d[k]
    return []

cfg=load(CFG,{})
idx=load(IDX,{"items":[]})
items=idx.get("items",[]) if isinstance(idx,dict) else []
det=load(DET,{})
ditems=det.get("items",{}) if isinstance(det,dict) else {}
events=event_rows(load(EVENTS,[]))
manual={safe(e.get("clip") or e.get("clip_name")) for e in events if bool(e.get("saved"))}

rclone=str(cfg.get("rclone") or "rclone")
rconf=str(cfg.get("rclone_config") or "")
remote=str(cfg.get("remote") or "")
folder=str(((cfg.get("folders") or {}).get("new") or {}).get("id") or "")
reserve=int(float(cfg.get("reserve_free_gb",5.0))*1024**3)
target=reserve+512*1024**2

def about():
    cmd=[rclone,"--config",rconf,"about",remote+":","--json"]
    r=subprocess.run(cmd,text=True,capture_output=True,timeout=90)
    if r.returncode:return None,(r.stderr or r.stdout)[-800:]
    try:
        d=json.loads(r.stdout);return d,None
    except Exception as ex:return None,repr(ex)

def del_remote(name):
    name=safe(name)
    if not name:return True,""
    cmd=[rclone,"--config",rconf,"deletefile",remote+":"+name]
    if folder:cmd+=["--drive-root-folder-id",folder]
    cmd+=["--drive-use-trash=false"]
    r=subprocess.run(cmd,text=True,capture_output=True,timeout=120)
    if r.returncode==0:return True,(r.stderr or r.stdout)[-800:]
    # Treat already-absent objects as successfully reconciled, but fail closed on other Drive errors.
    chk=[rclone,"--config",rconf,"lsjson",remote+":"+name]
    if folder:chk+=["--drive-root-folder-id",folder]
    chk+=["--files-only"]
    q=subprocess.run(chk,text=True,capture_output=True,timeout=60)
    missing=q.returncode!=0 or not (q.stdout or "").strip() or (q.stdout or "").strip()=="[]"
    return missing,(r.stderr or r.stdout)[-800:]

ab,err=about()
free=int(ab.get("free")) if isinstance(ab,dict) and isinstance(ab.get("free"),(int,float)) else None
REPORT.update({"drive_free_before":free,"reserve_bytes":reserve,"target_bytes":target,"about_error":err})
if free is None:
    REPORT["action"]="no_delete_drive_free_unknown";print(json.dumps(REPORT,indent=2));raise SystemExit(0)
if free>=reserve:
    REPORT["action"]="no_pressure";REPORT["drive_free_after"]=free;print(json.dumps(REPORT,indent=2));raise SystemExit(0)

verified=[x for x in items if x.get("camera")=="new" and x.get("state")=="verified" and x.get("remote_name")]
ordered=sorted(verified,key=lambda x:parse_ts(x.get("timestamp")),reverse=True)
newest={id(x) for x in ordered[:30]}
now=time.time()
cands=[];protected={"manual":0,"confirmed_person":0,"newest":0,"likely_young":0,"recent_other":0}
for x in ordered:
    name=safe(x.get("remote_name"));local=safe(x.get("local_clip_name") or "")
    di=ditems.get("new:"+local,{}) if isinstance(ditems,dict) else {}
    st=str(di.get("person_status") or x.get("person_status") or "unknown")
    age=(now-parse_ts(x.get("timestamp")))/86400 if parse_ts(x.get("timestamp")) else 99999
    is_manual=local in manual or bool(x.get("manual_saved"))
    if is_manual:protected["manual"]+=1;continue
    if st=="confirmed_person":
        # Confirmed people in the front-garden camera are evidence. Never delete
        # them automatically. If these eventually consume the archive, uploads
        # pause at the configured Drive reserve instead.
        protected["confirmed_person"]+=1;continue
    if id(x) in newest:protected["newest"]+=1;continue
    if st=="likely_person" and age<45:protected["likely_young"]+=1;continue
    if st in ("uncertain","unknown","") and age<14:protected["recent_other"]+=1;continue
    if st in ("confirmed_no_person","no_person_sampled") and age<7:protected["recent_other"]+=1;continue
    rank={"confirmed_no_person":0,"no_person_sampled":1,"uncertain":2,"unknown":3,"":3,"likely_person":4}.get(st,3)
    try:pc=float(di.get("person_confidence") or x.get("person_confidence") or 0)
    except:pc=0
    try:hs=float(di.get("highlight_score") or x.get("highlight_score") or 0)
    except:hs=0
    cands.append({"row":x,"name":name,"status":st,"age_days":age,"rank":rank,"person":pc,"highlight":hs,"size":int(x.get("size") or 0)})

cands.sort(key=lambda z:(z["rank"],-z["age_days"],z["highlight"],z["person"],-z["size"]))
for c in cands:
    ab,_=about();cur=int(ab.get("free")) if isinstance(ab,dict) and isinstance(ab.get("free"),(int,float)) else None
    if cur is None or cur>=target:break
    x=c["row"]
    ok1,msg1=del_remote(c["name"])
    ok2,msg2=del_remote(x.get("snapshot_name"))
    if not (ok1 and ok2):
        REPORT.setdefault("delete_errors",[]).append({"name":c["name"],"clip_ok":ok1,"snapshot_ok":ok2,"clip_error":msg1,"snapshot_error":msg2});continue
    stamp=datetime.datetime.now().astimezone().isoformat()
    x["state"]="deleted";x["deleted_at"]=stamp;x["delete_reason"]="v106_drive_retention_"+c["status"]
    for p in [CACHE/"new"/c["name"], TH/"new"/safe(x.get("snapshot_name"))]:
        try:
            if p.is_file():p.unlink()
        except:pass
    REPORT["deleted"].append({"remote_name":c["name"],"person_status":c["status"],"age_days":round(c["age_days"],1),"size":c["size"]})

if REPORT["deleted"]:atomic(IDX,idx)
ab,_=about();free_after=int(ab.get("free")) if isinstance(ab,dict) and isinstance(ab.get("free"),(int,float)) else None
REPORT.update({"action":"trimmed" if REPORT["deleted"] else "protected_archive_blocked","protected":protected,"candidate_count":len(cands),"drive_free_after":free_after,"confirmed_person_auto_delete":False,"manual_saved_auto_delete":False,"finished_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())})
try:
    token=(HOME/".config/c720p-agent/security-token").read_text().strip()
    req=urllib.request.Request("https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/c720p-security-control?action=health",data=json.dumps({"observed_at":REPORT["finished_at"],"maintenance":{"v106_drive_retention":REPORT}},separators=(",",":")).encode(),method="POST",headers={"content-type":"application/json","x-c720p-token":token})
    with urllib.request.urlopen(req,timeout=15) as r:REPORT["health_post_status"]=r.status
except Exception as ex:REPORT["health_post_error"]=repr(ex)
print(json.dumps(REPORT,indent=2,sort_keys=True))
