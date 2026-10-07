#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import datetime, json, os, shutil, subprocess, time, urllib.request

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
BIN=BASE/"bin"
WWW=Path("/opt/homeassistant/config/www")
WORKER=BIN/"c720p-saved-fast-thumbnailer-v112.py"
SU=HOME/".config/systemd/user/c720p-saved-fast-thumbnailer-v112.service"
TU=HOME/".config/systemd/user/c720p-saved-fast-thumbnailer-v112.timer"
VISION_TIMER="c720p-saved-thumbnailer-v106.timer"
VISION_SERVICE="c720p-saved-thumbnailer-v106.service"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"security-thumbnail-v112-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)

for p in (WORKER,SU,TU,WWW/"c720p-saved-thumbs/manifest.json"):
    if p.exists():shutil.copy2(p,BACK/(p.name+".before"))

worker=r'''#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import hashlib,json,os,subprocess,time,urllib.request

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
WWW=Path("/opt/homeassistant/config/www")
OUT=WWW/"c720p-saved-thumbs"
MAN=OUT/"manifest.json"
CFG=BASE/"config/drive-security-archive.json"
API="http://127.0.0.1:8795/new/api/saved"
OUT.mkdir(parents=True,exist_ok=True)

def load(p,default):
    try:return json.loads(Path(p).read_text())
    except Exception:return default

def saved_rows():
    with urllib.request.urlopen(API+"?t="+str(time.time()),timeout=90) as r:
        d=json.loads(r.read().decode())
    return [x for x in d.get("events",[]) if isinstance(x,dict) and x.get("remote_name")]

def out_for(name):
    return OUT/(hashlib.sha1(name.encode()).hexdigest()[:20]+".jpg")

def valid(items,name):
    rec=items.get(name)
    if not isinstance(rec,dict):return False
    f=OUT/str(rec.get("file") or "")
    return f.is_file() and f.stat().st_size>2500

def atomic(manifest,items):
    manifest["version"]="v112-fast-fallback+v108-upgrade"
    manifest["generated_at"]=time.time()
    manifest["items"]=items
    q=MAN.with_suffix(".json.tmp-v112")
    q.write_text(json.dumps(manifest,indent=2,sort_keys=True)+"\n")
    os.replace(q,MAN)

def resize(src,dst):
    tmp=dst.with_suffix(".tmp-v112.jpg")
    try:
        if tmp.exists():tmp.unlink()
    except:pass
    r=subprocess.run(["/usr/bin/ffmpeg","-hide_banner","-loglevel","error","-y","-i",str(src),
                      "-frames:v","1","-vf","scale=900:-2","-q:v","5",str(tmp)],
                     text=True,capture_output=True,timeout=35)
    if r.returncode==0 and tmp.is_file() and tmp.stat().st_size>2500:
        os.replace(tmp,dst);return True
    try:tmp.unlink()
    except:pass
    return False

def from_snapshot(cfg,e,dst):
    snap=Path(str(e.get("snapshot_name") or "")).name
    if not snap or ".." in snap:return False
    shm=Path("/dev/shm") if Path("/dev/shm").is_dir() else Path("/tmp")
    src=shm/("c720p-fast-snap-"+hashlib.sha1(snap.encode()).hexdigest()[:12]+".jpg")
    try:
        if src.exists():src.unlink()
    except:pass
    r=subprocess.run([cfg["rclone"],"--config",cfg["rclone_config"],"copyto",
                      cfg["remote"]+":"+snap,str(src),"--drive-root-folder-id",
                      str(cfg["folders"]["new"]["id"]),"--retries","1","--low-level-retries","2"],
                     text=True,capture_output=True,timeout=50)
    ok=r.returncode==0 and src.is_file() and src.stat().st_size>1000 and resize(src,dst)
    try:src.unlink()
    except:pass
    return ok

def from_video(e,dst):
    name=Path(str(e.get("remote_name") or "")).name
    if not name or ".." in name:return (False,None)
    url="http://127.0.0.1:8795/new/saved/clip/"+name
    for seek in (5,15,25,1):
        tmp=dst.with_suffix(".tmp-v112.jpg")
        try:
            if tmp.exists():tmp.unlink()
        except:pass
        r=subprocess.run(["/usr/bin/ffmpeg","-hide_banner","-loglevel","error","-y",
                          "-ss",str(seek),"-i",url,"-frames:v","1","-vf","scale=900:-2",
                          "-q:v","5",str(tmp)],text=True,capture_output=True,timeout=70)
        if r.returncode==0 and tmp.is_file() and tmp.stat().st_size>2500:
            os.replace(tmp,dst);return (True,seek)
        try:tmp.unlink()
        except:pass
    return (False,None)

def main():
    cfg=load(CFG,{})
    manifest=load(MAN,{})
    items=manifest.get("items",{}) if isinstance(manifest,dict) else {}
    if not isinstance(items,dict):items={}
    rows=saved_rows()
    missing=[e for e in rows if not valid(items,str(e.get("remote_name") or ""))]
    limit=int(os.environ.get("C720P_FAST_THUMB_LIMIT","8") or "8")
    todo=missing if limit<=0 else missing[:limit]
    made=[];failed=[]
    for e in todo:
        name=Path(str(e.get("remote_name") or "")).name
        dst=out_for(name)
        method="archived-snapshot-fast-v112"
        seek=None
        ok=from_snapshot(cfg,e,dst)
        if not ok:
            ok,seek=from_video(e,dst)
            method="remote-video-range-frame-v112"
        if not ok:
            failed.append(name);continue
        items[name]={
            "duration":None,
            "file":dst.name,
            "generated_at":time.time(),
            "model":method,
            "panels":[],
            "person_status":str(e.get("person_status") or "unknown"),
            "primary_panel":0,
            "primary_person_confidence":float(e.get("person_confidence") or 0),
            "primary_time":seek,
            "sample_count":0,
            "thumbnail_method":method,
            "url":"/local/c720p-saved-thumbs/"+dst.name,
            "version":"v112-fast",
        }
        made.append({"remote_name":name,"method":method,"seek":seek})
        atomic(manifest,items)
    atomic(manifest,items)
    remaining=sum(1 for e in rows if not valid(items,str(e.get("remote_name") or "")))
    print(json.dumps({"ok":not failed,"saved_events":len(rows),"missing_before":len(missing),
                      "attempted":len(todo),"generated":len(made),"failed":failed,
                      "remaining":remaining,"made":made},indent=2))

if __name__=="__main__":main()
'''
WORKER.write_text(worker);WORKER.chmod(0o755)
r=subprocess.run(["python3","-m","py_compile",str(WORKER)],text=True,capture_output=True)
if r.returncode:raise SystemExit("WORKER_COMPILE_FAILED:"+r.stderr[-1000:])

