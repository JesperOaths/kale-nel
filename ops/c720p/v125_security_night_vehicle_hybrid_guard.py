#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import datetime, json, os, re, shutil, subprocess, time

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
BIN=BASE/"bin"
UNIT=HOME/".config/systemd/user"
VENV=BASE/"person-detector/venv/bin/python"

HYBRID=BIN/"c720p-person-hybrid-v125.py"
DETECT=BIN/"c720p-person-highlight-detect-v125.py"
LOCAL=BIN/"c720p-person-no-person-clean-v125.py"
DRIVE=BIN/"c720p-drive-person-revalidate-v125.py"
RET=BIN/"c720p-drive-value-retention.py"

DS=UNIT/"c720p-person-highlight-detect.service"
LS=UNIT/"c720p-person-no-person-clean.service"
RS=UNIT/"c720p-drive-person-revalidate.service"
DT=UNIT/"c720p-person-highlight-detect.timer"
LT=UNIT/"c720p-person-no-person-clean.timer"
RT=UNIT/"c720p-drive-person-revalidate.timer"

STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"person-night-vehicle-v125-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)

def backup(p):
    p=Path(p)
    if p.exists(): shutil.copy2(p,BACK/(p.name+".before"))

for p in (BIN/"c720p-person-hybrid-v116.py",BIN/"c720p-person-highlight-detect-v116.py",
          BIN/"c720p-person-no-person-clean-v116.py",BIN/"c720p-drive-person-revalidate-v116.py",
          DS,LS,RS,RET):
    backup(p)

