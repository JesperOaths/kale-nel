#!/usr/bin/env python3
from pathlib import Path
import datetime,json,os,shutil,subprocess,time

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
BIN=BASE/"bin"
DET=BIN/"c720p-person-highlight-detect.py"
IDX=BASE/"state/person-detection-index.json"
TIMER="c720p-person-highlight-detect.timer"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"person-detector-v122-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
for p in (DET,IDX):
    if p.exists():shutil.copy2(p,BACK/(p.name+".before"))

subprocess.run(["systemctl","--user","stop",TIMER],check=False,timeout=20)
s=DET.read_text()
s=s.replace("adaptive-small-person-night-vehicle-guard-locksafe-v119",
            "adaptive-small-person-night-vehicle-scene-guard-v122")
s=s.replace("DETECT_V119","DETECT_V122")

old="people,veh=infer(net,frame,'global')\n        vc=max(vc,veh)"
new="people,veh=infer(net,frame,'global')\n        for _p in people:_p['scene_vehicle_conf']=float(veh or 0)\n        vc=max(vc,veh)"
if old not in s:raise SystemExit("GLOBAL_VEHICLE_CONTEXT_ANCHOR_NOT_FOUND")
s=s.replace(old,new,1)

old="ds,v=infer(net,crop,'tile',spec);people.extend(ds);vc=max(vc,v)"
new="ds,v=infer(net,crop,'tile',spec)\n                for _p in ds:_p['scene_vehicle_conf']=max(float(veh or 0),float(v or 0))\n                people.extend(ds);vc=max(vc,v)"
if old not in s:raise SystemExit("TILE_VEHICLE_CONTEXT_ANCHOR_NOT_FOUND")
s=s.replace(old,new,1)

old="'vehicle_peak':0.0,'person_vehicle_margin':-1.0}"
new="'vehicle_peak':0.0,'scene_vehicle_peak':0.0,'person_vehicle_margin':-1.0}"
if old not in s:raise SystemExit("TRACK_INIT_ANCHOR_NOT_FOUND")
s=s.replace(old,new,1)

old="best['vehicle_peak']=max(best['vehicle_peak'],vconf)"
new="best['vehicle_peak']=max(best['vehicle_peak'],vconf)\n            best['scene_vehicle_peak']=max(best['scene_vehicle_peak'],float(d.get('scene_vehicle_conf') or 0))"
if old not in s:raise SystemExit("TRACK_VEHICLE_PEAK_ANCHOR_NOT_FOUND")
s=s.replace(old,new,1)

old="'vehicle_peak':round(tr['vehicle_peak'],4),\n                          'person_vehicle_margin'"
new="'vehicle_peak':round(tr['vehicle_peak'],4),'scene_vehicle_peak':round(tr['scene_vehicle_peak'],4),\n                          'person_vehicle_margin'"
if old not in s:raise SystemExit("SUMMARY_VEHICLE_ANCHOR_NOT_FOUND")
s=s.replace(old,new,1)

old="'vehicle_peak':0,'person_vehicle_margin':-1}"
new="'vehicle_peak':0,'scene_vehicle_peak':0,'person_vehicle_margin':-1}"
if old not in s:raise SystemExit("BEST_DEFAULT_ANCHOR_NOT_FOUND")
s=s.replace(old,new,1)

old="""    if used<10:
        status='unknown';reason='insufficient-samples'
    elif vehicle_dominated:
        status='uncertain';reason='night-vehicle-dominant-person-rejected'
    elif best.get('vehicle_clean_strong',0)>=2 and night_clip:"""
new="""    scene_vehicle_weak=(night_clip and best.get('scene_vehicle_peak',0)>=.75
                        and best.get('effective_peak',0)<.40 and best.get('likely',0)==0
                        and best.get('frames',0)<=2 and best.get('tile_hits',0)==0)
    if used<10:
        status='unknown';reason='insufficient-samples'
    elif vehicle_dominated:
        status='uncertain';reason='night-vehicle-dominant-person-rejected'
    elif scene_vehicle_weak:
        status='uncertain';reason='night-strong-vehicle-weak-person-rejected'
    elif best.get('vehicle_clean_strong',0)>=2 and night_clip:"""
if old not in s:raise SystemExit("CLASSIFY_GUARD_ANCHOR_NOT_FOUND")
s=s.replace(old,new,1)

