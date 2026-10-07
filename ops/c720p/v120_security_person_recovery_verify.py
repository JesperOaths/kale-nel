#!/usr/bin/env python3
from pathlib import Path
import datetime,importlib.util,json,os,re,shutil,subprocess,time

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
BIN=BASE/"bin"
DET=BIN/"c720p-person-highlight-detect.py"
CLEAN=BIN/"c720p-person-no-person-clean.py"
IDX=BASE/"state/person-detection-index.json"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"person-detector-v120-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
for p in (DET,CLEAN,IDX):
    if p.exists():shutil.copy2(p,BACK/(p.name+".before"))

# Repair the cleaner indentation introduced while adding the shared person-index lock.
c=CLEAN.read_text()
pat=re.compile(
    r"    # PERSON_INDEX_LOCK_V119\n"
    r"    _person_lock=open\(BASE/'state/person-detection-index\.lock','a\+'\)\n"
    r"    try:\n"
    r"        fcntl\.flock\(_person_lock,fcntl\.LOCK_EX\|fcntl\.LOCK_NB\)\n"
    r"    except BlockingIOError:\n"
    r"        print\('PERSON_FULLSCAN=SKIP person-index-lock-busy'\);return 0\n"
)
replacement=(
    " # PERSON_INDEX_LOCK_V119\n"
    " _person_lock=open(BASE/'state/person-detection-index.lock','a+')\n"
    " try:\n"
    "  fcntl.flock(_person_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)\n"
    " except BlockingIOError:\n"
    "  print('PERSON_FULLSCAN=SKIP person-index-lock-busy');return 0\n"
)
c,n=pat.subn(replacement,c,count=1)
if n!=1 and " # PERSON_INDEX_LOCK_V119" not in c:
    raise SystemExit("CLEANER_LOCK_BLOCK_NOT_FOUND")
CLEAN.write_text(c)

py=str(BASE/"person-detector/venv/bin/python")
for p in (DET,CLEAN):
    r=subprocess.run([py,"-m","py_compile",str(p)],text=True,capture_output=True)
    if r.returncode:raise SystemExit("COMPILE_FAILED "+p.name+":"+r.stderr[-1400:])

# The repaired index from V119 must be valid before any timer is restarted.
before=json.loads(IDX.read_text())
before_count=len(before.get("items",{}))
if before_count<3000:raise SystemExit("INDEX_TOO_SMALL_BEFORE_TEST:"+str(before_count))

# Logic-only guard regression: repeated nighttime person-like boxes dominated by
# a stronger overlapping vehicle must not become confirmed_person, while the same
# clean temporal person track still must.
spec=importlib.util.spec_from_file_location("c720p_det_v119",DET)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
def p(conf=.58,vehicle=.92,conflict=True,dominant=True,x=.42):
    return {'conf':conf,'box':(x,.35,x+.12,.78),'source':'global',
            'vehicle_conf':vehicle,'vehicle_iou':.20 if conflict else 0.0,
            'vehicle_near':conflict,'vehicle_conflict':conflict,
            'vehicle_dominant':dominant}
night_frames=[[p(x=.40)],[p(x=.42)],[p(x=.44)],[],[],[],[],[],[],[]]
clean_frames=[[p(vehicle=0,conflict=False,dominant=False,x=.40)],
              [p(vehicle=0,conflict=False,dominant=False,x=.42)],
              [p(vehicle=0,conflict=False,dominant=False,x=.44)],[],[],[],[],[],[],[]]
vr=mod.classify(night_frames,[20]*10,10)
cr=mod.classify(clean_frames,[20]*10,10)
if vr[0]=="confirmed_person" or vr[4]!="night-vehicle-dominant-person-rejected":
    raise SystemExit("VEHICLE_GUARD_REGRESSION:"+repr(vr[:5]))
if cr[0]!="confirmed_person":
    raise SystemExit("CLEAN_PERSON_REGRESSION:"+repr(cr[:5]))

# One bounded real-video run validates inference, lock serialization and atomic JSON.
env=os.environ.copy();env["C720P_DETECT_MAX_PER_RUN"]="1"
start=time.time()
r=subprocess.run([py,str(DET)],env=env,text=True,capture_output=True,timeout=150)
elapsed=time.time()-start
if r.returncode:raise SystemExit("REAL_DETECT_FAILED:"+r.stderr[-1800:]+r.stdout[-1800:])

after=json.loads(IDX.read_text())
items=after.get("items",{})
if len(items)<before_count-5:
    raise SystemExit("INDEX_SHRANK:"+str(before_count)+"->"+str(len(items)))
v119=[v for v in items.values() if str(v.get("model") or "").endswith("-v119")]
if not v119:raise SystemExit("NO_V119_CLASSIFICATION_CREATED")

subprocess.run(["systemctl","--user","daemon-reload"],check=True,timeout=20)
for timer in ("c720p-person-highlight-detect.timer","c720p-person-no-person-clean.timer"):
    subprocess.run(["systemctl","--user","enable","--now",timer],check=False,timeout=30)

recent=sorted(v119,key=lambda x:str(x.get("analyzed_at") or ""),reverse=True)[:3]
print(json.dumps({
 "ok":True,
 "version":"v120-recovery",
 "detector_model":after.get("model"),
 "index_items_before":before_count,
 "index_items_after":len(items),
 "v119_rows":len(v119),
 "real_clip_test_seconds":round(elapsed,1),
 "vehicle_guard_synthetic":{"status":vr[0],"reason":vr[4]},
 "clean_person_synthetic":{"status":cr[0],"reason":cr[4]},
 "highlight_timer":subprocess.run(["systemctl","--user","is-active","c720p-person-highlight-detect.timer"],text=True,capture_output=True).stdout.strip(),
 "clean_timer":subprocess.run(["systemctl","--user","is-active","c720p-person-no-person-clean.timer"],text=True,capture_output=True).stdout.strip(),
 "sample":[{"clip_no":x.get("clip_no"),"timestamp":x.get("timestamp"),"status":x.get("person_status"),
            "reason":x.get("person_status_reason"),"person":x.get("person_confidence"),
            "vehicle":x.get("car_confidence"),"tracks":x.get("person_tracks")} for x in recent],
 "backup":str(BACK)
},indent=2))