hybrid=r'''#!/home/jespern/c720p-home-hub/person-detector/venv/bin/python
from __future__ import annotations
import cv2,numpy as np,pathlib,re

cv2.setNumThreads(1)
BASE=pathlib.Path("/home/jespern/c720p-home-hub")
MOBILE_MODEL=BASE/"person-detector/model/mobilenet_iter_73000.caffemodel"
MOBILE_PROTO=BASE/"person-detector/model/deploy.prototxt"
YOLO_MODEL=BASE/"person-detector/model/yolov5n-v7.0.onnx"

MODEL_ID="hybrid-mobilenetssd+yolov5n-night-vehicle-v125"
MOBILE_PERSON=15
MOBILE_VEHICLE={2,6,7,14}
YOLO_VEHICLE={1:"bicycle",2:"car",3:"motorcycle",5:"bus",7:"truck"}

M_RAW=.15;M_LIKELY=.35;M_STRONG=.55
Y_RAW=.10;Y_LIKELY=.22;Y_STRONG=.40
Y_VEH_RAW=.12;Y_VEH_LIKELY=.25
NIGHT_BRIGHTNESS=72.0
QUICK_FRACTIONS=(.04,.12,.20,.28,.36,.44,.52,.60,.68,.76,.84,.92)

def iou(a,b):
    ax1,ay1,ax2,ay2=a;bx1,by1,bx2,by2=b
    x1=max(ax1,bx1);y1=max(ay1,by1);x2=min(ax2,bx2);y2=min(ay2,by2)
    inter=max(0.0,x2-x1)*max(0.0,y2-y1)
    aa=max(0.0,ax2-ax1)*max(0.0,ay2-ay1);bb=max(0.0,bx2-bx1)*max(0.0,by2-by1)
    return inter/max(1e-9,aa+bb-inter)

def center_in(inner,outer,pad=.08):
    x1,y1,x2,y2=inner;cx=(x1+x2)/2;cy=(y1+y2)/2
    a,b,c,d=outer;w=c-a;h=d-b
    return (a-pad*w)<=cx<=(c+pad*w) and (b-pad*h)<=cy<=(d+pad*h)

class HybridDetector:
    def __init__(self):
        self.mobile=cv2.dnn.readNetFromCaffe(str(MOBILE_PROTO),str(MOBILE_MODEL))
        self.yolo=cv2.dnn.readNetFromONNX(str(YOLO_MODEL))

    def mobile_frame(self,frame):
        blob=cv2.dnn.blobFromImage(frame,0.007843,(300,300),127.5,swapRB=False,crop=False)
        self.mobile.setInput(blob);d=self.mobile.forward()
        pc=0.0;vc=0.0
        for i in range(d.shape[2]):
            conf=float(d[0,0,i,2])
            if conf<M_RAW:continue
            cls=int(d[0,0,i,1])
            if cls==MOBILE_PERSON:pc=max(pc,conf)
            elif cls in MOBILE_VEHICLE:vc=max(vc,conf)
        return pc,vc

    @staticmethod
    def _letterbox(frame,size=640):
        h,w=frame.shape[:2];scale=min(size/max(1,w),size/max(1,h))
        nw=max(1,int(round(w*scale)));nh=max(1,int(round(h*scale)))
        r=cv2.resize(frame,(nw,nh),interpolation=cv2.INTER_LINEAR)
        c=np.full((size,size,3),114,dtype=np.uint8);x=(size-nw)//2;y=(size-nh)//2
        c[y:y+nh,x:x+nw]=r
        return c

    @staticmethod
    def _box(row):
        x,y,w,h=[float(v) for v in row[:4]]
        return (x-w/2,y-h/2,x+w/2,y+h/2)

    def yolo_frame(self,frame):
        inp=self._letterbox(frame,640)
        blob=cv2.dnn.blobFromImage(inp,1.0/255.0,(640,640),swapRB=True,crop=False)
        self.yolo.setInput(blob);out=self.yolo.forward()
        rows=out[0] if out.ndim==3 else out
        if rows is None or len(rows)==0:
            return {"person":0.0,"clean_person":0.0,"vehicle":0.0,"road_vehicle":0.0,
                    "truck":0.0,"conflict":False,"conflict_person":0.0,"vehicle_class":None}
        obj=rows[:,4]
        pscore=obj*rows[:,5]
        vehicle_cols=sorted(YOLO_VEHICLE)
        vmat=np.stack([obj*rows[:,5+c] for c in vehicle_cols],axis=1)
        vmax=vmat.max(axis=1)
        varg=vmat.argmax(axis=1)
        road_cols=[2,5,7]
        road=np.stack([obj*rows[:,5+c] for c in road_cols],axis=1).max(axis=1)
        truck=obj*rows[:,5+7]

        pidx=[int(i) for i in np.where(pscore>=.06)[0]]
        vidx=[int(i) for i in np.where(vmax>=Y_VEH_RAW)[0]]
        clean=0.0;conflict_person=0.0;conflict=False
        for pi in pidx:
            pc=float(pscore[pi]);pb=self._box(rows[pi]);same=float(vmax[pi])
            bad=(same>=Y_VEH_RAW and same>=pc-.08)
            if not bad:
                for vi in vidx:
                    vc=float(vmax[vi])
                    if vc<Y_VEH_LIKELY:continue
                    vb=self._box(rows[vi])
                    if (iou(pb,vb)>=.15 or center_in(pb,vb,.10)) and vc>=pc-.12:
                        bad=True;break
            if bad:
                conflict=True;conflict_person=max(conflict_person,pc)
            else:clean=max(clean,pc)

        vi=int(np.argmax(vmax)) if vmax.size else 0
        vcls=vehicle_cols[int(varg[vi])] if vmax.size else None
        return {
            "person":float(pscore.max()) if pscore.size else 0.0,
            "clean_person":clean,
            "vehicle":float(vmax.max()) if vmax.size else 0.0,
            "road_vehicle":float(road.max()) if road.size else 0.0,
            "truck":float(truck.max()) if truck.size else 0.0,
            "conflict":bool(conflict),
            "conflict_person":float(conflict_person),
            "vehicle_class":YOLO_VEHICLE.get(vcls),
        }

    @staticmethod
    def _small_gray(frame):
        g=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY)
        return cv2.resize(g,(160,90),interpolation=cv2.INTER_AREA)

    @staticmethod
    def _lowlight(frame):
        lab=cv2.cvtColor(frame,cv2.COLOR_BGR2LAB);l,a,b=cv2.split(lab)
        clahe=cv2.createCLAHE(clipLimit=2.0,tileGridSize=(8,8));l=clahe.apply(l)
        return cv2.cvtColor(cv2.merge((l,a,b)),cv2.COLOR_LAB2BGR)

    @staticmethod
    def _positions(frames,fps,mode):
        if frames<1:return []
        if mode=="quick":
            return [max(0,min(frames-1,int((frames-1)*f))) for f in QUICK_FRACTIONS]
        duration=frames/fps if fps>0 else 45.0
        count=max(12,min(60,int(round(duration))))
        if count<=1:return [frames//2]
        return [max(0,min(frames-1,int((frames-1)*(0.03+0.94*i/(count-1))))) for i in range(count)]

    @staticmethod
    def _choose_yolo(rows,mode):
        if not rows:return []
        wanted=4 if mode=="quick" else 6;picked=[]
        def add(i):
            if i not in picked:picked.append(i)
        # A MobileNet person hit that is actually a vehicle still gets escalated to
        # YOLO; that is intentional because YOLO is now the vehicle-confusion arbiter.
        add(max(range(len(rows)),key=lambda i:rows[i]["mobile_person"]))
        for i in sorted(range(len(rows)),key=lambda i:rows[i]["motion"],reverse=True):
            if len(picked)>=wanted:break
            if all(abs(i-j)>=2 for j in picked) or len(picked)<2:add(i)
        add(len(rows)//2)
        for i in sorted(range(len(rows)),key=lambda i:rows[i]["mobile_vehicle"],reverse=True):
            if len(picked)>=wanted:break
            add(i)
        for i in sorted(range(len(rows)),key=lambda i:rows[i]["motion"],reverse=True):
            if len(picked)>=wanted:break
            add(i)
        return picked[:wanted]

    @staticmethod
    def _filename_hour(path):
        m=re.search(r'(20\d{6})(\d{2})\d{4}',pathlib.Path(path).name)
        if not m:return None
        try:return int(m.group(2))
        except:return None

    def analyze_clip(self,path,mode="quick"):
        path=pathlib.Path(path);cap=cv2.VideoCapture(str(path))
        frames=int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0);fps=float(cap.get(cv2.CAP_PROP_FPS) or 0)
        positions=self._positions(frames,fps,mode);rows=[];prev=None
        for pos in positions:
            cap.set(cv2.CAP_PROP_POS_FRAMES,pos);ok,frame=cap.read()
            if not ok or frame is None:continue
            mp,mv=self.mobile_frame(frame);small=self._small_gray(frame)
            motion=float(cv2.mean(cv2.absdiff(small,prev))[0]/255.0) if prev is not None else 0.0
            prev=small;brightness=float(cv2.mean(small)[0])
            rows.append({"pos":pos,"mobile_person":float(mp),"mobile_vehicle":float(mv),
                         "motion":motion,"brightness":brightness})
        cap.release()

        selected=self._choose_yolo(rows,mode);yinfo={}
        cap=cv2.VideoCapture(str(path))
        for i in selected:
            cap.set(cv2.CAP_PROP_POS_FRAMES,rows[i]["pos"]);ok,frame=cap.read()
            if ok and frame is not None:yinfo[i]=self.yolo_frame(frame)

        # Selective low-light second look. Merge conservatively: a CLAHE pass can
        # increase person sensitivity, but it is not allowed to erase vehicle evidence.
        if selected and yinfo:
            best_clean=max((x["clean_person"] for x in yinfo.values()),default=0.0)
            dark=[i for i in selected if rows[i]["brightness"]<55.0]
            if dark and best_clean<Y_LIKELY and max((r["mobile_person"] for r in rows),default=0.0)>=M_RAW:
                i=max(dark,key=lambda j:(rows[j]["mobile_person"],rows[j]["motion"]))
                cap.set(cv2.CAP_PROP_POS_FRAMES,rows[i]["pos"]);ok,frame=cap.read()
                if ok and frame is not None:
                    z=self.yolo_frame(self._lowlight(frame));old=yinfo.get(i,{})
                    merged={}
                    for k in ("person","clean_person","vehicle","road_vehicle","truck","conflict_person"):
                        merged[k]=max(float(old.get(k,0)),float(z.get(k,0)))
                    merged["conflict"]=bool(old.get("conflict") or z.get("conflict"))
                    merged["vehicle_class"]=old.get("vehicle_class") if float(old.get("vehicle",0))>=float(z.get("vehicle",0)) else z.get("vehicle_class")
                    yinfo[i]=merged
        cap.release()

        ms=[r["mobile_person"] for r in rows];mvs=[r["mobile_vehicle"] for r in rows]
        ys=[x["person"] for x in yinfo.values()]
        yclean=[x["clean_person"] for x in yinfo.values()]
        yveh=[x["vehicle"] for x in yinfo.values()]
        yroad=[x["road_vehicle"] for x in yinfo.values()]
        ytruck=[x["truck"] for x in yinfo.values()]
        mweak=sum(x>=M_RAW for x in ms);mlikely=sum(x>=M_LIKELY for x in ms);mstrong=sum(x>=M_STRONG for x in ms)
        yweak=sum(x>=Y_RAW for x in ys);ylikely=sum(x>=Y_LIKELY for x in ys);ystrong=sum(x>=Y_STRONG for x in ys)
        clean_likely=sum(x>=Y_LIKELY for x in yclean);clean_strong=sum(x>=Y_STRONG for x in yclean)
        yconflicts=sum(1 for x in yinfo.values() if x["conflict"] and x["vehicle"]>=Y_VEH_LIKELY)
        mobile_vehicle_dom=sum(1 for r in rows if r["mobile_vehicle"]>=.45 and r["mobile_vehicle"]>=r["mobile_person"]+.08)
        bmean=(sum(r["brightness"] for r in rows)/len(rows)) if rows else None
        fhour=self._filename_hour(path)
        clock_night=(fhour is not None and (fhour>=20 or fhour<7))
        night_scene=bool((bmean is not None and bmean<NIGHT_BRIGHTNESS) or clock_night)
        mobile_vehicle_peak=max(mvs,default=0.0);yolo_vehicle_peak=max(yveh,default=0.0)
        road_vehicle_peak=max(yroad,default=0.0);truck_peak=max(ytruck,default=0.0)

        # At night, only clean YOLO person evidence may confirm a person when the
        # same spatial region is also strongly car/bus/truck-like.
        human_override=(clean_strong>=1 and clean_likely>=2) or clean_strong>=2
        vehicle_risk=night_scene and not human_override and (
            (yconflicts>=1 and road_vehicle_peak>=.30 and clean_likely<2) or
            (mobile_vehicle_dom>=2 and mobile_vehicle_peak>=.55 and clean_likely==0) or
            (road_vehicle_peak>=.60 and mobile_vehicle_peak>=.45 and clean_likely==0)
        )

        mobile_confirm=(mstrong>=2 or mlikely>=3)
        # Daylight retains the established hybrid behavior. Low-light confirmation
        # uses only person boxes that are spatially clean of vehicle detections.
        if night_scene:
            yolo_confirm=(clean_strong>=2 or (clean_strong>=1 and clean_likely>=2))
            cross_confirm=(mobile_confirm and clean_likely>=1 and not vehicle_risk)
        else:
            yolo_confirm=(ystrong>=2 or (ystrong>=1 and ylikely>=2))
            cross_confirm=(mobile_confirm and ylikely>=1)

        if vehicle_risk:
            if mweak or yweak:
                status="uncertain";reason="night-vehicle-confusion-rejected"
            else:
                status="no_person_sampled";reason="night-vehicle-only"
        elif yolo_confirm or cross_confirm:
            status="confirmed_person";reason="hybrid-multiframe-person"
        elif (clean_likely if night_scene else ylikely)>=1:
            status="likely_person";reason="yolov5n-clean-person-support" if night_scene else "yolov5n-person-support"
        elif mlikely>=1 and (max(yclean,default=0.0) if night_scene else max(ys,default=0.0))>=Y_RAW:
            status="likely_person";reason="cross-model-limited-person-evidence"
        elif mode=="full" and len(rows)>=12 and mweak==0 and len(ys)>=4 and yweak==0:
            status="confirmed_no_person";reason="hybrid-fullscan-zero-person"
        elif mweak==0 and yweak==0:
            status="no_person_sampled";reason="hybrid-sample-zero-person"
        else:
            status="uncertain";reason="single-model-or-weak-person-evidence"

        fused=[round(max(r["mobile_person"],yinfo.get(i,{}).get("clean_person" if night_scene else "person",0.0)),4) for i,r in enumerate(rows)]
        return {
            "model":MODEL_ID,"mode":mode,"status":status,"reason":reason,
            "person_confidence":round(max(max(ms,default=0.0),max(yclean if night_scene else ys,default=0.0)),4),
            "mobile_peak":round(max(ms,default=0.0),4),"yolo_peak":round(max(ys,default=0.0),4),
            "yolo_clean_person_peak":round(max(yclean,default=0.0),4),
            "vehicle_confidence":round(max(mobile_vehicle_peak,yolo_vehicle_peak),4),
            "mobile_vehicle_peak":round(mobile_vehicle_peak,4),"yolo_vehicle_peak":round(yolo_vehicle_peak,4),
            "road_vehicle_peak":round(road_vehicle_peak,4),"truck_peak":round(truck_peak,4),
            "vehicle_conflict_frames":yconflicts,"mobile_vehicle_dominant_frames":mobile_vehicle_dom,
            "night_scene":night_scene,"guard_triggered":bool(vehicle_risk),
            "sample_count":len(rows),"yolo_sample_count":len(ys),"person_frame_scores":fused,
            "mobile_frame_scores":[round(x,4) for x in ms],
            "mobile_vehicle_frame_scores":[round(x,4) for x in mvs],
            "yolo_frame_scores":[round(yinfo[i]["person"],4) if i in yinfo else None for i in range(len(rows))],
            "yolo_clean_person_frame_scores":[round(yinfo[i]["clean_person"],4) if i in yinfo else None for i in range(len(rows))],
            "yolo_vehicle_frame_scores":[round(yinfo[i]["vehicle"],4) if i in yinfo else None for i in range(len(rows))],
            "mobile_weak_frames":mweak,"mobile_likely_frames":mlikely,"mobile_strong_frames":mstrong,
            "yolo_weak_frames":yweak,"yolo_likely_frames":ylikely,"yolo_strong_frames":ystrong,
            "yolo_clean_likely_frames":clean_likely,"yolo_clean_strong_frames":clean_strong,
            "selected_yolo_indices":selected,"brightness_mean":round(bmean,1) if bmean is not None else None,
            "fps":round(fps,3),"frames":frames,
        }
'''
HYBRID.write_text(hybrid);HYBRID.chmod(0o755)

