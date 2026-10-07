#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import datetime, hashlib, json, os, shutil, subprocess, time, urllib.parse, urllib.request

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
WWW=Path("/opt/homeassistant/config/www")
OUT=WWW/"c720p-saved-thumbs"
MAN=OUT/"manifest.json"
CFG=BASE/"config/drive-security-archive.json"
VISION_TIMER="c720p-saved-thumbnailer-v106.timer"
VISION_SERVICE="c720p-saved-thumbnailer-v106.service"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"security-thumbnail-v113-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
OUT.mkdir(parents=True,exist_ok=True)

if MAN.exists(): shutil.copy2(MAN,BACK/"manifest.json.before")

def load_json(p,default):
    try:return json.loads(Path(p).read_text())
    except Exception:return default

def saved_rows():
    with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved?t="+str(time.time()),timeout=90) as r:
        d=json.loads(r.read().decode())
    return [x for x in d.get("events",[]) if isinstance(x,dict) and x.get("remote_name")]

def out_for(name):
    return OUT/(hashlib.sha1(name.encode()).hexdigest()[:20]+".jpg")

def is_valid(items,name):
    rec=items.get(name)
    if not isinstance(rec,dict): return False
    f=OUT/str(rec.get("file") or "")
    return f.is_file() and f.stat().st_size>2500

def atomic(manifest,items):
    manifest["version"]="v113-complete-fast+v108-upgrade"
    manifest["generated_at"]=time.time()
    manifest["items"]=items
    q=MAN.with_suffix(".json.tmp-v113")
    q.write_text(json.dumps(manifest,indent=2,sort_keys=True)+"\n")
    os.replace(q,MAN)

def frame_from_http(name,dst):
    url="http://127.0.0.1:8795/new/saved/clip/"+urllib.parse.quote(name)
    for seek in (5,1,15):
        tmp=dst.with_suffix(".tmp-v113.jpg")
        try:
            if tmp.exists():tmp.unlink()
        except Exception:pass
        r=subprocess.run([
            "/usr/bin/ffmpeg","-hide_banner","-loglevel","error","-y",
            "-rw_timeout","20000000","-ss",str(seek),"-i",url,
            "-frames:v","1","-vf","scale=900:-2","-q:v","5",str(tmp)
        ],text=True,capture_output=True,timeout=35)
        if r.returncode==0 and tmp.is_file() and tmp.stat().st_size>2500:
            os.replace(tmp,dst)
            return True,seek
        try:tmp.unlink()
        except Exception:pass
    return False,None

def frame_from_local_download(cfg,name,dst):
    tmpdir=Path("/dev/shm") if Path("/dev/shm").is_dir() else Path("/tmp")
    src=tmpdir/("c720p-v113-"+hashlib.sha1(name.encode()).hexdigest()[:12]+".mp4")
    try:
        if src.exists():src.unlink()
    except Exception:pass
    r=subprocess.run([
        cfg["rclone"],"--config",cfg["rclone_config"],"copyto",
        cfg["remote"]+":"+name,str(src),
        "--drive-root-folder-id",str(cfg["folders"]["new"]["id"]),
        "--retries","1","--low-level-retries","2"
    ],text=True,capture_output=True,timeout=150)
    if r.returncode or not src.is_file() or src.stat().st_size<10000:
        try:src.unlink()
        except Exception:pass
        return False,None
    for seek in (5,1,15):
        tmp=dst.with_suffix(".tmp-v113.jpg")
        try:
            if tmp.exists():tmp.unlink()
        except Exception:pass
        f=subprocess.run([
            "/usr/bin/ffmpeg","-hide_banner","-loglevel","error","-y",
            "-ss",str(seek),"-i",str(src),"-frames:v","1",
            "-vf","scale=900:-2","-q:v","5",str(tmp)
        ],text=True,capture_output=True,timeout=35)
        if f.returncode==0 and tmp.is_file() and tmp.stat().st_size>2500:
            os.replace(tmp,dst)
            try:src.unlink()
            except Exception:pass
            return True,seek
        try:tmp.unlink()
        except Exception:pass
    try:src.unlink()
    except Exception:pass
    return False,None

def install_record(items,e,dst,method,seek):
    name=Path(str(e.get("remote_name") or "")).name
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
        "version":"v113-fast",
    }

# Freeze the V108 writer only during this short repair so manifest writes cannot race.
subprocess.run(["systemctl","--user","stop",VISION_TIMER],check=False,timeout=20)
subprocess.run(["systemctl","--user","stop",VISION_SERVICE],check=False,timeout=40)

cfg=load_json(CFG,{})
manifest=load_json(MAN,{})
items=manifest.get("items",{}) if isinstance(manifest,dict) else {}
if not isinstance(items,dict):items={}
rows=saved_rows()
missing_before=[e for e in rows if not is_valid(items,str(e.get("remote_name") or ""))]
made=[];failed=[]

for e in missing_before:
    name=Path(str(e.get("remote_name") or "")).name
    if not name or ".." in name:
        failed.append({"remote_name":name,"reason":"invalid_name"});continue
    dst=out_for(name)
    ok,seek=frame_from_http(name,dst)
    method="remote-video-range-frame-v113"
    if not ok:
        ok,seek=frame_from_local_download(cfg,name,dst)
        method="remote-video-local-fallback-v113"
    if not ok:
        failed.append({"remote_name":name,"reason":"video_frame_failed"});continue
    install_record(items,e,dst,method,seek)
    atomic(manifest,items)
    made.append({"remote_name":name,"method":method,"seek":seek})

atomic(manifest,items)
subprocess.run(["systemctl","--user","enable","--now",VISION_TIMER],check=True,timeout=30)

# Final verification is based on file presence, not manifest claims alone.
rows2=saved_rows()
manifest2=load_json(MAN,{})
items2=manifest2.get("items",{}) if isinstance(manifest2,dict) else {}
missing_after=[e for e in rows2 if not is_valid(items2,str(e.get("remote_name") or ""))]
wanted={22,143,134,130,124,915}
checks=[]
for e in rows2:
    try:no=int(e.get("clip_no"))
    except Exception:continue
    if no not in wanted:continue
    n=str(e.get("remote_name") or "")
    rec=items2.get(n,{}) if isinstance(items2,dict) else {}
    f=OUT/str(rec.get("file") or "")
    checks.append({
        "clip_no":no,"timestamp":e.get("timestamp"),"covered":f.is_file() and f.stat().st_size>2500,
        "version":rec.get("version"),"method":rec.get("thumbnail_method")
    })

cache=sum(p.stat().st_size for p in OUT.glob("*.jpg"))
print(json.dumps({
    "ok":len(missing_after)==0,
    "version":"v113",
    "backup":str(BACK),
    "saved_events":len(rows2),
    "coverage_before":len(rows)-len(missing_before),
    "missing_before":len(missing_before),
    "generated":len(made),
    "failed":failed,
    "coverage_after":len(rows2)-len(missing_after),
    "missing_after":[str(x.get("remote_name") or "") for x in missing_after],
    "thumbnail_cache_mb":round(cache/1024/1024,2),
    "screenshot_clip_checks":checks,
    "vision_timer_active":subprocess.run(["systemctl","--user","is-active",VISION_TIMER],text=True,capture_output=True).stdout.strip()
},indent=2))