s=s.replace("'night_vehicle_guard_version':'v118'","'night_vehicle_guard_version':'v122'")
DET.write_text(s)

py=str(BASE/"person-detector/venv/bin/python")
r=subprocess.run([py,"-m","py_compile",str(DET)],text=True,capture_output=True)
if r.returncode:raise SystemExit("DETECT_COMPILE_FAILED:"+r.stderr[-1500:])

# Regression tests inside production venv: (1) overlap/dominance guard,
# (2) strong-vehicle scene with only weak person artifacts, (3) real clean person.
test=Path("/tmp/c720p-v122-guard-test.py")
test.write_text("""import importlib.util
P='/home/jespern/c720p-home-hub/bin/c720p-person-highlight-detect.py'
sp=importlib.util.spec_from_file_location('d',P);m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def x(conf=.58,v=.92,conflict=True,dominant=True,scene=.92,pos=.40,source='global'):
 return {'conf':conf,'box':(pos,.35,pos+.12,.78),'source':source,'vehicle_conf':v,
 'scene_vehicle_conf':scene,'vehicle_iou':.2 if conflict else 0,'vehicle_near':conflict,
 'vehicle_conflict':conflict,'vehicle_dominant':dominant}
overlap=[[x(pos=.40)],[x(pos=.42)],[x(pos=.44)],[],[],[],[],[],[],[]]
scene=[[x(conf=.25,v=0,conflict=False,dominant=False,scene=.88,pos=.40)],
       [x(conf=.26,v=0,conflict=False,dominant=False,scene=.88,pos=.42)],[],[],[],[],[],[],[],[]]
clean=[[x(v=0,conflict=False,dominant=False,scene=0,pos=.40)],
       [x(v=0,conflict=False,dominant=False,scene=0,pos=.42)],
       [x(v=0,conflict=False,dominant=False,scene=0,pos=.44)],[],[],[],[],[],[],[]]
a=m.classify(overlap,[20]*10,10);b=m.classify(scene,[20]*10,10);c=m.classify(clean,[20]*10,10)
print(a[0],a[4],'|',b[0],b[4],'|',c[0],c[4])
if a[4]!='night-vehicle-dominant-person-rejected':raise SystemExit(31)
if b[4]!='night-strong-vehicle-weak-person-rejected':raise SystemExit(32)
if c[0]!='confirmed_person':raise SystemExit(33)
""")
r=subprocess.run([py,str(test)],text=True,capture_output=True,timeout=30)
if r.returncode:raise SystemExit("GUARD_TEST_FAILED:"+r.stdout+r.stderr)
logic=r.stdout.strip()

before=json.loads(IDX.read_text());n0=len(before.get("items",{}))
env=os.environ.copy();env["C720P_DETECT_MAX_PER_RUN"]="1"
start=time.time()
r=subprocess.run([py,str(DET)],env=env,text=True,capture_output=True,timeout=150)
elapsed=time.time()-start
if r.returncode:raise SystemExit("REAL_CLIP_FAILED:"+r.stderr[-1800:]+r.stdout[-1800:])
after=json.loads(IDX.read_text());items=after.get("items",{})
if len(items)<n0-5:raise SystemExit("INDEX_SHRANK")
v122=[v for v in items.values() if str(v.get("model") or "").endswith("-v122")]
if not v122:raise SystemExit("NO_V122_RESULT")

subprocess.run(["systemctl","--user","enable","--now",TIMER],check=True,timeout=30)
recent=sorted(v122,key=lambda x:str(x.get("analyzed_at") or ""),reverse=True)[:3]
print(json.dumps({
 "ok":True,"version":"v122","logic_test":logic,"index_items":len(items),
 "v122_rows":len(v122),"real_clip_test_seconds":round(elapsed,1),
 "timer":subprocess.run(["systemctl","--user","is-active",TIMER],text=True,capture_output=True).stdout.strip(),
 "sample":[{"clip_no":x.get("clip_no"),"timestamp":x.get("timestamp"),"status":x.get("person_status"),
            "reason":x.get("person_status_reason"),"person":x.get("person_confidence"),
            "vehicle":x.get("car_confidence"),"tracks":x.get("person_tracks")} for x in recent],
 "backup":str(BACK)
},indent=2))