detect=r'''#!/home/jespern/c720p-home-hub/person-detector/venv/bin/python
import json,os,pathlib,subprocess,time,datetime,sys,fcntl
BASE=pathlib.Path('/home/jespern/c720p-home-hub')
ROOT=pathlib.Path('/opt/homeassistant/config/www/frontyard-security-new')
IDX=BASE/'state/person-detection-index.json';LOCK=BASE/'state/person-detection-index.lock'
CANDS=BASE/'state/motion-highlight-candidates.json';SELECT=BASE/'bin/c720p-motion-highlight-select.py'
LOG=BASE/'logs/person-highlight-detect.log';MAX_PER_RUN=3
sys.path.insert(0,str(BASE/'bin'))
from importlib.machinery import SourceFileLoader
hy=SourceFileLoader('c720p_person_hybrid_v125',str(BASE/'bin/c720p-person-hybrid-v125.py')).load_module()
MODEL_ID=hy.MODEL_ID
def log(s):
 line=time.strftime('%Y-%m-%d %H:%M:%S')+' '+s;print(line,flush=True);LOG.parent.mkdir(parents=True,exist_ok=True);open(LOG,'a').write(line+'\n')
def load(p,d):
 try:return json.loads(pathlib.Path(p).read_text())
 except:return d
def atomic(p,o):
 p=pathlib.Path(p);q=p.with_suffix(p.suffix+'.tmp-v125-'+str(os.getpid()));q.write_text(json.dumps(o,indent=2)+'\n');os.replace(q,p)
def main():
 with open(LOCK,'a+') as lk:
  try:fcntl.flock(lk,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:log('DETECT_V125=SKIP index_lock_busy');return 0
  r=subprocess.run(['/usr/bin/python3',str(SELECT)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=20)
  if r.returncode:log('DETECT_V125=SELECTOR_FAILED');return 2
  c=load(CANDS,{});rows=[x for x in list(c.get('candidates') or []) if str(x.get('camera') or 'new')=='new']
  seen={pathlib.Path(str(x.get('clip_name') or '')).name for x in rows}
  ev=load(ROOT/'events.json',[])
  if isinstance(ev,dict):ev=ev.get('events',[])
  for e in ev if isinstance(ev,list) else []:
   name=pathlib.Path(str(e.get('clip') or '')).name
   if not name or name in seen or not (ROOT/'clips'/name).is_file():continue
   rows.append({'camera':'new','clip_name':name,'clip_no':e.get('clip_no'),'timestamp':e.get('timestamp'),'highlight_score':-1.0,'retention_only':True});seen.add(name)
  idx=load(IDX,{'version':3,'model':MODEL_ID,'items':{}});items=idx.setdefault('items',{});todo=[]
  for x in rows:
   name=pathlib.Path(str(x.get('clip_name') or '')).name;p=ROOT/'clips'/name
   if not name or not p.is_file():continue
   st=p.stat();key='new:'+name;old=items.get(key,{})
   if old.get('model')==MODEL_ID and int(old.get('size') or -1)==st.st_size and int(old.get('mtime_ns') or -1)==st.st_mtime_ns:continue
   boost=1.0 if old.get('model') and old.get('model')!=MODEL_ID else 0.0
   todo.append((float(x.get('highlight_score') or 0)+boost,name,p,x,st))
  todo.sort(reverse=True,key=lambda z:z[0]);detector=hy.HybridDetector();analyzed=0
  for _,name,p,x,st in todo[:MAX_PER_RUN]:
   try:
    res=detector.analyze_clip(p,'quick')
    items['new:'+name]={
     'camera':'new','clip_name':name,'clip_no':x.get('clip_no'),'timestamp':x.get('timestamp'),
     'person_confidence':res['person_confidence'],'person_confidence_mobile':res['mobile_peak'],
     'person_confidence_yolo':res['yolo_peak'],'person_confidence_yolo_clean':res['yolo_clean_person_peak'],
     'car_confidence':res['vehicle_confidence'],'mobile_vehicle_confidence':res['mobile_vehicle_peak'],
     'yolo_vehicle_confidence':res['yolo_vehicle_peak'],'road_vehicle_confidence':res['road_vehicle_peak'],
     'truck_confidence':res['truck_peak'],'vehicle_conflict_frames':res['vehicle_conflict_frames'],
     'mobile_vehicle_dominant_frames':res['mobile_vehicle_dominant_frames'],
     'night_scene':res['night_scene'],'night_vehicle_guard_triggered':res['guard_triggered'],
     'highlight_score':round(float(x.get('highlight_score') or 0),4),'sample_count':res['sample_count'],
     'person_frame_scores':res['person_frame_scores'],'person_mobile_frame_scores':res['mobile_frame_scores'],
     'person_yolo_frame_scores':res['yolo_frame_scores'],'person_yolo_clean_frame_scores':res['yolo_clean_person_frame_scores'],
     'vehicle_yolo_frame_scores':res['yolo_vehicle_frame_scores'],
     'person_weak_frames':res['mobile_weak_frames']+res['yolo_weak_frames'],
     'person_likely_frames':res['mobile_likely_frames']+res['yolo_clean_likely_frames'],
     'person_strong_frames':res['mobile_strong_frames']+res['yolo_clean_strong_frames'],
     'person_status':res['status'],'person_status_reason':res['reason'],'person_yolo_samples':res['yolo_sample_count'],
     'brightness_mean':res['brightness_mean'],'fps':res['fps'],'frames':res['frames'],
     'size':st.st_size,'mtime_ns':st.st_mtime_ns,'model':MODEL_ID,'retention_only':bool(x.get('retention_only')),
     'analyzed_at':datetime.datetime.now().astimezone().isoformat()
    }
    analyzed+=1;log(f"DETECT_V125 clip={name} status={res['status']} p={res['person_confidence']:.3f} road={res['road_vehicle_peak']:.3f} truck={res['truck_peak']:.3f} guard={res['guard_triggered']}")
   except Exception as e:log(f'DETECT_V125_ERROR clip={name} error={type(e).__name__}:{str(e)[:180]}')
  idx['version']=3;idx['model']=MODEL_ID;idx['updated_at']=datetime.datetime.now().astimezone().isoformat();idx['items']=items;atomic(IDX,idx)
  log(f'DETECT_V125=PASS analyzed={analyzed} indexed={len(items)}');return 0
if __name__=='__main__':raise SystemExit(main())
'''
DETECT.write_text(detect);DETECT.chmod(0o755)

