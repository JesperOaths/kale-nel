#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import datetime,json,os,re,shutil,subprocess,time

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
BIN=BASE/"bin"
UNIT=HOME/".config/systemd/user"
DET=BIN/"c720p-person-highlight-detect.py"
CLEAN=BIN/"c720p-person-no-person-clean.py"
IDX=BASE/"state/person-detection-index.json"
LOCK=BASE/"state/person-detection-index.lock"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"person-detector-v119-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)

for p in (DET,CLEAN,IDX):
    if p.exists():shutil.copy2(p,BACK/(p.name+".before"))

# Stop every user service that directly invokes the person detector while repairing
# the shared index. Corresponding timers are stopped and restored afterwards.
services=[];timers=[]
for p in UNIT.glob("*.service"):
    try:
        t=p.read_text()
    except Exception:
        continue
    if "c720p-person-highlight-detect.py" in t or "c720p-person-no-person-clean.py" in t:
        services.append(p.name)
        tp=UNIT/(p.stem+".timer")
        if tp.exists():timers.append(tp.name)
for t in timers:subprocess.run(["systemctl","--user","stop",t],check=False,timeout=20)
for s in services:subprocess.run(["systemctl","--user","stop",s],check=False,timeout=30)

# V118 exposed an old generated-source bug: the atomic writer appended a literal
# backslash+n after otherwise valid JSON. Recover the complete first JSON document
# instead of throwing away the 3k+ historical classifications.
raw=IDX.read_text(errors="replace") if IDX.exists() else ""
decoder=json.JSONDecoder()
obj=None;end=0
try:
    obj,end=decoder.raw_decode(raw.lstrip())
except Exception:
    obj=None
if not isinstance(obj,dict):
    raise SystemExit("INDEX_RECOVERY_FAILED_NO_VALID_DOCUMENT")
rest=raw.lstrip()[end:].strip()
if rest not in ("",r"\n",r"\r\n"):
    # Preserve evidence and fail closed if this is more than the known delimiter bug.
    raise SystemExit("INDEX_RECOVERY_REFUSED_UNEXPECTED_TRAILING_DATA:"+repr(rest[:120]))
tmp=IDX.with_suffix(".json.repair-v119")
tmp.write_text(json.dumps(obj,indent=2)+chr(10))
os.replace(tmp,IDX)

# Patch the installed V118 detector rather than replacing its tested vehicle guard.
s=DET.read_text()
s=s.replace("adaptive-small-person-night-vehicle-guard-cpusafe-v118",
            "adaptive-small-person-night-vehicle-guard-locksafe-v119")
s=s.replace("DETECT_V118","DETECT_V119")
s=s.replace("tmp-v118","tmp-v119")
lines=s.splitlines()
fixed=[]
atomic_fixed=False
for line in lines:
    if "q.write_text(json.dumps(o,indent=2)" in line:
        indent=line[:len(line)-len(line.lstrip())]
        line=indent+"q.write_text(json.dumps(o,indent=2)+chr(10))"
        atomic_fixed=True
    fixed.append(line)
s=chr(10).join(fixed)+chr(10)
if not atomic_fixed:raise SystemExit("DETECT_ATOMIC_WRITER_NOT_FOUND")
if "import cv2,json,os,pathlib,subprocess,time,datetime,math,fcntl" not in s:
    s=s.replace("import cv2,json,os,pathlib,subprocess,time,datetime,math",
                "import cv2,json,os,pathlib,subprocess,time,datetime,math,fcntl")
main_anchor="def main():\n"
guard="""def main():
    _person_lock=open(BASE/'state/person-detection-index.lock','a+')
    try:
        fcntl.flock(_person_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:
        log('DETECT_V119=SKIP person-index-lock-busy');return 0
"""
if main_anchor not in s:raise SystemExit("DETECT_MAIN_NOT_FOUND")
s=s.replace(main_anchor,guard,1)
DET.write_text(s);DET.chmod(0o755)

# The no-person full scanner writes the same index, so serialize it on the exact same
# lock. It remains classification-only: no classifier-driven deletion is re-enabled.
if CLEAN.exists():
    c=CLEAN.read_text()
    if "PERSON_INDEX_LOCK_V119" not in c:
        if "import cv2,json,os,pathlib,subprocess,hashlib,datetime,time,fcntl" not in c and "import " in c:
            pass
        c=c.replace("def main():",
"""def main():
    # PERSON_INDEX_LOCK_V119
    _person_lock=open(BASE/'state/person-detection-index.lock','a+')
    try:
        fcntl.flock(_person_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:
        print('PERSON_FULLSCAN=SKIP person-index-lock-busy');return 0""",1)
        CLEAN.write_text(c)

# Compile before allowing timers back.
py=str(BASE/"person-detector/venv/bin/python")
for p in (DET,CLEAN):
    if p.exists():
        r=subprocess.run([py,"-m","py_compile",str(p)],text=True,capture_output=True)
        if r.returncode:raise SystemExit("COMPILE_FAILED "+p.name+":"+r.stderr[-1200:])

# Run one real clip through V119. This validates the guard, the CPU-bounded path,
# the lock and the repaired JSON writer without a multi-minute four-clip shadow run.
env=os.environ.copy();env["C720P_DETECT_MAX_PER_RUN"]="1"
start=time.time()
r=subprocess.run([py,str(DET)],env=env,text=True,capture_output=True,timeout=150)
elapsed=time.time()-start
if r.returncode:
    raise SystemExit("V119_REAL_CLIP_TEST_FAILED:"+r.stderr[-1600:]+r.stdout[-1600:])

# The index must still be valid and must not have shrunk unexpectedly.
check=json.loads(IDX.read_text())
items=check.get("items",{})
if len(items)<3000:
    raise SystemExit("INDEX_ITEM_COUNT_SUSPICIOUS:"+str(len(items)))
v119=[v for v in items.values() if str(v.get("model") or "").endswith("-v119")]
if not v119:
    raise SystemExit("NO_V119_RESULT_AFTER_REAL_CLIP_TEST")

subprocess.run(["systemctl","--user","daemon-reload"],check=True,timeout=20)
for t in timers:subprocess.run(["systemctl","--user","enable","--now",t],check=False,timeout=30)

sample=sorted(v119,key=lambda x:str(x.get("analyzed_at") or ""),reverse=True)[:4]
print(json.dumps({
  "ok":True,
  "version":"v119",
  "backup":str(BACK),
  "index_items":len(items),
  "v119_rows":len(v119),
  "real_clip_test_seconds":round(elapsed,1),
  "services_serialized":services,
  "timers_restored":timers,
  "night_vehicle_guard":True,
  "truck_guard":"bus_or_truck + car_or_truck VOC vehicle evidence",
  "classification_only_cleanup":True,
  "sample":[{
      "clip_no":x.get("clip_no"),
      "timestamp":x.get("timestamp"),
      "status":x.get("person_status"),
      "reason":x.get("person_status_reason"),
      "person":x.get("person_confidence"),
      "vehicle":x.get("car_confidence"),
      "tracks":x.get("person_tracks")
  } for x in sample]
},indent=2))
