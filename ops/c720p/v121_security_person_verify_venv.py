#!/usr/bin/env python3
from pathlib import Path
import datetime,json,os,shutil,subprocess,time

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
BIN=BASE/"bin"
DET=BIN/"c720p-person-highlight-detect.py"
CLEAN=BIN/"c720p-person-no-person-clean.py"
IDX=BASE/"state/person-detection-index.json"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"person-detector-v121-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
for p in (DET,CLEAN,IDX):
    if p.exists():shutil.copy2(p,BACK/(p.name+".before"))

py=str(BASE/"person-detector/venv/bin/python")
for p in (DET,CLEAN):
    r=subprocess.run([py,"-m","py_compile",str(p)],text=True,capture_output=True)
    if r.returncode:raise SystemExit("COMPILE_FAILED "+p.name+":"+r.stderr[-1400:])

before=json.loads(IDX.read_text());before_count=len(before.get("items",{}))
if before_count<3000:raise SystemExit("INDEX_TOO_SMALL:"+str(before_count))

# Run the classifier regression inside the same OpenCV virtualenv as production.
test=Path("/tmp/c720p-v121-guard-test.py")
test.write_text("""import importlib.util
P='/home/jespern/c720p-home-hub/bin/c720p-person-highlight-detect.py'
spec=importlib.util.spec_from_file_location('det',P);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def p(conf=.58,vehicle=.92,conflict=True,dominant=True,x=.42):
 return {'conf':conf,'box':(x,.35,x+.12,.78),'source':'global','vehicle_conf':vehicle,
 'vehicle_iou':.20 if conflict else 0.0,'vehicle_near':conflict,'vehicle_conflict':conflict,'vehicle_dominant':dominant}
night=[[p(x=.40)],[p(x=.42)],[p(x=.44)],[],[],[],[],[],[],[]]
clean=[[p(vehicle=0,conflict=False,dominant=False,x=.40)],[p(vehicle=0,conflict=False,dominant=False,x=.42)],[p(vehicle=0,conflict=False,dominant=False,x=.44)],[],[],[],[],[],[],[]]
vr=m.classify(night,[20]*10,10);cr=m.classify(clean,[20]*10,10)
print(vr[0],vr[4],cr[0],cr[4])
if vr[0]=='confirmed_person' or vr[4]!='night-vehicle-dominant-person-rejected':raise SystemExit(21)
if cr[0]!='confirmed_person':raise SystemExit(22)
""")
r=subprocess.run([py,str(test)],text=True,capture_output=True,timeout=30)
if r.returncode:raise SystemExit("GUARD_LOGIC_TEST_FAILED:"+r.stdout[-1200:]+r.stderr[-1200:])
guard_test=r.stdout.strip()

# Validate one real local clip with the installed detector. Limit to one to stay
# responsive on the 1.4GHz Celeron while still exercising the complete DNN path.
env=os.environ.copy();env["C720P_DETECT_MAX_PER_RUN"]="1"
start=time.time()
r=subprocess.run([py,str(DET)],env=env,text=True,capture_output=True,timeout=150)
elapsed=time.time()-start
if r.returncode:raise SystemExit("REAL_DETECT_FAILED:"+r.stderr[-1800:]+r.stdout[-1800:])

after=json.loads(IDX.read_text());items=after.get("items",{})
if len(items)<before_count-5:raise SystemExit("INDEX_SHRANK:"+str(before_count)+"->"+str(len(items)))
v119=[v for v in items.values() if str(v.get("model") or "").endswith("-v119")]
if not v119:raise SystemExit("NO_V119_RESULT_CREATED")

subprocess.run(["systemctl","--user","daemon-reload"],check=True,timeout=20)
for timer in ("c720p-person-highlight-detect.timer","c720p-person-no-person-clean.timer"):
    subprocess.run(["systemctl","--user","enable","--now",timer],check=False,timeout=30)

recent=sorted(v119,key=lambda x:str(x.get("analyzed_at") or ""),reverse=True)[:4]
print(json.dumps({
 "ok":True,
 "version":"v121",
 "detector_model":after.get("model"),
 "index_items_before":before_count,
 "index_items_after":len(items),
 "v119_rows":len(v119),
 "guard_logic_test":guard_test,
 "real_clip_test_seconds":round(elapsed,1),
 "highlight_timer":subprocess.run(["systemctl","--user","is-active","c720p-person-highlight-detect.timer"],text=True,capture_output=True).stdout.strip(),
 "clean_timer":subprocess.run(["systemctl","--user","is-active","c720p-person-no-person-clean.timer"],text=True,capture_output=True).stdout.strip(),
 "sample":[{"clip_no":x.get("clip_no"),"timestamp":x.get("timestamp"),"status":x.get("person_status"),
            "reason":x.get("person_status_reason"),"person":x.get("person_confidence"),
            "vehicle":x.get("car_confidence"),"tracks":x.get("person_tracks")} for x in recent],
 "backup":str(BACK)
},indent=2))