local=r'''#!/home/jespern/c720p-home-hub/person-detector/venv/bin/python
import json,os,pathlib,datetime,fcntl
BASE=pathlib.Path('/home/jespern/c720p-home-hub');ROOT=pathlib.Path('/opt/homeassistant/config/www/frontyard-security-new')
DET=BASE/'state/person-detection-index.json';LOCK=BASE/'state/person-detection-index.lock';REPORT=BASE/'state/person-no-person-clean-last.json'
from importlib.machinery import SourceFileLoader
hy=SourceFileLoader('c720p_person_hybrid_v125',str(BASE/'bin/c720p-person-hybrid-v125.py')).load_module()
def atomic(p,o):
 p=pathlib.Path(p);q=p.with_suffix(p.suffix+'.tmp-v125-'+str(os.getpid()));q.write_text(json.dumps(o,indent=2)+'\n');os.replace(q,p)
def main():
 with open(LOCK,'a+') as lk:
  fcntl.flock(lk,fcntl.LOCK_EX)
  try:ev=json.loads((ROOT/'events.json').read_text())
  except:ev=[]
  if isinstance(ev,dict):ev=ev.get('events',[])
  try:idx=json.loads(DET.read_text())
  except:idx={'items':{}}
  items=idx.setdefault('items',{});cands=[]
  for e in ev if isinstance(ev,list) else []:
   name=pathlib.Path(str(e.get('clip') or '')).name;cp=ROOT/'clips'/name
   if not name or not cp.is_file():continue
   d=items.get('new:'+name,{})
   if d.get('model')!=hy.MODEL_ID or str(d.get('person_status') or '') in ('no_person_sampled','uncertain','unknown',''):
    cands.append((str(e.get('timestamp') or ''),e,name,cp,d))
  cands.sort(reverse=True,key=lambda x:x[0]);reviewed=[]
  if cands:
   _,e,name,cp,d=cands[0];res=hy.HybridDetector().analyze_clip(cp,'full')
   d.update({'model':hy.MODEL_ID,'person_status':res['status'],'person_status_reason':res['reason'],
    'person_confidence':res['person_confidence'],'person_confidence_mobile':res['mobile_peak'],
    'person_confidence_yolo':res['yolo_peak'],'person_confidence_yolo_clean':res['yolo_clean_person_peak'],
    'car_confidence':res['vehicle_confidence'],'road_vehicle_confidence':res['road_vehicle_peak'],
    'truck_confidence':res['truck_peak'],'vehicle_conflict_frames':res['vehicle_conflict_frames'],
    'night_scene':res['night_scene'],'night_vehicle_guard_triggered':res['guard_triggered'],
    'person_fullscan_at':datetime.datetime.now().astimezone().isoformat(),
    'person_fullscan_samples':res['sample_count'],'brightness_mean':res['brightness_mean']})
   items['new:'+name]=d
   reviewed=[{'clip_no':e.get('clip_no'),'clip':name,'status':res['status'],'reason':res['reason'],
              'road_vehicle':res['road_vehicle_peak'],'truck':res['truck_peak'],'guard':res['guard_triggered']}]
  idx['model']=hy.MODEL_ID;idx['updated_at']=datetime.datetime.now().astimezone().isoformat();atomic(DET,idx)
  atomic(REPORT,{'at':datetime.datetime.now().astimezone().isoformat(),'policy':'hybrid-v125-classification-only',
                 'reviewed':reviewed,'deleted':[],'remaining_events':len(ev)})
  print(json.dumps({'ok':True,'reviewed':reviewed,'deleted':0}))
 return 0
if __name__=='__main__':raise SystemExit(main())
'''
LOCAL.write_text(local);LOCAL.chmod(0o755)

