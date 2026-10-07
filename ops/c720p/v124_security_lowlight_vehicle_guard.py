#!/usr/bin/env python3
from pathlib import Path
import datetime,importlib.util,json,os,shutil,subprocess,time

HOME=Path("/home/jespern");BASE=HOME/"c720p-home-hub";BIN=BASE/"bin"
DET=BIN/"c720p-person-highlight-detect.py";IDX=BASE/"state/person-detection-index.json"
ROOT=Path("/opt/homeassistant/config/www/frontyard-security-new")
TIMER="c720p-person-highlight-detect.timer"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"person-detector-v124-{STAMP}";BACK.mkdir(parents=True,exist_ok=True)
for p in (DET,IDX):
    if p.exists():shutil.copy2(p,BACK/(p.name+".before"))

subprocess.run(["systemctl","--user","stop",TIMER],check=False,timeout=20)
s=DET.read_text()
s=s.replace("adaptive-small-person-night-vehicle-clip-guard-v123",
            "adaptive-small-person-night-lowlight-vehicle-guard-v124")
s=s.replace("DETECT_V123","DETECT_V124")
old="""    scene_vehicle_weak=(night_clip and max(best.get('scene_vehicle_peak',0),float(clip_vehicle_peak or 0))>=.75
                        and best.get('effective_peak',0)<.40 and best.get('likely',0)==0
                        and best.get('frames',0)<=2 and best.get('tile_hits',0)==0)
    if used<10:"""
new="""    scene_vehicle_weak=(night_clip and max(best.get('scene_vehicle_peak',0),float(clip_vehicle_peak or 0))>=.75
                        and best.get('effective_peak',0)<.40 and best.get('likely',0)==0
                        and best.get('frames',0)<=2 and best.get('tile_hits',0)==0)
    low_light_clip=bool(brightnesses and (sum(brightnesses)/len(brightnesses))<70.0)
    clip_vehicle_relative=(low_light_clip and float(clip_vehicle_peak or 0)>=.45
                           and float(clip_vehicle_peak or 0)>=best.get('effective_peak',0)+.18
                           and best.get('effective_peak',0)<.45 and best.get('strong',0)==0
                           and best.get('tile_hits',0)==0)
    if used<10:"""
if old not in s:raise SystemExit("LOWLIGHT_INSERT_ANCHOR_NOT_FOUND")
s=s.replace(old,new,1)
old="""    elif scene_vehicle_weak:
        status='uncertain';reason='night-strong-vehicle-weak-person-rejected'
    elif best.get('vehicle_clean_strong',0)>=2 and night_clip:"""
new="""    elif scene_vehicle_weak:
        status='uncertain';reason='night-strong-vehicle-weak-person-rejected'
    elif clip_vehicle_relative:
        status='uncertain';reason='lowlight-vehicle-dominant-weak-person-rejected'
    elif best.get('vehicle_clean_strong',0)>=2 and night_clip:"""
if old not in s:raise SystemExit("LOWLIGHT_CLASSIFY_ANCHOR_NOT_FOUND")
s=s.replace(old,new,1)
s=s.replace("'night_vehicle_guard_version':'v123'","'night_vehicle_guard_version':'v124'")
DET.write_text(s)

py=str(BASE/"person-detector/venv/bin/python")
r=subprocess.run([py,"-m","py_compile",str(DET)],text=True,capture_output=True)
if r.returncode:raise SystemExit("COMPILE_FAILED:"+r.stderr[-1400:])

# Logic regression for the observed dawn/low-light pattern: weak person-like
# evidence, no crop confirmation, and a substantially stronger vehicle signal.
test=Path("/tmp/c720p-v124-guard-test.py")
test.write_text("""import importlib.util
P='/home/jespern/c720p-home-hub/bin/c720p-person-highlight-detect.py'
sp=importlib.util.spec_from_file_location('d',P);m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def x(c=.296,p=.40):
 return {'conf':c,'box':(p,.35,p+.12,.78),'source':'global','vehicle_conf':0,'scene_vehicle_conf':0,
 'vehicle_iou':0,'vehicle_near':False,'vehicle_conflict':False,'vehicle_dominant':False}
f=[[x(.296,.40)],[x(.29,.42)],[x(.28,.44)],[x(.27,.46)],[],[],[],[],[],[]]
car=m.classify(f,[58.1]*10,10,.543);clean=m.classify(f,[58.1]*10,10,0)
print(car[0],car[4],'|',clean[0],clean[4])
if car[4]!='lowlight-vehicle-dominant-weak-person-rejected':raise SystemExit(51)
if clean[4]=='lowlight-vehicle-dominant-weak-person-rejected':raise SystemExit(52)
""")
r=subprocess.run([py,str(test)],text=True,capture_output=True,timeout=30)
if r.returncode:raise SystemExit("LOGIC_TEST_FAILED:"+r.stdout+r.stderr)
logic=r.stdout.strip()

# Re-run the actual clip #958 that exposed the dawn boundary. This is a read-only
# classification test; the normal timer will progressively write V124 results.
events=json.load(open(ROOT/"events.json"))
target=next((e for e in events if int(e.get("clip_no") or -1)==958 and (ROOT/"clips"/str(e.get("clip") or "")).is_file()),None)
actual=None
if target:
    probe=Path("/tmp/c720p-v124-real-probe.py")
    probe.write_text("""import importlib.util,json,pathlib,cv2
B=pathlib.Path('/home/jespern/c720p-home-hub');R=pathlib.Path('/opt/homeassistant/config/www/frontyard-security-new')
sp=importlib.util.spec_from_file_location('d',B/'bin/c720p-person-highlight-detect.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
ev=json.load(open(R/'events.json'));e=next(x for x in ev if int(x.get('clip_no') or -1)==958);p=R/'clips'/str(e.get('clip'))
net=cv2.dnn.readNetFromCaffe(str(m.PROTO),str(m.MODEL));d=m.detect_clip(net,p);z=m.classify(d['per_frame'],d['brightness'],d['used'],d['car_confidence'])
print(json.dumps({'clip_no':958,'timestamp':e.get('timestamp'),'brightness':round(sum(d['brightness'])/len(d['brightness']),1),
'person':round(d['person_confidence'],4),'vehicle':round(d['car_confidence'],4),'status':z[0],'reason':z[4]}))
""")
    rr=subprocess.run([py,str(probe)],text=True,capture_output=True,timeout=150)
    if rr.returncode:raise SystemExit("REAL_958_TEST_FAILED:"+rr.stderr[-1600:])
    actual=json.loads(rr.stdout)

subprocess.run(["systemctl","--user","enable","--now",TIMER],check=True,timeout=30)
print(json.dumps({
 "ok":True,"version":"v124","logic_test":logic,"actual_clip_958":actual,
 "timer":subprocess.run(["systemctl","--user","is-active",TIMER],text=True,capture_output=True).stdout.strip(),
 "index_items":len(json.load(open(IDX)).get("items",{})),"backup":str(BACK)
},indent=2))
