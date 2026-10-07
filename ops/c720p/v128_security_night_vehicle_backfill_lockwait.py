#!/usr/bin/env python3
from pathlib import Path
import datetime,shutil,subprocess

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
BIN=BASE/"bin"
UNIT=HOME/".config/systemd/user"
WRAP=BIN/"c720p-night-vehicle-backfill-v127.py"
DRIVE=BIN/"c720p-drive-person-revalidate-v126.py"
VENV=BASE/"person-detector/venv/bin/python"
SU=UNIT/"c720p-night-vehicle-backfill-v127.service"
TU=UNIT/"c720p-night-vehicle-backfill-v127.timer"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"person-night-vehicle-backfill-v128-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
for p in (WRAP,SU,TU):
    if p.exists():shutil.copy2(p,BACK/(p.name+".before"))

WRAP.write_text(r'''#!/usr/bin/env python3
import json,pathlib,subprocess,time
B=pathlib.Path("/home/jespern/c720p-home-hub")
IDX=B/"state/drive-security-archive.json"
MODEL="hybrid-mobilenetssd+yolov5n-night-vehicle-cpusafe-v126"
DRIVE=B/"bin/c720p-drive-person-revalidate-v126.py"
PY=B/"person-detector/venv/bin/python"
VISION="/run/user/1000/c720p-vision.lock"
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
print("NIGHT_VEHICLE_BACKFILL_V128 remaining="+str(len(risk))+
      (" next_conf="+str(round(risk[0][0],3))+" next_clip="+str(risk[0][2]) if risk else ""),flush=True)
if not risk:raise SystemExit(0)

# Wait briefly for thumbnail/live detector work instead of silently skipping the
# archive correction when the shared vision lock happens to be busy.
cmd=["/usr/bin/flock","-w","180",VISION,str(PY),str(DRIVE)]
t=time.time()
r=subprocess.run(cmd,text=True,capture_output=True,timeout=780)
print("NIGHT_VEHICLE_BACKFILL_V128 rc="+str(r.returncode)+" seconds="+str(round(time.time()-t,1)),flush=True)
if r.stdout:print(r.stdout[-5000:],flush=True)
if r.stderr:print(r.stderr[-2000:],flush=True)
# flock timeout is a harmless deferred attempt; the 30-minute timer retries.
raise SystemExit(0 if r.returncode in (0,1) else r.returncode)
''')
WRAP.chmod(0o755)

SU.write_text(f"""[Unit]
Description=C720P nighttime car/truck false-person backlog accelerator V128
After=network-online.target c720p-drive-security-archive.service

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 {WRAP}
Nice=19
IOSchedulingClass=idle
CPUWeight=10
IOWeight=10
TimeoutStartSec=14min
""")

subprocess.run(["python3","-m","py_compile",str(WRAP)],check=True,timeout=20)
subprocess.run(["systemctl","--user","daemon-reload"],check=True,timeout=20)
subprocess.run(["systemctl","--user","enable","--now",TU.name],check=True,timeout=30)
subprocess.run(["systemctl","--user","start","--no-block",SU.name],check=True,timeout=20)

print("V128_BACKFILL=OK")
print("backup="+str(BACK))
print("timer="+subprocess.run(["systemctl","--user","is-active",TU.name],text=True,capture_output=True).stdout.strip())
print("service="+subprocess.run(["systemctl","--user","is-active",SU.name],text=True,capture_output=True).stdout.strip())