drive=r'''#!/home/jespern/c720p-home-hub/person-detector/venv/bin/python
import json,os,pathlib,subprocess,hashlib,datetime,time,fcntl
BASE=pathlib.Path('/home/jespern/c720p-home-hub');LOCK=BASE/'state/drive-security-archive.lock'
CFG=BASE/'config/drive-security-archive.json';IDX=BASE/'state/drive-security-archive.json';REPORT=BASE/'state/drive-person-revalidate-last.json'
from importlib.machinery import SourceFileLoader
hy=SourceFileLoader('c720p_person_hybrid_v125',str(BASE/'bin/c720p-person-hybrid-v125.py')).load_module()
def load(p,d):
 try:return json.loads(pathlib.Path(p).read_text())
 except:return d
def atomic(p,o):
 p=pathlib.Path(p);q=p.with_suffix(p.suffix+'.tmp-v125-'+str(os.getpid()));q.write_text(json.dumps(o,indent=2)+'\n');os.replace(q,p)
def night_ts(v):
 s=str(v or '')
 try:h=int(s[11:13]);return h>=20 or h<7
 except:return False
def main():
 cfg=load(CFG,{});idx=load(IDX,{'items':[]});rows=[]
 for x in idx.get('items',[]):
  if x.get('camera')!='new' or x.get('state')!='verified' or not x.get('remote_name'):continue
  if x.get('person_review_model')==hy.MODEL_ID:continue
  st=str(x.get('person_status') or 'unknown')
  try:vc=float(x.get('car_confidence') or 0)
  except:vc=0
  if st=='confirmed_person' and night_ts(x.get('timestamp')) and vc>=.30:rank=0
  elif st in ('unknown','unreviewed',''):rank=1
  elif st in ('likely_person','uncertain','no_person_sampled','confirmed_no_person'):rank=2
  else:rank=3
  rows.append((rank,str(x.get('timestamp') or ''),x))
 if not rows:
  atomic(REPORT,{'at':datetime.datetime.now().astimezone().isoformat(),'model':hy.MODEL_ID,'reviewed':[],'remaining':0});print('DRIVE_PERSON_V125 nothing_to_review');return 0
 rows.sort(key=lambda z:(z[0],z[1]))
 x=rows[0][2];name=pathlib.Path(str(x.get('remote_name'))).name
 tmpbase=pathlib.Path('/dev/shm') if pathlib.Path('/dev/shm').is_dir() else BASE/'drive-playback-cache'
 tmp=tmpbase/('person-v125-'+hashlib.sha1(name.encode()).hexdigest()[:16]+'.mp4')
 try:
  if tmp.exists():tmp.unlink()
 except:pass
 cmd=[cfg['rclone'],'--config',cfg['rclone_config'],'copyto',cfg['remote']+':'+name,str(tmp),
      '--drive-root-folder-id',str(cfg['folders']['new']['id']),'--retries','2','--low-level-retries','3']
 r=subprocess.run(cmd,text=True,capture_output=True,timeout=240)
 if r.returncode or not tmp.is_file() or tmp.stat().st_size<10000:raise SystemExit('DRIVE_PERSON_V125_DOWNLOAD_FAILED:'+r.stderr[-500:])
 try:res=hy.HybridDetector().analyze_clip(tmp,'full')
 finally:
  try:tmp.unlink()
  except:pass
 with open(LOCK,'a+') as lk:
  fcntl.flock(lk,fcntl.LOCK_EX)
  latest=load(IDX,{'items':[]});target=next((z for z in latest.get('items',[]) if z.get('camera')=='new' and z.get('state')=='verified' and z.get('remote_name')==name),None)
  if target is None:raise SystemExit('DRIVE_PERSON_V125_ROW_MOVED')
  old=str(target.get('person_status') or 'unknown');guard=bool(res['guard_triggered'] and res['reason']=='night-vehicle-confusion-rejected')
  target.update({'person_review_model':hy.MODEL_ID,'person_reviewed_at':datetime.datetime.now().astimezone().isoformat(),
   'person_review_v125_status':res['status'],'person_review_v125_reason':res['reason'],
   'person_review_v125_confidence':res['person_confidence'],'person_review_v125_mobile_peak':res['mobile_peak'],
   'person_review_v125_yolo_peak':res['yolo_peak'],'person_review_v125_yolo_clean_peak':res['yolo_clean_person_peak'],
   'person_review_v125_road_vehicle_peak':res['road_vehicle_peak'],'person_review_v125_truck_peak':res['truck_peak'],
   'person_review_v125_vehicle_conflict_frames':res['vehicle_conflict_frames'],'night_vehicle_guard_triggered':res['guard_triggered']})
  if old=='confirmed_person' and guard:
   # Correct the label but fail safe on retention: the clip stays protected until
   # enough evidence or a human review resolves the ambiguity.
   target['person_status']='uncertain';target['person_status_reason']=res['reason'];target['person_confidence']=res['person_confidence']
   target['night_vehicle_guard_protected']=True;target['night_vehicle_guard_at']=datetime.datetime.now().astimezone().isoformat()
  elif old!='confirmed_person' or res['status']=='confirmed_person':
   target['person_status']=res['status'];target['person_status_reason']=res['reason'];target['person_confidence']=res['person_confidence']
   if res['status']=='confirmed_person':target['night_vehicle_guard_protected']=False
  else:
   target['person_review_v125_disagreement']=True
  atomic(IDX,latest)
 remaining=max(0,len(rows)-1)
 atomic(REPORT,{'at':datetime.datetime.now().astimezone().isoformat(),'model':hy.MODEL_ID,
  'reviewed':[{'remote_name':name,'old_status':old,'hybrid_status':res['status'],'reason':res['reason'],
               'road_vehicle':res['road_vehicle_peak'],'truck':res['truck_peak'],'guard':res['guard_triggered']}],
  'remaining':remaining,'deleted':[]})
 print(json.dumps({'ok':True,'remote_name':name,'old_status':old,'hybrid_status':res['status'],
                   'reason':res['reason'],'road_vehicle':res['road_vehicle_peak'],'truck':res['truck_peak'],
                   'guard':res['guard_triggered'],'remaining':remaining}))
 return 0
if __name__=='__main__':raise SystemExit(main())
'''
DRIVE.write_text(drive);DRIVE.chmod(0o755)

