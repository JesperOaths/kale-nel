#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import shutil,datetime,subprocess,re,json,time,os,py_compile

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
WWW=Path("/opt/homeassistant/config/www")
UNIT=HOME/".config/systemd/user"
TH=BASE/"bin/c720p-saved-thumbnailer-v107.py"
OLDTH=BASE/"bin/c720p-saved-thumbnailer-v106.py"
LOCAL=BASE/"bin/c720p-archive-quota-trim-v869.py"
DRIVE=BASE/"bin/c720p-drive-value-retention.py"
UI=WWW/"c720p-drive-saved.html"
SURV=WWW/"c720p-surveillance.html"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"security-retention-v107-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)

def backup(p):
    p=Path(p)
    if p.exists():shutil.copy2(p,BACK/(p.name+".before"))

for p in (OLDTH,LOCAL,DRIVE,UI,SURV,UNIT/"c720p-saved-thumbnailer-v106.service",UNIT/"c720p-saved-thumbnailer-v106.timer"):
    backup(p)

# Stop the old long-running batch before replacing its worker.
subprocess.run(["systemctl","--user","stop","c720p-saved-thumbnailer-v106.service"],check=False,timeout=30)

new=Path("/tmp/v107_saved_thumbnailer.py")
if not new.exists():raise SystemExit("V107_WORKER_MISSING")
shutil.copy2(new,TH);TH.chmod(0o755)
# Retain compatibility path: existing tooling/timer names can still refer to v106 filename.
shutil.copy2(new,OLDTH);OLDTH.chmod(0o755)
py_compile.compile(str(TH),doraise=True)

# Strengthen local confirmed-person protection:
# - keep the newest 30 confirmed-person clips locally;
# - even with <900 MB disk free, a cloud-verified confirmed-person local duplicate
#   must be >=30 days old before it can be the absolute last-resort candidate.
s=LOCAL.read_text()
s=s.replace("MIN_RECENT=6;MIN_CONFIRMED_RECENT=20","MIN_RECENT=6;MIN_CONFIRMED_RECENT=30")
s=s.replace('age>=14*24;why="confirmed_person_emergency_cloud_copy"',
            'age>=30*24;why="confirmed_person_emergency_cloud_copy_30d"')
s=s.replace("older than 14 days","older than 30 days").replace("newest 20 confirmed","newest 30 confirmed")
s=s.replace('"policy_version":"v106-person-protected-elastic"',
            '"policy_version":"v107-person-protected-elastic"',1)
LOCAL.write_text(s)
py_compile.compile(str(LOCAL),doraise=True)

# Make the Drive retention audit state reflect the actual V106 protected policy
# on every timer run, including early no-pressure exits.
s=DRIVE.read_text()
if 'drive-value-retention-last.json' not in s:
    s=s.replace('REPORT={"policy_version":"v106-person-protected-drive","started_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"deleted":[]}',
'''REPORT={"policy_version":"v106-person-protected-drive","started_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"deleted":[]}
LAST=BASE/"state/drive-value-retention-last.json"''',1)
    anchor='''def atomic(p,obj):
    q=pathlib.Path(str(p)+".tmp-v106");q.write_text(json.dumps(obj,indent=2,sort_keys=True)+"\\n");os.replace(q,p)
'''
    addition='''def persist_report():
    try:atomic(LAST,REPORT)
    except Exception:pass
import atexit
atexit.register(persist_report)
'''
    if anchor not in s:raise SystemExit("DRIVE_ATOMIC_ANCHOR_MISSING")
    s=s.replace(anchor,anchor+addition,1)
DRIVE.write_text(s)
py_compile.compile(str(DRIVE),doraise=True)

# Thumbnail service now runs in the existing detector venv so it can reuse the
# exact MobileNetSSD/OpenCV stack already installed for the camera.
svc=UNIT/"c720p-saved-thumbnailer-v106.service"
timer=UNIT/"c720p-saved-thumbnailer-v106.timer"
svc.write_text("""[Unit]
Description=C720P person-aware saved clip thumbnail generator V107
After=c720p-drive-security-archive.service network-online.target
Wants=c720p-drive-security-archive.service

[Service]
Type=oneshot
Environment=C720P_THUMB_LIMIT=10
Environment=C720P_THUMB_MAX_SECONDS=720
ExecStart=/home/jespern/c720p-home-hub/person-detector/venv/bin/python /home/jespern/c720p-home-hub/bin/c720p-saved-thumbnailer-v107.py
TimeoutStartSec=13min
Nice=12
IOSchedulingClass=best-effort
IOSchedulingPriority=7
""")
timer.write_text("""[Unit]
Description=C720P progressive person-aware saved thumbnail refresh V107

[Timer]
OnBootSec=3min
OnUnitActiveSec=12min
RandomizedDelaySec=45
Persistent=true
Unit=c720p-saved-thumbnailer-v106.service

[Install]
WantedBy=timers.target
""")

