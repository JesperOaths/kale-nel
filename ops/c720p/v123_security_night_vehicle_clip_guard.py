#!/usr/bin/env python3
from pathlib import Path
import datetime,json,os,shutil,subprocess,time

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"; BIN=BASE/"bin"
DET=BIN/"c720p-person-highlight-detect.py"; IDX=BASE/"state/person-detection-index.json"
TIMER="c720p-person-highlight-detect.timer"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"person-detector-v123-{STAMP}";BACK.mkdir(parents=True,exist_ok=True)
for p in (DET,IDX):
    if p.exists():shutil.copy2(p,BACK/(p.name+".before"))

subprocess.run(["systemctl","--user","stop",TIMER],check=False,timeout=20)
s=DET.read_text()
s=s.replace("adaptive-small-person-night-vehicle-scene-guard-v122",
            "adaptive-small-person-night-vehicle-clip-guard-v123")
s=s.replace("DETECT_V122","DETECT_V123")
s=s.replace("def classify(per_frame,brightnesses,used):",
            "def classify(per_frame,brightnesses,used,clip_vehicle_peak=0.0):",1)
s=s.replace(
    "scene_vehicle_weak=(night_clip and best.get('scene_vehicle_peak',0)>=.75",
    "scene_vehicle_weak=(night_clip and max(best.get('scene_vehicle_peak',0),float(clip_vehicle_peak or 0))>=.75",1
)
old="status,weak,likely,strong,reason,tracks=classify(d['per_frame'],d['brightness'],d['used'])"
new="status,weak,likely,strong,reason,tracks=classify(d['per_frame'],d['brightness'],d['used'],d['car_confidence'])"
if old not in s:raise SystemExit("CLASSIFY_CALL_ANCHOR_NOT_FOUND")
s=s.replace(old,new,1)
s=s.replace("'night_vehicle_guard_version':'v122'","'night_vehicle_guard_version':'v123'")
DET.write_text(s)

py=str(BASE/"person-detector/venv/bin/python")
r=subprocess.run([py,"-m","py_compile",str(DET)],text=True,capture_output=True)
if r.returncode:raise SystemExit("COMPILE_FAILED:"+r.stderr[-1600:])

# Regression specifically covers a vehicle detected in different sampled frames
# from the weak person-like artifact (the exact pattern seen in clip #965).
test=Path("/tmp/c720p-v123-guard-test.py")
test.write_text("""import importlib.util
P='/home/jespern/c720p-home-hub/bin/c720p-person-highlight-detect.py'
sp=importlib.util.spec_from_file_location('d',P);m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def x(conf=.25,pos=.40):
 return {'conf':conf,'box':(pos,.35,pos+.12,.78),'source':'global','vehicle_conf':0,
 'scene_vehicle_conf':0,'vehicle_iou':0,'vehicle_near':False,'vehicle_conflict':False,'vehicle_dominant':False}
weak=[[x(.25,.40)],[x(.26,.42)],[],[],[],[],[],[],[],[]]
car=m.classify(weak,[20]*10,10,.88);clean=m.classify(weak,[20]*10,10,0)
print(car[0],car[4],'|',clean[0],clean[4])
if car[4]!='night-strong-vehicle-weak-person-rejected':raise SystemExit(41)
if clean[4]=='night-strong-vehicle-weak-person-rejected':raise SystemExit(42)
""")
r=subprocess.run([py,str(test)],text=True,capture_output=True,timeout=30)
if r.returncode:raise SystemExit("GUARD_TEST_FAILED:"+r.stdout+r.stderr)
logic=r.stdout.strip()

before=json.loads(IDX.read_text());n0=len(before.get("items",{}))
env=os.environ.copy();env["C720P_DETECT_MAX_PER_RUN"]="1"
start=time.time();r=subprocess.run([py,str(DET)],env=env,text=True,capture_output=True,timeout=150);elapsed=time.time()-start
if r.returncode:raise SystemExit("REAL_CLIP_FAILED:"+r.stderr[-1800:]+r.stdout[-1800:])
after=json.loads(IDX.read_text());items=after.get("items",{})
if len(items)<n0-5:raise SystemExit("INDEX_SHRANK")
v123=[v for v in items.values() if str(v.get("model") or "").endswith("-v123")]
if not v123:raise SystemExit("NO_V123_RESULT")
subprocess.run(["systemctl","--user","enable","--now",TIMER],check=True,timeout=30)
recent=sorted(v123,key=lambda x:str(x.get("analyzed_at") or ""),reverse=True)[:4]
print(json.dumps({
 "ok":True,"version":"v123","logic_test":logic,"index_items":len(items),"v123_rows":len(v123),
 "real_clip_test_seconds":round(elapsed,1),
 "timer":subprocess.run(["systemctl","--user","is-active",TIMER],text=True,capture_output=True).stdout.strip(),
 "sample":[{"clip_no":x.get("clip_no"),"timestamp":x.get("timestamp"),"status":x.get("person_status"),
            "reason":x.get("person_status_reason"),"person":x.get("person_confidence"),
            "vehicle":x.get("car_confidence"),"tracks":x.get("person_tracks")} for x in recent],
 "backup":str(BACK)
},indent=2))
