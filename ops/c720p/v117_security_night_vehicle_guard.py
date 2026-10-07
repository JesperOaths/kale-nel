#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import datetime
import json
import math
import os
import shutil
import subprocess
import time
import urllib.parse
import urllib.request

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
BIN=BASE/"bin"
WWW=Path("/opt/homeassistant/config/www")
DET=BIN/"c720p-person-highlight-detect.py"
UNIT=HOME/".config/systemd/user"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"person-detector-v117-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)

if DET.exists():
    shutil.copy2(DET,BACK/(DET.name+".before"))

detector=r'''#!/home/jespern/c720p-home-hub/person-detector/venv/bin/python
from __future__ import annotations
import cv2,json,os,pathlib,subprocess,time,datetime,math

cv2.setNumThreads(1)
BASE=pathlib.Path('/home/jespern/c720p-home-hub')
ROOTS={'new':pathlib.Path('/opt/homeassistant/config/www/frontyard-security-new'),
       's3':pathlib.Path('/opt/homeassistant/config/www/frontyard-security')}
IDX=BASE/'state/person-detection-index.json'
CANDS=BASE/'state/motion-highlight-candidates.json'
SELECT=BASE/'bin/c720p-motion-highlight-select.py'
MODEL=BASE/'person-detector/model/mobilenet_iter_73000.caffemodel'
PROTO=BASE/'person-detector/model/deploy.prototxt'
LOG=BASE/'logs/person-highlight-detect.log'
MODEL_ID='mobilenet-ssd-voc-73000-adaptive-small-person-night-vehicle-guard-v117'
PERSON=15
VEHICLE={2,6,7,14}
MAX_PER_RUN=4

# More temporal coverage than the previous 12-frame scan, but still small enough
# for the Celeron 2955U. Four anchor frames also receive a magnified 2x2 sweep.
SAMPLE_FRACTIONS=(.03,.10,.17,.24,.31,.38,.45,.52,.59,.66,.73,.80,.87,.94)
TILE_ANCHORS={2,6,10,13}
MIN_RAW_CONF=.13
DAY_LIKELY=.32
DAY_STRONG=.52
NIGHT_LIKELY=.28
NIGHT_STRONG=.46
NIGHT_VEHICLE_CONF=.30
NIGHT_VEHICLE_IOU=.055
NIGHT_VEHICLE_MARGIN=.10

def log(s):
    line=time.strftime('%Y-%m-%d %H:%M:%S')+' '+s
    print(line,flush=True)
    LOG.parent.mkdir(parents=True,exist_ok=True)
    open(LOG,'a').write(line+'\\n')

def load(p,d):
    try:return json.loads(pathlib.Path(p).read_text())
    except:return d

def atomic(p,o):
    p=pathlib.Path(p);p.parent.mkdir(parents=True,exist_ok=True)
    q=p.with_suffix(p.suffix+'.tmp-v117')
    q.write_text(json.dumps(o,indent=2)+'\\n')
    os.replace(q,p)

def clamp(x,a=0.0,b=1.0):return max(a,min(b,float(x)))

def iou(a,b):
    ax1,ay1,ax2,ay2=a; bx1,by1,bx2,by2=b
    x1=max(ax1,bx1);y1=max(ay1,by1);x2=min(ax2,bx2);y2=min(ay2,by2)
    inter=max(0.0,x2-x1)*max(0.0,y2-y1)
    aa=max(0.0,ax2-ax1)*max(0.0,ay2-ay1);bb=max(0.0,bx2-bx1)*max(0.0,by2-by1)
    return inter/max(1e-9,aa+bb-inter)

def center(box):
    x1,y1,x2,y2=box
    return ((x1+x2)/2.0,(y1+y2)/2.0)

def box_ok(box,source):
    x1,y1,x2,y2=box
    w=max(0.0,x2-x1);h=max(0.0,y2-y1);area=w*h
    if w<=0 or h<=0:return False
    aspect=w/h
    # Keep tiny distant people, but reject the most implausible SSD boxes.
    if area<0.00035 or area>0.72:return False
    if aspect<0.08 or aspect>1.65:return False
    return True

def infer(net,frame,source='global',crop_norm=None):
    h,w=frame.shape[:2]
    blob=cv2.dnn.blobFromImage(frame,0.007843,(300,300),127.5,swapRB=False,crop=False)
    net.setInput(blob);d=net.forward()
    def mapped_box(i):
        bx=[clamp(float(d[0,0,i,j])) for j in (3,4,5,6)]
        if crop_norm is None:return tuple(bx)
        cx1,cy1,cx2,cy2=crop_norm;cw=cx2-cx1;ch=cy2-cy1
        return (cx1+bx[0]*cw,cy1+bx[1]*ch,cx1+bx[2]*cw,cy1+bx[3]*ch)
    vehicles=[];vehicle=0.0
    for i in range(d.shape[2]):
        conf=float(d[0,0,i,2]);cls=int(d[0,0,i,1])
        if conf<.10 or cls not in VEHICLE:continue
        box=mapped_box(i);vehicle=max(vehicle,conf)
        vehicles.append({'conf':conf,'box':box,'class_id':cls})
    people=[]
    for i in range(d.shape[2]):
        conf=float(d[0,0,i,2]);cls=int(d[0,0,i,1])
        if conf<.10 or cls!=PERSON:continue
        box=mapped_box(i)
        if not box_ok(box,source):continue
        pcx,pcy=center(box);best_v=0.0;best_iou=0.0;near=False;best_cls=None
        for v in vehicles:
            ov=iou(box,v['box']);vx1,vy1,vx2,vy2=v['box']
            pad=.10
            close=(vx1-pad<=pcx<=vx2+pad and vy1-pad<=pcy<=vy2+pad)
            if ov>best_iou:best_iou=ov
            if (ov>=NIGHT_VEHICLE_IOU or close) and v['conf']>best_v:
                best_v=v['conf'];best_cls=v['class_id'];near=close
        conflict=best_v>=NIGHT_VEHICLE_CONF and (best_iou>=NIGHT_VEHICLE_IOU or near)
        dominant=conflict and best_v>=conf-NIGHT_VEHICLE_MARGIN
        people.append({'conf':conf,'box':box,'source':source,
                       'vehicle_conf':best_v,'vehicle_iou':best_iou,'vehicle_near':near,
                       'vehicle_class_id':best_cls,'vehicle_conflict':conflict,
                       'vehicle_dominant':dominant})
    return people,vehicle

def tile_views(frame):
    h,w=frame.shape[:2]
    # Overlapping 62% x 68% views enlarge distant people in both dimensions.
    specs=((0.00,0.00,.62,.68),(.38,0.00,1.00,.68),
           (0.00,.32,.62,1.00),(.38,.32,1.00,1.00))
    out=[]
    for x1,y1,x2,y2 in specs:
        xa=int(x1*w);xb=max(xa+2,int(x2*w));ya=int(y1*h);yb=max(ya+2,int(y2*h))
        out.append((frame[ya:yb,xa:xb],(x1,y1,x2,y2)))
    return out

def dedupe(ds):
    out=[]
    for d in sorted(ds,key=lambda z:z['conf'],reverse=True):
        if any(iou(d['box'],x['box'])>=.38 for x in out):continue
        out.append(d)
    return out

def threshold_for(brightness):
    return (NIGHT_LIKELY,NIGHT_STRONG) if brightness<58.0 else (DAY_LIKELY,DAY_STRONG)

def build_tracks(per_frame,brightnesses):
    tracks=[]
    for fi,ds in enumerate(per_frame):
        brightness=brightnesses[fi] if fi<len(brightnesses) else 100
        likely,strong=threshold_for(brightness);night=brightness<58.0
        for d in ds:
            raw=float(d['conf']);conflict=bool(night and d.get('vehicle_conflict'))
            dominant=bool(conflict and d.get('vehicle_dominant'))
            effective=raw*(.55 if dominant else .80 if conflict else 1.0)
            d['effective_conf']=effective
            c=center(d['box']);best=None;bestdist=9
            for tr in tracks:
                gap=fi-tr['last_frame']
                if gap<1 or gap>3:continue
                tc=tr['last_center'];dist=math.hypot(c[0]-tc[0],c[1]-tc[1]);ov=iou(d['box'],tr['last_box'])
                score=dist-(.12 if ov>.03 else 0)
                if score<bestdist and (dist<.34 or ov>.03):bestdist=score;best=tr
            if best is None:
                best={'first_frame':fi,'last_frame':fi,'last_center':c,'last_box':d['box'],
                      'frames':set(),'weak':0,'likely':0,'strong':0,'global_hits':0,'tile_hits':0,
                      'peak':0.0,'effective_peak':0.0,'sources':set(),'vehicle_conflict_hits':0,
                      'vehicle_dominant_hits':0,'vehicle_clean_likely':0,'vehicle_clean_strong':0,
                      'vehicle_peak':0.0,'person_vehicle_margin':-1.0}
                tracks.append(best)
            best['last_frame']=fi;best['last_center']=c;best['last_box']=d['box'];best['frames'].add(fi)
            best['peak']=max(best['peak'],raw);best['effective_peak']=max(best['effective_peak'],effective)
            best['sources'].add(d['source'])
            if d['source']=='global':best['global_hits']+=1
            else:best['tile_hits']+=1
            vconf=float(d.get('vehicle_conf') or 0)
            best['vehicle_peak']=max(best['vehicle_peak'],vconf)
            best['person_vehicle_margin']=max(best['person_vehicle_margin'],raw-vconf)
            if conflict:best['vehicle_conflict_hits']+=1
            if dominant:best['vehicle_dominant_hits']+=1
            if effective>=MIN_RAW_CONF:best['weak']+=1
            if effective>=likely:
                best['likely']+=1
                if not conflict:best['vehicle_clean_likely']+=1
            if effective>=strong:
                best['strong']+=1
                if not conflict:best['vehicle_clean_strong']+=1
    return tracks

def classify(per_frame,brightnesses,used):
    tracks=build_tracks(per_frame,brightnesses);summaries=[]
    for tr in tracks:
        frames=len(tr['frames'])
        summaries.append({'frames':frames,'weak':tr['weak'],'likely':tr['likely'],'strong':tr['strong'],
                          'global_hits':tr['global_hits'],'tile_hits':tr['tile_hits'],
                          'peak':round(tr['peak'],4),'effective_peak':round(tr['effective_peak'],4),
                          'sources':sorted(tr['sources']),'vehicle_conflict_hits':tr['vehicle_conflict_hits'],
                          'vehicle_dominant_hits':tr['vehicle_dominant_hits'],
                          'vehicle_clean_likely':tr['vehicle_clean_likely'],
                          'vehicle_clean_strong':tr['vehicle_clean_strong'],
                          'vehicle_peak':round(tr['vehicle_peak'],4),
                          'person_vehicle_margin':round(tr['person_vehicle_margin'],4)})
    summaries.sort(key=lambda x:(x['frames'],x['strong'],x['likely'],x['effective_peak']),reverse=True)
    best=summaries[0] if summaries else {'frames':0,'weak':0,'likely':0,'strong':0,'peak':0,
                                         'vehicle_conflict_hits':0,'vehicle_dominant_hits':0,
                                         'vehicle_clean_likely':0,'vehicle_clean_strong':0,
                                         'vehicle_peak':0,'person_vehicle_margin':-1}
    weak_frames=likely_frames=strong_frames=0
    for i,ds in enumerate(per_frame):
        brightness=brightnesses[i] if i<len(brightnesses) else 100;lk,st=threshold_for(brightness)
        vals=[float(d.get('effective_conf',d['conf'])) for d in ds]
        weak_frames+=int(any(x>=MIN_RAW_CONF for x in vals))
        likely_frames+=int(any(x>=lk for x in vals));strong_frames+=int(any(x>=st for x in vals))
    night_clip=bool(brightnesses and (sum(brightnesses)/len(brightnesses))<58.0)
    vehicle_dominated=(night_clip and best.get('vehicle_dominant_hits',0)>=2
                       and best.get('vehicle_clean_likely',0)<2
                       and best.get('vehicle_peak',0)>=NIGHT_VEHICLE_CONF
                       and best.get('person_vehicle_margin',-1)<.18)
    if used<10:
        status='unknown';reason='insufficient-samples'
    elif vehicle_dominated:
        status='uncertain';reason='night-vehicle-dominant-person-rejected'
    elif best.get('vehicle_clean_strong',0)>=2 and night_clip:
        status='confirmed_person';reason='night-clean-track-two-strong'
    elif best.get('strong',0)>=2 and best.get('frames',0)>=2:
        status='confirmed_person';reason='adaptive-track-two-strong'
    elif best.get('likely',0)>=3 and best.get('frames',0)>=3:
        status='confirmed_person';reason='adaptive-track-three-likely'
    elif best.get('likely',0)>=2 and best.get('weak',0)>=3 and best.get('frames',0)>=3:
        status='confirmed_person';reason='adaptive-track-temporal-support'
    elif best.get('likely',0)>=1 or (best.get('weak',0)>=2 and best.get('frames',0)>=2):
        status='likely_person';reason='adaptive-limited-person-evidence'
    elif weak_frames:
        status='uncertain';reason='adaptive-single-weak-evidence'
    else:
        status='no_person_sampled';reason='adaptive-global-and-tile-no-person'
    return status,weak_frames,likely_frames,strong_frames,reason,summaries[:4]

def detect_clip(net,p):
    cap=cv2.VideoCapture(str(p))
    frames=int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    fps=float(cap.get(cv2.CAP_PROP_FPS) or 0)
    if frames<1:
        cap.release()
        return {'person_confidence':0.0,'car_confidence':0.0,'used':0,'fps':fps,'frames':frames,
                'frame_scores':[],'sources':[],'brightness':[],'per_frame':[]}
    used=0;pc=0.0;vc=0.0;frame_scores=[];sources=[];brightnesses=[];per_frame=[]
    global_peak=0.0;tile_peak=0.0;tile_frames=0
    for idx,frac in enumerate(SAMPLE_FRACTIONS):
        pos=max(0,min(frames-1,int((frames-1)*frac)))
        cap.set(cv2.CAP_PROP_POS_FRAMES,pos);ok,frame=cap.read()
        if not ok or frame is None:continue
        used+=1
        brightness=float(cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY).mean())
        brightnesses.append(brightness)
        people,veh=infer(net,frame,'global')
        vc=max(vc,veh)
        gp=max([d['conf'] for d in people],default=0.0);global_peak=max(global_peak,gp)
        # Always inspect four temporal anchors. Also magnify frames with weak global
        # evidence, which often means a distant/partially occluded person.
        do_tiles=(idx in TILE_ANCHORS) or (.10<=gp<.58) or (brightness<58 and idx in {4,8,12})
        if do_tiles:
            tile_frames+=1
            for crop,spec in tile_views(frame):
                ds,v=infer(net,crop,'tile',spec);people.extend(ds);vc=max(vc,v)
            tp=max([d['conf'] for d in people if d['source']=='tile'],default=0.0);tile_peak=max(tile_peak,tp)
        people=dedupe(people)
        per_frame.append(people)
        best=max(people,key=lambda d:d['conf']) if people else None
        score=float(best['conf']) if best else 0.0
        pc=max(pc,score);frame_scores.append(round(score,4));sources.append(best['source'] if best else 'none')
    cap.release()
    return {'person_confidence':pc,'car_confidence':vc,'used':used,'fps':fps,'frames':frames,
            'frame_scores':frame_scores,'sources':sources,'brightness':brightnesses,'per_frame':per_frame,
            'global_peak':global_peak,'tile_peak':tile_peak,'tile_frames':tile_frames}

def main():
    r=subprocess.run(['/usr/bin/python3',str(SELECT)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=20)
    if r.returncode:log('DETECT=SELECTOR_FAILED');return 2
    c=load(CANDS,{});rows=list(c.get('candidates') or [])
    seen={(str(x.get('camera') or ''),pathlib.Path(str(x.get('clip_name') or '')).name) for x in rows}
    for cam,root in ROOTS.items():
        ev=load(root/'events.json',[])
        if isinstance(ev,dict):ev=ev.get('events',[])
        for e in ev if isinstance(ev,list) else []:
            name=pathlib.Path(str(e.get('clip') or '')).name
            if not name or (cam,name) in seen or not (root/'clips'/name).is_file():continue
            rows.append({'camera':cam,'clip_name':name,'clip_no':e.get('clip_no'),'timestamp':e.get('timestamp'),
                         'highlight_score':-1.0,'retention_only':True})
            seen.add((cam,name))
    idx=load(IDX,{'version':2,'model':MODEL_ID,'items':{}});items=idx.setdefault('items',{})
    net=cv2.dnn.readNetFromCaffe(str(PROTO),str(MODEL));todo=[]
    for x in rows:
        cam=x.get('camera');root=ROOTS.get(cam);name=pathlib.Path(str(x.get('clip_name') or '')).name
        if not root or not name:continue
        p=root/'clips'/name
        if not p.is_file():continue
        st=p.stat();key=f'{cam}:{name}';old=items.get(key,{})
        if old.get('model')==MODEL_ID and int(old.get('size') or -1)==st.st_size and int(old.get('mtime_ns') or -1)==st.st_mtime_ns:
            incoming=round(float(x.get('highlight_score') or 0),4)
            previous=float(old.get('highlight_score') if old.get('highlight_score') is not None else -1.0)
            old['highlight_score']=round(max(previous,incoming),4)
            old['clip_no']=x.get('clip_no');old['timestamp']=x.get('timestamp')
            old['retention_only']=bool(old.get('retention_only',True) and x.get('retention_only'));items[key]=old
            continue
        # Current/high-value clips first; old model rows are re-evaluated progressively.
        boost=1.0 if old.get('model') and old.get('model')!=MODEL_ID else 0.0
        todo.append((float(x.get('highlight_score') or 0)+boost,cam,name,p,x,st))
    todo.sort(reverse=True,key=lambda z:z[0]);analyzed=0
    for _,cam,name,p,x,st in todo[:MAX_PER_RUN]:
        try:
            d=detect_clip(net,p)
            status,weak,likely,strong,reason,tracks=classify(d['per_frame'],d['brightness'],d['used'])
            items[f'{cam}:{name}']={
                'camera':cam,'clip_name':name,'clip_no':x.get('clip_no'),'timestamp':x.get('timestamp'),
                'person_confidence':round(d['person_confidence'],4),'car_confidence':round(d['car_confidence'],4),
                'highlight_score':round(float(x.get('highlight_score') or 0),4),'sample_count':d['used'],
                'person_frame_scores':d['frame_scores'],'person_frame_sources':d['sources'],
                'person_weak_frames':weak,'person_likely_frames':likely,'person_strong_frames':strong,
                'person_status':status,'person_status_reason':reason,'person_tracks':tracks,
                'person_global_peak':round(d['global_peak'],4),'person_tile_peak':round(d['tile_peak'],4),
                'person_tile_frames':d['tile_frames'],'night_vehicle_guard':True,
                'person_brightness_mean':round(sum(d['brightness'])/len(d['brightness']),1) if d['brightness'] else None,
                'person_detection_mode':'adaptive-global+2x2-small-person+temporal-track+night-vehicle-guard',
                'fps':round(d['fps'],3),'frames':d['frames'],'size':st.st_size,'mtime_ns':st.st_mtime_ns,
                'model':MODEL_ID,'retention_only':bool(x.get('retention_only')),
                'analyzed_at':datetime.datetime.now().astimezone().isoformat()}
            analyzed+=1
            log(f"DETECT_V117 camera={cam} clip={name} person={d['person_confidence']:.3f} "
                f"global={d['global_peak']:.3f} tile={d['tile_peak']:.3f} status={status} "
                f"frames={weak}/{d['used']} strong={strong} tiles={d['tile_frames']}")
        except Exception as e:
            log(f'DETECT_V117_ERROR camera={cam} clip={name} error={type(e).__name__}:{str(e)[:160]}')
    idx['version']=2;idx['model']=MODEL_ID;idx['updated_at']=datetime.datetime.now().astimezone().isoformat()
    idx['items']=items;atomic(IDX,idx)
    statuses={}
    for v in items.values():
        s=str(v.get('person_status') or 'unknown');statuses[s]=statuses.get(s,0)+1
    log(f'DETECT_V117=PASS analyzed={analyzed} indexed={len(items)} statuses={statuses}')
    return 0

if __name__=='__main__':raise SystemExit(main())
'''

