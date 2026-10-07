#!/usr/bin/env python3
from pathlib import Path
import datetime,json,re,shutil,subprocess

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
BIN=BASE/"bin"
UNIT=HOME/".config/systemd/user"
DRIVE=BIN/"c720p-drive-person-revalidate-v126.py"
IDX=BASE/"state/drive-security-archive.json"
WRAP=BIN/"c720p-night-vehicle-backfill-v127.py"
SU=UNIT/"c720p-night-vehicle-backfill-v127.service"
TU=UNIT/"c720p-night-vehicle-backfill-v127.timer"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"person-night-vehicle-backfill-v127-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)

for p in (DRIVE,SU,TU):
    if p.exists():shutil.copy2(p,BACK/(p.name+".before"))

if not DRIVE.exists():
    raise SystemExit("V126_DRIVE_REVALIDATOR_MISSING")

# Prioritize the strongest legacy vehicle-conflict labels first instead of merely
# walking the archive by timestamp.
s=DRIVE.read_text()
old="""  rows.append((rank,str(x.get('timestamp') or ''),x))
 if not rows:"""
new="""  rows.append((rank,-vc,str(x.get('timestamp') or ''),x))
 if not rows:"""
if old in s:s=s.replace(old,new,1)
elif "rows.append((rank,-vc,str(x.get('timestamp')" not in s:
    raise SystemExit("DRIVE_PRIORITY_APPEND_ANCHOR_MISSING")
s=s.replace(" rows.sort(key=lambda z:(z[0],z[1]))\n x=rows[0][2]",
            " rows.sort(key=lambda z:(z[0],z[1],z[2]))\n x=rows[0][3]",1)
DRIVE.write_text(s)
r=subprocess.run([str(BASE/"person-detector/venv/bin/python"),"-m","py_compile",str(DRIVE)],
                 text=True,capture_output=True)
if r.returncode:raise SystemExit("DRIVE_REVALIDATOR_COMPILE_FAILED:"+r.stderr[-1200:])

WRAP.write_text(r'''#!/usr/bin/env python3
import json,pathlib,subprocess,datetime
B=pathlib.Path("/home/jespern/c720p-home-hub")
IDX=B/"state/drive-security-archive.json"
MODEL="hybrid-mobilenetssd+yolov5n-night-vehicle-cpusafe-v126"
def night(v):
    s=str(v or "")
    try:
        h=int(s[11:13]);return h>=20 or h<7
    except:return False
try:d=json.loads(IDX.read_text())
except Exception as e:
    print("NIGHT_VEHICLE_BACKFILL index_unavailable",type(e).__name__);raise SystemExit(0)
risk=[]
for x in d.get("items",[]):
    if x.get("camera")!="new" or x.get("state")!="verified" or not x.get("remote_name"):continue
    if str(x.get("person_status") or "")!="confirmed_person":continue
    if not night(x.get("timestamp")):continue
    try:vc=float(x.get("car_confidence") or 0)
    except:vc=0.0
    if vc<.30:continue
    if x.get("person_review_model")==MODEL:continue
    risk.append((vc,str(x.get("timestamp") or ""),x.get("clip_no"),x.get("remote_name")))
risk.sort(reverse=True)
print("NIGHT_VEHICLE_BACKFILL remaining="+str(len(risk))+
      (" next_conf="+str(round(risk[0][0],3))+" next_clip="+str(risk[0][2]) if risk else ""))
if not risk:raise SystemExit(0)
# The normal revalidator owns the vision lock and all archive locking. Trigger it
# without blocking this cheap backlog watcher for the several-minute full scan.
subprocess.run(["systemctl","--user","start","--no-block","c720p-drive-person-revalidate.service"],
               check=False,timeout=15)
''')
WRAP.chmod(0o755)

SU.write_text(f"""[Unit]
Description=C720P nighttime car/truck false-person backlog accelerator
After=network-online.target c720p-drive-security-archive.service

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 {WRAP}
Nice=19
IOSchedulingClass=idle
TimeoutStartSec=30
""")
TU.write_text("""[Unit]
Description=Recheck strongest nighttime vehicle/person conflicts every 30 minutes

[Timer]
OnBootSec=8min
OnUnitInactiveSec=30min
RandomizedDelaySec=2min
Persistent=true

[Install]
WantedBy=timers.target
""")

subprocess.run(["systemctl","--user","daemon-reload"],check=True,timeout=20)
subprocess.run(["systemctl","--user","enable","--now",TU.name],check=True,timeout=30)
# Trigger once now; wrapper itself is cheap and only launches the existing safe service.
subprocess.run(["systemctl","--user","start",SU.name],check=False,timeout=30)

d=json.loads(IDX.read_text())
remaining=[]
for x in d.get("items",[]):
    if x.get("camera")!="new" or x.get("state")!="verified" or not x.get("remote_name"):continue
    if str(x.get("person_status") or "")!="confirmed_person":continue
    s=str(x.get("timestamp") or "")
    try:h=int(s[11:13]);isnight=h>=20 or h<7
    except:isnight=False
    try:vc=float(x.get("car_confidence") or 0)
    except:vc=0.0
    if isnight and vc>=.30 and x.get("person_review_model")!="hybrid-mobilenetssd+yolov5n-night-vehicle-cpusafe-v126":
        remaining.append((vc,x.get("clip_no"),x.get("timestamp")))

print(json.dumps({
    "ok":True,
    "version":"v127",
    "backup":str(BACK),
    "high_risk_legacy_remaining":len(remaining),
    "highest_risk":sorted(remaining,reverse=True)[:10],
    "backfill_timer":subprocess.run(["systemctl","--user","is-active",TU.name],
                                    text=True,capture_output=True).stdout.strip(),
    "standard_revalidator_timer":subprocess.run(["systemctl","--user","is-active","c720p-drive-person-revalidate.timer"],
                                                text=True,capture_output=True).stdout.strip(),
    "deletion_enabled":False
},indent=2))
