#!/usr/bin/env python3
from __future__ import annotations
import argparse, datetime, json, pathlib, shutil, subprocess, tempfile

BASE=pathlib.Path("/home/jespern/c720p-home-hub")
INDEX=BASE/"state/drive-security-archive.json"
CONFIG=BASE/"config/drive-security-archive.json"

def load_json(p):
    return json.loads(p.read_text(encoding="utf-8"))

def safe(v):
    return pathlib.Path(str(v or "")).name

def remote_names(cfg,cam):
    folder=(cfg.get("folders") or {}).get(cam) or {}
    folder_id=str(folder.get("id") or "")
    if not folder_id:
        return None,"missing_folder_id"
    cmd=[str(cfg["rclone"]),"--config",str(cfg["rclone_config"]),"lsjson",
         str(cfg["remote"])+":","--drive-root-folder-id",folder_id,"--files-only"]
    try:
        r=subprocess.run(cmd,text=True,capture_output=True,timeout=120)
    except Exception as e:
        return None,f"{type(e).__name__}:{e}"
    if r.returncode:
        return None,(r.stderr or r.stdout or "rclone_failed")[-500:]
    try:
        rows=json.loads(r.stdout) if r.stdout.strip() else []
        return {str(x.get("Name") or "") for x in rows if isinstance(x,dict) and x.get("Name")},""
    except Exception as e:
        return None,f"json:{type(e).__name__}:{e}"

def atomic_write(data):
    INDEX.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(prefix=INDEX.name+".",suffix=".tmp",dir=str(INDEX.parent))
    pathlib.Path(tmp).write_text(json.dumps(data,indent=2,sort_keys=True)+"\n",encoding="utf-8")
    pathlib.Path(tmp).replace(INDEX)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--apply",action="store_true")
    args=ap.parse_args()

    data=load_json(INDEX); cfg=load_json(CONFIG)
    items=data.get("items") or []
    cams=sorted({str(x.get("camera")) for x in items if x.get("camera")})
    inventories={}
    errors={}
    for cam in cams:
        names,err=remote_names(cfg,cam)
        inventories[cam]=names
        if err: errors[cam]=err

    audit={"missing_total":0,"remote_present":0,"remote_absent":0,"unresolved":0,"by_camera":{},"errors":errors}
    changes=[]
    stamp=datetime.datetime.now().astimezone().isoformat()
    for x in items:
        if x.get("state")!="missing": continue
        audit["missing_total"]+=1
        cam=str(x.get("camera") or "")
        c=audit["by_camera"].setdefault(cam,{"missing":0,"remote_present":0,"remote_absent":0,"unresolved":0})
        c["missing"]+=1
        name=safe(x.get("remote_name"))
        names=inventories.get(cam)
        if not name or names is None:
            audit["unresolved"]+=1;c["unresolved"]+=1
            continue
        if name in names:
            audit["remote_present"]+=1;c["remote_present"]+=1
            changes.append((x,"verified","historical_missing_remote_present"))
        else:
            audit["remote_absent"]+=1;c["remote_absent"]+=1
            changes.append((x,"deleted","historical_missing_remote_absent"))

    print(json.dumps(audit,indent=2,sort_keys=True))
    if not args.apply:
        print("APPLY=false")
        return 0

    if errors:
        raise SystemExit("refusing_apply_remote_inventory_error")

    backup=INDEX.with_name(INDEX.name+".before-v868-missing-normalize-"+datetime.datetime.now().strftime("%Y%m%d_%H%M%S"))
    shutil.copy2(INDEX,backup)
    counts={"verified":0,"deleted":0}
    for x,state,reason in changes:
        x["state"]=state
        x["reconciled_at"]=stamp
        x["reconcile_reason"]=reason
        if state=="deleted":
            x.setdefault("deleted_at",stamp)
            x.setdefault("delete_reason","historical_remote_missing_normalized")
        else:
            x.pop("deleted_at",None)
            x.pop("delete_reason",None)
        counts[state]+=1
    atomic_write(data)
    print("BACKUP="+str(backup))
    print("CHANGES="+json.dumps(counts,sort_keys=True))
    print("RESULT=DRIVE_MISSING_V868_NORMALIZED")
    return 0

if __name__=="__main__":
    raise SystemExit(main())