candidate=Path("/tmp/c720p-person-highlight-detect-v117.py")
candidate.write_text(detector);candidate.chmod(0o755)
r=subprocess.run([str(BASE/"person-detector/venv/bin/python"),"-m","py_compile",str(candidate)],text=True,capture_output=True)
if r.returncode:raise SystemExit("V117_COMPILE_FAILED:"+r.stderr[-1200:])

# Run the new detector as a shadow copy against current local clips. It writes the
# same index only after completing a clip, so backup permits immediate rollback.
start=time.time()
shadow=subprocess.run([str(BASE/"person-detector/venv/bin/python"),str(candidate)],
                      text=True,capture_output=True,timeout=240)
if shadow.returncode:
    raise SystemExit("V117_SHADOW_FAILED:"+shadow.stderr[-1600:]+"\\n"+shadow.stdout[-1600:])
elapsed=time.time()-start

# Install only after the real-model shadow run succeeds.
shutil.copy2(candidate,DET);DET.chmod(0o755)

# Disable the old no-person cleaner's classifier-driven destructive deletion.
# Retention already owns storage pressure; detection should classify, not erase evidence.
clean=BIN/"c720p-person-no-person-clean.py"
if clean.exists():
    shutil.copy2(clean,BACK/(clean.name+".before"))
    cs=clean.read_text()
    if "# V117_CLASSIFICATION_ONLY" not in cs:
        cs=cs.replace(
            "if res['status']=='confirmed_no_person' and age_h>=6.0 and not e.get('saved'):",
            "if False and res['status']=='confirmed_no_person' and age_h>=6.0 and not e.get('saved'):  # V117_CLASSIFICATION_ONLY"
        )
        clean.write_text(cs)
        cr=subprocess.run(["python3","-m","py_compile",str(clean)],text=True,capture_output=True)
        if cr.returncode:raise SystemExit("CLEANER_COMPILE_FAILED:"+cr.stderr[-1000:])