# Gallery: preserve all three moments instead of cropping the strip, and reconcile
# Drive deletions every 30 seconds while visible.
s=UI.read_text()
s=s.replace("object-fit:cover!important;object-position:center center!important",
            "object-fit:contain!important;object-position:center center!important")
s=s.replace("setInterval(()=>{try{if(document.visibilityState==='visible'&&typeof load==='function'){if(typeof savedThumbManifest!=='undefined')savedThumbManifest=null;load()}}catch(_){}},60000);",
            "setInterval(()=>{try{if(document.visibilityState==='visible'&&typeof load==='function'){if(typeof savedThumbManifest!=='undefined')savedThumbManifest=null;load()}}catch(_){}},30000);")
if "C720P_SAVED_THUMB_V107" not in s:
    s=s.replace("</head>",'''<style id="C720P_SAVED_THUMB_V107">
.thumbWrap{background:#020609!important}
.thumb{object-fit:contain!important;object-position:center center!important}
</style>
</head>''',1)
UI.write_text(s)

# Cache-bust Saved Clips iframe without changing Security layout.
ss=SURV.read_text()
ss=re.sub(r'/local/c720p-drive-saved\.html\?camera=camera&v=[^"\']+',
          '/local/c720p-drive-saved.html?camera=camera&v=SAVED_THUMB_V107_20261007',ss)
SURV.write_text(ss)

subprocess.run(["systemctl","--user","daemon-reload"],check=True,timeout=20)
subprocess.run(["systemctl","--user","enable","--now",timer.name],check=True,timeout=30)
subprocess.run(["systemctl","--user","restart","c720p-drive-security-archive.service"],check=True,timeout=45)

# Verify detector runtime before touching the gallery manifest.
vpy=BASE/"person-detector/venv/bin/python"
r=subprocess.run([str(vpy),"-c","import cv2,numpy; print(cv2.__version__,numpy.__version__)"],text=True,capture_output=True,timeout=30)
if r.returncode:raise SystemExit("DETECTOR_VENV_FAILED:"+r.stderr[-800:])

# Small synchronous V107 batch. Progress is written after each clip, so even a
# later failure cannot erase thumbnails already produced.
env=os.environ.copy()
env["C720P_THUMB_LIMIT"]="4"
env["C720P_THUMB_MAX_SECONDS"]="420"
tr=subprocess.run([str(vpy),str(TH)],env=env,text=True,capture_output=True,timeout=480)
if tr.returncode:raise SystemExit("V107_THUMB_RUN_FAILED:"+tr.stderr[-1600:])

subprocess.run(["systemctl","--user","restart","c720p-home-hub-kiosk.service"],check=False,timeout=25)

man=WWW/"c720p-saved-thumbs/manifest.json"
md=json.loads(man.read_text()) if man.exists() else {}
items=md.get("items",{}) if isinstance(md,dict) else {}
v107=[v for v in items.values() if isinstance(v,dict) and v.get("version")=="v107"]
person_model=sum(1 for v in v107 if v.get("thumbnail_method")=="person-model+motion")
print(json.dumps({
    "ok":True,
    "version":"v107",
    "backup":str(BACK),
    "detector_runtime":r.stdout.strip(),
    "thumbnail_run":json.loads(tr.stdout),
    "manifest_items":len(items),
    "v107_items":len(v107),
    "v107_person_model_items":person_model,
    "local_confirmed_recent_protected":30,
    "local_confirmed_emergency_min_age_days":30,
    "drive_confirmed_person_auto_delete":False,
    "gallery_reconcile_seconds":30,
    "timer_active":subprocess.run(["systemctl","--user","is-active",timer.name],text=True,capture_output=True).stdout.strip()
},indent=2))