for p in (HYBRID,DETECT,LOCAL,DRIVE):
    r=subprocess.run([str(VENV),"-m","py_compile",str(p)],text=True,capture_output=True)
    if r.returncode:raise SystemExit("COMPILE_FAILED "+str(p)+":"+r.stderr[-1200:])

# Retention safeguard for legacy clips downgraded only because the new vehicle guard
# found an ambiguous night-time car/truck pattern.
if RET.exists():
    s=RET.read_text()
    if "night_vehicle_guard_protected" not in s:
        old='    if st=="confirmed_person":\n        protected["confirmed_person"]+=1;continue\n'
        new='    if bool(x.get("night_vehicle_guard_protected")):\n        protected.setdefault("night_vehicle_guard",0);protected["night_vehicle_guard"]+=1;continue\n'+old
        if old not in s:raise SystemExit("RETENTION_ANCHOR_MISSING")
        RET.write_text(s.replace(old,new,1))
        rr=subprocess.run(["python3","-m","py_compile",str(RET)],text=True,capture_output=True)
        if rr.returncode:raise SystemExit("RETENTION_COMPILE_FAILED:"+rr.stderr[-1200:])

# Shadow inference on the newest local clip before touching systemd.
root=Path("/opt/homeassistant/config/www/frontyard-security-new/clips")
clips=sorted(root.glob("*.mp4"),key=lambda p:p.stat().st_mtime,reverse=True)
if clips:
    code=f'''from importlib.machinery import SourceFileLoader\nimport json,time\nh=SourceFileLoader("h","{HYBRID}").load_module();t=time.time();r=h.HybridDetector().analyze_clip(r"{clips[0]}","quick");print(json.dumps({{"status":r["status"],"reason":r["reason"],"guard":r["guard_triggered"],"road":r["road_vehicle_peak"],"truck":r["truck_peak"],"seconds":round(time.time()-t,1)}}))'''
    sr=subprocess.run([str(VENV),"-c",code],text=True,capture_output=True,timeout=180)
    if sr.returncode:raise SystemExit("SHADOW_FAILED:"+sr.stderr[-1600:])
    shadow=json.loads(sr.stdout)