# Restart any timer/service that explicitly references the detector.
subprocess.run(["systemctl","--user","daemon-reload"],check=True,timeout=20)
units=[]
for p in UNIT.glob("*.service"):
    try:
        if "c720p-person-highlight-detect.py" in p.read_text():units.append(p.name)
    except Exception:pass
for name in units:
    subprocess.run(["systemctl","--user","try-restart",name],check=False,timeout=20)

idx=json.loads((BASE/"state/person-detection-index.json").read_text())
items=idx.get("items",{})
recent=[v for k,v in items.items() if k.startswith("new:")]
recent.sort(key=lambda x:str(x.get("analyzed_at") or ""),reverse=True)
v117=[x for x in recent if str(x.get("model") or "").endswith("-v117")]
summary={}
for x in v117:
    s=str(x.get("person_status") or "unknown");summary[s]=summary.get(s,0)+1

print(json.dumps({
    "ok":True,
    "version":"v117",
    "backup":str(BACK),
    "shadow_seconds":round(elapsed,1),
    "detector_path":str(DET),
    "model_id":"mobilenet-ssd-voc-73000-adaptive-small-person-v117",
    "new_camera_v117_rows":len(v117),
    "v117_statuses":summary,
    "sample":[{
        "clip_no":x.get("clip_no"),
        "status":x.get("person_status"),
        "confidence":x.get("person_confidence"),
        "global_peak":x.get("person_global_peak"),
        "tile_peak":x.get("person_tile_peak"),
        "weak_frames":x.get("person_weak_frames"),
        "likely_frames":x.get("person_likely_frames"),
        "strong_frames":x.get("person_strong_frames"),
        "reason":x.get("person_status_reason")
    } for x in v117[:6]],
    "classification_only_no_person_cleanup":True,
    "restarted_services":units,
},indent=2))