SU.write_text('''[Unit]
Description=C720P fast saved-thumbnail coverage worker V112
After=c720p-drive-security-archive.service network-online.target
Wants=c720p-drive-security-archive.service

[Service]
Type=oneshot
Environment=C720P_FAST_THUMB_LIMIT=8
ExecStart=/usr/bin/flock -n -E 0 /run/user/1000/c720p-vision.lock /usr/bin/python3 /home/jespern/c720p-home-hub/bin/c720p-saved-fast-thumbnailer-v112.py
TimeoutStartSec=12min
Nice=15
IOSchedulingClass=best-effort
IOSchedulingPriority=7
''')
TU.write_text('''[Unit]
Description=C720P fast saved-thumbnail coverage timer V112

[Timer]
OnBootSec=2min
OnUnitInactiveSec=5min
RandomizedDelaySec=30s
Persistent=true
Unit=c720p-saved-fast-thumbnailer-v112.service

[Install]
WantedBy=timers.target
''')

subprocess.run(["systemctl","--user","stop",VISION_TIMER],check=False,timeout=20)
subprocess.run(["systemctl","--user","stop",VISION_SERVICE],check=False,timeout=30)
subprocess.run(["systemctl","--user","daemon-reload"],check=True,timeout=20)

env=os.environ.copy();env["C720P_FAST_THUMB_LIMIT"]="0"
run=subprocess.run(["/usr/bin/python3",str(WORKER)],env=env,text=True,capture_output=True,timeout=900)
if run.returncode:raise SystemExit("FAST_BACKFILL_FAILED:"+run.stderr[-1600:])

subprocess.run(["systemctl","--user","enable","--now",VISION_TIMER],check=True,timeout=30)
subprocess.run(["systemctl","--user","enable","--now",TU.name],check=True,timeout=30)

result=json.loads(run.stdout)
man=json.loads((WWW/"c720p-saved-thumbs/manifest.json").read_text())
items=man.get("items",{})
with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved?t="+str(time.time()),timeout=90) as resp:
    events=json.loads(resp.read().decode()).get("events",[])
missing=[]
for e in events:
    n=str(e.get("remote_name") or "");rec=items.get(n) if isinstance(items,dict) else None
    f=WWW/"c720p-saved-thumbs"/str((rec or {}).get("file") or "")
    if not rec or not f.is_file() or f.stat().st_size<=2500:missing.append(n)
cache=sum(p.stat().st_size for p in (WWW/"c720p-saved-thumbs").glob("*.jpg"))
print(json.dumps({
    "ok":len(missing)==0,
    "version":"v112",
    "backup":str(BACK),
    "one_time":result,
    "coverage":len(events)-len(missing),
    "saved_events":len(events),
    "missing":missing,
    "thumbnail_cache_mb":round(cache/1024/1024,2),
    "fast_timer":subprocess.run(["systemctl","--user","is-active",TU.name],text=True,capture_output=True).stdout.strip(),
    "vision_timer":subprocess.run(["systemctl","--user","is-active",VISION_TIMER],text=True,capture_output=True).stdout.strip()
},indent=2))