else:shadow={"status":"no_local_clip"}

def set_exec(p,target):
    s=p.read_text();cmd=("ExecStart=/usr/bin/flock -n -E 0 /run/user/1000/c720p-vision.lock "
                         +str(VENV)+" "+str(target))
    s,n=re.subn(r"^ExecStart=.*$",cmd,s,count=1,flags=re.M)
    if n!=1:raise SystemExit("EXECSTART_ANCHOR_MISSING:"+str(p))
    s=re.sub(r"^Environment=C720P_PERSON_MODEL=.*$","Environment=C720P_PERSON_MODEL=v125-night-vehicle",s,flags=re.M)
    p.write_text(s)

set_exec(DS,DETECT);set_exec(LS,LOCAL);set_exec(RS,DRIVE)
subprocess.run(["systemctl","--user","daemon-reload"],check=True,timeout=20)
for t in (DT,LT,RT):
    if t.exists():subprocess.run(["systemctl","--user","enable","--now",t.name],check=False,timeout=30)

# One bounded live quick pass verifies the actual service path.
run=subprocess.run(["systemctl","--user","start",DS.name],text=True,capture_output=True,timeout=240)
if run.returncode:raise SystemExit("LIVE_DETECT_FAILED:"+run.stderr[-1200:])

idx=json.loads((BASE/"state/person-detection-index.json").read_text())
rows=[v for k,v in idx.get("items",{}).items() if k.startswith("new:") and v.get("model")=="hybrid-mobilenetssd+yolov5n-night-vehicle-v125"]
rows.sort(key=lambda x:str(x.get("analyzed_at") or ""),reverse=True)
print(json.dumps({
 "ok":True,"version":"v125","backup":str(BACK),"shadow":shadow,
 "live_rows":len(rows),
 "latest":[{"clip_no":x.get("clip_no"),"timestamp":x.get("timestamp"),"status":x.get("person_status"),
            "reason":x.get("person_status_reason"),"person":x.get("person_confidence"),
            "road_vehicle":x.get("road_vehicle_confidence"),"truck":x.get("truck_confidence"),
            "guard":x.get("night_vehicle_guard_triggered")} for x in rows[:5]],
 "detector_exec":next((x for x in DS.read_text().splitlines() if x.startswith("ExecStart=")),""),
 "retention_guard":("night_vehicle_guard_protected" in RET.read_text()) if RET.exists() else False
},indent=2))
