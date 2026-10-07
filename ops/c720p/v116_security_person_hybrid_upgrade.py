#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
BIN=BASE/"bin"
MODEL_DIR=BASE/"person-detector/model"
VENV=BASE/"person-detector/venv/bin/python"
UNIT=HOME/".config/systemd/user"

HYBRID=BIN/"c720p-person-hybrid-v116.py"
DETECT=BIN/"c720p-person-highlight-detect-v116.py"
LOCAL_REVIEW=BIN/"c720p-person-no-person-clean-v116.py"
DRIVE_REVIEW=BIN/"c720p-drive-person-revalidate-v116.py"
YOLO=MODEL_DIR/"yolov5n-v7.0.onnx"

DETECT_SU=UNIT/"c720p-person-highlight-detect.service"
DETECT_TU=UNIT/"c720p-person-highlight-detect.timer"
LOCAL_SU=UNIT/"c720p-person-no-person-clean.service"
LOCAL_TU=UNIT/"c720p-person-no-person-clean.timer"
DRIVE_SU=UNIT/"c720p-drive-person-revalidate.service"
DRIVE_TU=UNIT/"c720p-drive-person-revalidate.timer"

YOLO_URL="https://github.com/ultralytics/yolov5/releases/download/v7.0/yolov5n.onnx"
YOLO_SHA256="04f0e55c26f58d17145b36045780fe1250d5bd2187543e11568e5141d05b3262"

STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"person-hybrid-v116-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)

def backup(p):
    p=Path(p)
    if p.exists():
        shutil.copy2(p,BACK/(p.name+".before"))

for p in (
    BIN/"c720p-person-highlight-detect.py",
    BIN/"c720p-person-no-person-clean.py",
    BIN/"c720p-drive-person-revalidate.py",
    DETECT_SU,DETECT_TU,LOCAL_SU,LOCAL_TU,DRIVE_SU,DRIVE_TU,
):
    backup(p)

MODEL_DIR.mkdir(parents=True,exist_ok=True)
if not YOLO.exists() or hashlib.sha256(YOLO.read_bytes()).hexdigest()!=YOLO_SHA256:
    tmp=YOLO.with_suffix(".download")
    if tmp.exists():tmp.unlink()
    req=urllib.request.Request(YOLO_URL,headers={"User-Agent":"c720p-person-v116"})
    with urllib.request.urlopen(req,timeout=120) as r, tmp.open("wb") as f:
        shutil.copyfileobj(r,f,length=1024*1024)
    got=hashlib.sha256(tmp.read_bytes()).hexdigest()
    if got!=YOLO_SHA256:
        tmp.unlink(missing_ok=True)
        raise SystemExit("YOLO_SHA256_MISMATCH:"+got)
    os.replace(tmp,YOLO)

hybrid=r'''#!/home/jespern/c720p-home-hub/person-detector/venv/bin/python
from __future__ import annotations
import cv2, numpy as np, pathlib, math

cv2.setNumThreads(1)

BASE=pathlib.Path("/home/jespern/c720p-home-hub")
MOBILE_MODEL=BASE/"person-detector/model/mobilenet_iter_73000.caffemodel"
MOBILE_PROTO=BASE/"person-detector/model/deploy.prototxt"
YOLO_MODEL=BASE/"person-detector/model/yolov5n-v7.0.onnx"

MODEL_ID="hybrid-mobilenetssd+yolov5n-v116"
MOBILE_PERSON=15
MOBILE_VEHICLE={2,6,7,14}
M_RAW=.15
M_LIKELY=.35
M_STRONG=.55
Y_RAW=.10
Y_LIKELY=.22
Y_STRONG=.40
QUICK_FRACTIONS=(.04,.12,.20,.28,.36,.44,.52,.60,.68,.76,.84,.92)

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
        h,w=frame.shape[:2]
        scale=min(size/max(1,w),size/max(1,h))
        nw=max(1,int(round(w*scale)));nh=max(1,int(round(h*scale)))
        r=cv2.resize(frame,(nw,nh),interpolation=cv2.INTER_LINEAR)
        c=np.full((size,size,3),114,dtype=np.uint8)
        x=(size-nw)//2;y=(size-nh)//2
        c[y:y+nh,x:x+nw]=r
        return c

    def yolo_frame(self,frame):
        inp=self._letterbox(frame,640)
        blob=cv2.dnn.blobFromImage(inp,1.0/255.0,(640,640),swapRB=True,crop=False)
        self.yolo.setInput(blob);out=self.yolo.forward()
        rows=out[0] if out.ndim==3 else out
        if rows is None or len(rows)==0:return 0.0
        # YOLOv5 COCO output: x,y,w,h,objectness,80 class probabilities.
        conf=rows[:,4]*rows[:,5]
        return float(conf.max()) if conf.size else 0.0

    @staticmethod
    def _small_gray(frame):
        g=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY)
        return cv2.resize(g,(160,90),interpolation=cv2.INTER_AREA)

    @staticmethod
    def _lowlight(frame):
        lab=cv2.cvtColor(frame,cv2.COLOR_BGR2LAB)
        l,a,b=cv2.split(lab)
        clahe=cv2.createCLAHE(clipLimit=2.0,tileGridSize=(8,8))
        l=clahe.apply(l)
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
        wanted=4 if mode=="quick" else 6
        picked=[]
        def add(i):
            if i not in picked:picked.append(i)
        add(max(range(len(rows)),key=lambda i:rows[i]["mobile_person"]))
        for i in sorted(range(len(rows)),key=lambda i:rows[i]["motion"],reverse=True):
            if len(picked)>=wanted:break
            # Prefer temporal diversity when enough candidates exist.
            if all(abs(i-j)>=2 for j in picked) or len(picked)<2:add(i)
        add(len(rows)//2)
        for i in sorted(range(len(rows)),key=lambda i:rows[i]["motion"],reverse=True):
            if len(picked)>=wanted:break
            add(i)
        return picked[:wanted]

    def analyze_clip(self,path,mode="quick"):
        path=pathlib.Path(path)
        cap=cv2.VideoCapture(str(path))
        frames=int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        fps=float(cap.get(cv2.CAP_PROP_FPS) or 0)
        positions=self._positions(frames,fps,mode)
        rows=[];prev=None;vehicle_peak=0.0
        for pos in positions:
            cap.set(cv2.CAP_PROP_POS_FRAMES,pos);ok,frame=cap.read()
            if not ok or frame is None:continue
            mp,mv=self.mobile_frame(frame);vehicle_peak=max(vehicle_peak,mv)
            small=self._small_gray(frame)
            motion=float(cv2.mean(cv2.absdiff(small,prev))[0]/255.0) if prev is not None else 0.0
            prev=small
            brightness=float(cv2.mean(small)[0])
            rows.append({"pos":pos,"mobile_person":float(mp),"motion":motion,"brightness":brightness})
        cap.release()

        selected=self._choose_yolo(rows,mode)
        yolo_scores={}
        cap=cv2.VideoCapture(str(path))
        for i in selected:
            pos=rows[i]["pos"];cap.set(cv2.CAP_PROP_POS_FRAMES,pos);ok,frame=cap.read()
            if not ok or frame is None:continue
            ys=self.yolo_frame(frame)
            yolo_scores[i]=ys
        # One selective low-light second look, only when evidence is otherwise weak.
        if selected and yolo_scores:
            best_y=max(yolo_scores.values(),default=0.0)
            dark=[i for i in selected if rows[i]["brightness"]<55.0]
            if dark and best_y<Y_LIKELY and max((r["mobile_person"] for r in rows),default=0.0)>=M_RAW:
                i=max(dark,key=lambda j:(rows[j]["mobile_person"],rows[j]["motion"]))
                cap.set(cv2.CAP_PROP_POS_FRAMES,rows[i]["pos"]);ok,frame=cap.read()
                if ok and frame is not None:
                    yolo_scores[i]=max(yolo_scores.get(i,0.0),self.yolo_frame(self._lowlight(frame)))
        cap.release()

        ms=[r["mobile_person"] for r in rows]
        ys=list(yolo_scores.values())
        mweak=sum(x>=M_RAW for x in ms);mlikely=sum(x>=M_LIKELY for x in ms);mstrong=sum(x>=M_STRONG for x in ms)
        yweak=sum(x>=Y_RAW for x in ys);ylikely=sum(x>=Y_LIKELY for x in ys);ystrong=sum(x>=Y_STRONG for x in ys)
        mobile_confirm=(mstrong>=2 or mlikely>=3)
        yolo_confirm=(ystrong>=2 or (ystrong>=1 and ylikely>=2))
        cross_confirm=(mobile_confirm and ylikely>=1)

        if yolo_confirm or cross_confirm:
            status="confirmed_person";reason="hybrid-multiframe-person"
        elif ylikely>=1:
            status="likely_person";reason="yolov5n-person-support"
        elif mlikely>=1 and yweak>=1:
            status="likely_person";reason="cross-model-limited-person-evidence"
        elif mode=="full" and len(rows)>=12 and mweak==0 and len(ys)>=4 and yweak==0:
            status="confirmed_no_person";reason="hybrid-fullscan-zero-person"
        elif mweak==0 and yweak==0:
            status="no_person_sampled";reason="hybrid-sample-zero-person"
        else:
            status="uncertain";reason="single-model-or-weak-person-evidence"

        fused=[]
        for i,r in enumerate(rows):
            fused.append(round(max(r["mobile_person"],yolo_scores.get(i,0.0)),4))
        return {
            "model":MODEL_ID,
            "mode":mode,
            "status":status,
            "reason":reason,
            "person_confidence":round(max(max(ms,default=0.0),max(ys,default=0.0)),4),
            "mobile_peak":round(max(ms,default=0.0),4),
            "yolo_peak":round(max(ys,default=0.0),4),
            "vehicle_confidence":round(vehicle_peak,4),
            "sample_count":len(rows),
            "yolo_sample_count":len(ys),
            "person_frame_scores":fused,
            "mobile_frame_scores":[round(x,4) for x in ms],
            "yolo_frame_scores":[round(yolo_scores.get(i,0.0),4) if i in yolo_scores else None for i in range(len(rows))],
            "mobile_weak_frames":mweak,
            "mobile_likely_frames":mlikely,
            "mobile_strong_frames":mstrong,
            "yolo_weak_frames":yweak,
            "yolo_likely_frames":ylikely,
            "yolo_strong_frames":ystrong,
            "selected_yolo_indices":selected,
            "brightness_mean":round(sum(r["brightness"] for r in rows)/len(rows),1) if rows else None,
            "fps":round(fps,3),
            "frames":frames,
        }
'''
HYBRID.write_text(hybrid);HYBRID.chmod(0o755)

detect=r'''#!/home/jespern/c720p-home-hub/person-detector/venv/bin/python
import json,os,pathlib,subprocess,time,datetime,sys
BASE=pathlib.Path('/home/jespern/c720p-home-hub')
ROOTS={'new':pathlib.Path('/opt/homeassistant/config/www/frontyard-security-new'),'s3':pathlib.Path('/opt/homeassistant/config/www/frontyard-security')}
IDX=BASE/'state/person-detection-index.json';CANDS=BASE/'state/motion-highlight-candidates.json';SELECT=BASE/'bin/c720p-motion-highlight-select.py'
LOG=BASE/'logs/person-highlight-detect.log';MAX_PER_RUN=4
sys.path.insert(0,str(BASE/'bin'))
from importlib.machinery import SourceFileLoader
hy=SourceFileLoader('c720p_person_hybrid_v116',str(BASE/'bin/c720p-person-hybrid-v116.py')).load_module()
MODEL_ID=hy.MODEL_ID

def log(s):
 line=time.strftime('%Y-%m-%d %H:%M:%S')+' '+s;print(line,flush=True);LOG.parent.mkdir(parents=True,exist_ok=True);open(LOG,'a').write(line+'\n')
def load(p,d):
 try:return json.loads(pathlib.Path(p).read_text())
 except:return d
def atomic(p,o):
 p=pathlib.Path(p);p.parent.mkdir(parents=True,exist_ok=True);q=p.with_suffix(p.suffix+'.tmp-v116');q.write_text(json.dumps(o,indent=2)+'\n');os.replace(q,p)

def main():
 r=subprocess.run(['/usr/bin/python3',str(SELECT)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=20)
 if r.returncode:log('DETECT_V116=SELECTOR_FAILED');return 2
 c=load(CANDS,{});rows=list(c.get('candidates') or [])
 seen={(str(x.get('camera') or ''),pathlib.Path(str(x.get('clip_name') or '')).name) for x in rows}
 for cam,root in ROOTS.items():
  ev=load(root/'events.json',[])
  if isinstance(ev,dict):ev=ev.get('events',[])
  for e in ev if isinstance(ev,list) else []:
   name=pathlib.Path(str(e.get('clip') or '')).name
   if not name or (cam,name) in seen or not (root/'clips'/name).is_file():continue
   rows.append({'camera':cam,'clip_name':name,'clip_no':e.get('clip_no'),'timestamp':e.get('timestamp'),'highlight_score':-1.0,'retention_only':True});seen.add((cam,name))
 idx=load(IDX,{'version':2,'model':MODEL_ID,'items':{}});items=idx.setdefault('items',{});todo=[]
 for x in rows:
  cam=x.get('camera');root=ROOTS.get(cam);name=pathlib.Path(str(x.get('clip_name') or '')).name
  if not root or not name:continue
  p=root/'clips'/name
  if not p.is_file():continue
  st=p.stat();key=f'{cam}:{name}';old=items.get(key,{})
  if old.get('model')==MODEL_ID and int(old.get('size') or -1)==st.st_size and int(old.get('mtime_ns') or -1)==st.st_mtime_ns:
   incoming=round(float(x.get('highlight_score') or 0),4);previous=float(old.get('highlight_score') if old.get('highlight_score') is not None else -1.0)
   old['highlight_score']=round(max(previous,incoming),4);old['clip_no']=x.get('clip_no');old['timestamp']=x.get('timestamp');old['retention_only']=bool(old.get('retention_only',True) and x.get('retention_only'));items[key]=old;continue
  todo.append((float(x.get('highlight_score') or 0),cam,name,p,x,st))
 todo.sort(reverse=True,key=lambda z:z[0]);detector=hy.HybridDetector();analyzed=0
 for hs,cam,name,p,x,st in todo[:MAX_PER_RUN]:
  try:
   res=detector.analyze_clip(p,'quick')
   items[f'{cam}:{name}']={
    'camera':cam,'clip_name':name,'clip_no':x.get('clip_no'),'timestamp':x.get('timestamp'),
    'person_confidence':res['person_confidence'],'person_confidence_mobile':res['mobile_peak'],'person_confidence_yolo':res['yolo_peak'],
    'car_confidence':res['vehicle_confidence'],'highlight_score':round(hs,4),'sample_count':res['sample_count'],
    'person_frame_scores':res['person_frame_scores'],'person_mobile_frame_scores':res['mobile_frame_scores'],'person_yolo_frame_scores':res['yolo_frame_scores'],
    'person_weak_frames':res['mobile_weak_frames']+res['yolo_weak_frames'],
    'person_likely_frames':res['mobile_likely_frames']+res['yolo_likely_frames'],
    'person_strong_frames':res['mobile_strong_frames']+res['yolo_strong_frames'],
    'person_mobile_weak_frames':res['mobile_weak_frames'],'person_mobile_likely_frames':res['mobile_likely_frames'],'person_mobile_strong_frames':res['mobile_strong_frames'],
    'person_yolo_weak_frames':res['yolo_weak_frames'],'person_yolo_likely_frames':res['yolo_likely_frames'],'person_yolo_strong_frames':res['yolo_strong_frames'],
    'person_status':res['status'],'person_status_reason':res['reason'],'person_yolo_samples':res['yolo_sample_count'],
    'brightness_mean':res['brightness_mean'],'fps':res['fps'],'frames':res['frames'],
    'size':st.st_size,'mtime_ns':st.st_mtime_ns,'model':MODEL_ID,'retention_only':bool(x.get('retention_only')),
    'analyzed_at':datetime.datetime.now().astimezone().isoformat()
   }
   analyzed+=1;log(f"DETECT_V116 camera={cam} clip={name} status={res['status']} m={res['mobile_peak']:.3f} y={res['yolo_peak']:.3f} yframes={res['yolo_sample_count']} highlight={hs:.3f}")
  except Exception as e:log(f'DETECT_V116_ERROR camera={cam} clip={name} error={type(e).__name__}:{str(e)[:180]}')
 idx['version']=2;idx['model']=MODEL_ID;idx['updated_at']=datetime.datetime.now().astimezone().isoformat();idx['items']=items;atomic(IDX,idx)
 positives=sum(1 for v in items.values() if v.get('model')==MODEL_ID and v.get('person_status')=='confirmed_person')
 log(f'DETECT_V116=PASS analyzed={analyzed} indexed={len(items)} hybrid_confirmed={positives}');return 0
if __name__=='__main__':raise SystemExit(main())
'''
DETECT.write_text(detect);DETECT.chmod(0o755)

local_review=r'''#!/home/jespern/c720p-home-hub/person-detector/venv/bin/python
import json,os,pathlib,datetime,sys,time
BASE=pathlib.Path('/home/jespern/c720p-home-hub');ROOT=pathlib.Path('/opt/homeassistant/config/www/frontyard-security-new')
DET=BASE/'state/person-detection-index.json';REPORT=BASE/'state/person-no-person-clean-last.json'
from importlib.machinery import SourceFileLoader
hy=SourceFileLoader('c720p_person_hybrid_v116',str(BASE/'bin/c720p-person-hybrid-v116.py')).load_module()
def atomic(p,o):
 p=pathlib.Path(p);q=p.with_suffix(p.suffix+'.tmp-v116');q.write_text(json.dumps(o,indent=2)+'\n');os.replace(q,p)
def main():
 try:ev=json.loads((ROOT/'events.json').read_text())
 except:ev=[]
 if isinstance(ev,dict):ev=ev.get('events',[])
 try:idx=json.loads(DET.read_text())
 except:idx={'items':{}}
 items=idx.setdefault('items',{});candidates=[]
 for e in ev if isinstance(ev,list) else []:
  name=pathlib.Path(str(e.get('clip') or '')).name;cp=ROOT/'clips'/name
  if not name or not cp.is_file():continue
  d=items.get('new:'+name,{})
  if d.get('model')!=hy.MODEL_ID or str(d.get('person_status') or '') in ('no_person_sampled','uncertain','unknown',''):
   candidates.append((str(e.get('timestamp') or ''),e,name,cp,d))
 candidates.sort(reverse=True,key=lambda x:x[0])
 reviewed=[]
 if candidates:
  _,e,name,cp,d=candidates[0]
  res=hy.HybridDetector().analyze_clip(cp,'full')
  d.update({
   'model':hy.MODEL_ID,'person_status':res['status'],'person_status_reason':res['reason'],
   'person_confidence':res['person_confidence'],'person_confidence_mobile':res['mobile_peak'],'person_confidence_yolo':res['yolo_peak'],
   'person_fullscan_at':datetime.datetime.now().astimezone().isoformat(),'person_fullscan_samples':res['sample_count'],
   'person_yolo_samples':res['yolo_sample_count'],'person_mobile_weak_frames':res['mobile_weak_frames'],
   'person_mobile_likely_frames':res['mobile_likely_frames'],'person_mobile_strong_frames':res['mobile_strong_frames'],
   'person_yolo_weak_frames':res['yolo_weak_frames'],'person_yolo_likely_frames':res['yolo_likely_frames'],'person_yolo_strong_frames':res['yolo_strong_frames'],
   'person_frame_scores':res['person_frame_scores'],'brightness_mean':res['brightness_mean']
  });items['new:'+name]=d
  reviewed=[{'clip_no':e.get('clip_no'),'clip':name,'status':res['status'],'mobile':res['mobile_peak'],'yolo':res['yolo_peak'],'samples':res['sample_count']}]
 idx['model']=hy.MODEL_ID;idx['updated_at']=datetime.datetime.now().astimezone().isoformat();atomic(DET,idx)
 # V116 is classification-only. Storage deletion remains centralized in the
 # retention policy, so one classifier cannot destroy evidence by itself.
 atomic(REPORT,{'at':datetime.datetime.now().astimezone().isoformat(),'policy':'hybrid-v116-classification-only','reviewed':reviewed,'deleted':[],'remaining_events':len(ev)})
 print('PERSON_HYBRID_LOCAL_V116 reviewed='+str(len(reviewed))+' deleted=0')
 return 0
if __name__=='__main__':raise SystemExit(main())
'''
LOCAL_REVIEW.write_text(local_review);LOCAL_REVIEW.chmod(0o755)

drive_review=r'''#!/home/jespern/c720p-home-hub/person-detector/venv/bin/python
import json,os,pathlib,subprocess,hashlib,datetime,time,fcntl,sys,shutil
BASE=pathlib.Path('/home/jespern/c720p-home-hub');ARCHIVE_LOCK=BASE/'state/drive-security-archive.lock'
CFG=BASE/'config/drive-security-archive.json';IDX=BASE/'state/drive-security-archive.json';REPORT=BASE/'state/drive-person-revalidate-last.json'
from importlib.machinery import SourceFileLoader
hy=SourceFileLoader('c720p_person_hybrid_v116',str(BASE/'bin/c720p-person-hybrid-v116.py')).load_module()
def load(p,d):
 try:return json.loads(pathlib.Path(p).read_text())
 except:return d
def atomic(p,o):
 p=pathlib.Path(p);q=p.with_suffix(p.suffix+'.tmp-v116');q.write_text(json.dumps(o,indent=2)+'\n');os.replace(q,p)
def main():
 cfg=load(CFG,{});idx=load(IDX,{'items':[]});rows=[]
 for x in idx.get('items',[]):
  if x.get('camera')!='new' or x.get('state')!='verified' or not x.get('remote_name'):continue
  if x.get('person_review_model')==hy.MODEL_ID:continue
  st=str(x.get('person_status') or 'unknown')
  rank=0 if st in ('unknown','unreviewed','') else 1 if st in ('likely_person','uncertain','no_person_sampled','confirmed_no_person') else 2
  rows.append((rank,str(x.get('timestamp') or ''),x))
 if not rows:
  atomic(REPORT,{'at':datetime.datetime.now().astimezone().isoformat(),'model':hy.MODEL_ID,'reviewed':[],'remaining':0});print('DRIVE_PERSON_V116 nothing_to_review');return 0
 rows.sort(key=lambda z:(z[0],-int(''.join(ch for ch in z[1] if ch.isdigit())[:14] or 0)))
 x=rows[0][2];name=pathlib.Path(str(x.get('remote_name'))).name
 tmpbase=pathlib.Path('/dev/shm') if pathlib.Path('/dev/shm').is_dir() else BASE/'drive-playback-cache'
 tmp=tmpbase/('person-v116-'+hashlib.sha1(name.encode()).hexdigest()[:16]+'.mp4')
 try:
  if tmp.exists():tmp.unlink()
 except:pass
 cmd=[cfg['rclone'],'--config',cfg['rclone_config'],'copyto',cfg['remote']+':'+name,str(tmp),'--drive-root-folder-id',str(cfg['folders']['new']['id']),'--retries','2','--low-level-retries','3']
 r=subprocess.run(cmd,text=True,capture_output=True,timeout=240)
 if r.returncode or not tmp.is_file() or tmp.stat().st_size<10000:raise SystemExit('DRIVE_PERSON_V116_DOWNLOAD_FAILED:'+r.stderr[-500:])
 try:res=hy.HybridDetector().analyze_clip(tmp,'full')
 finally:
  try:tmp.unlink()
  except:pass
 with open(ARCHIVE_LOCK,'a+') as lk:
  fcntl.flock(lk,fcntl.LOCK_EX)
  latest=load(IDX,{'items':[]});target=next((z for z in latest.get('items',[]) if z.get('camera')=='new' and z.get('state')=='verified' and z.get('remote_name')==name),None)
  if target is None:raise SystemExit('DRIVE_PERSON_V116_ROW_MOVED')
  old=str(target.get('person_status') or 'unknown')
  target.update({
   'person_review_model':hy.MODEL_ID,'person_reviewed_at':datetime.datetime.now().astimezone().isoformat(),
   'person_review_v116_status':res['status'],'person_review_v116_reason':res['reason'],
   'person_review_v116_confidence':res['person_confidence'],'person_review_v116_mobile_peak':res['mobile_peak'],'person_review_v116_yolo_peak':res['yolo_peak'],
   'person_review_v116_samples':res['sample_count'],'person_review_v116_yolo_samples':res['yolo_sample_count']
  })
  # Preserve older confirmed-person footage until the hybrid model has accumulated
  # enough reviewed history. A v116 person finding may promote safety immediately.
  if old!='confirmed_person' or res['status']=='confirmed_person':
   target['person_status']=res['status'];target['person_status_reason']=res['reason'];target['person_confidence']=res['person_confidence']
  else:
   target['person_review_v116_disagreement']=True
  atomic(IDX,latest)
  fcntl.flock(lk,fcntl.LOCK_UN)
 remaining=max(0,len(rows)-1)
 atomic(REPORT,{'at':datetime.datetime.now().astimezone().isoformat(),'model':hy.MODEL_ID,'reviewed':[{'remote_name':name,'old_status':old,'hybrid_status':res['status'],'mobile':res['mobile_peak'],'yolo':res['yolo_peak']}],'remaining':remaining,'deleted':[]})
 print(json.dumps({'ok':True,'remote_name':name,'old_status':old,'hybrid_status':res['status'],'mobile':res['mobile_peak'],'yolo':res['yolo_peak'],'remaining':remaining}))
 return 0
if __name__=='__main__':raise SystemExit(main())
'''
DRIVE_REVIEW.write_text(drive_review);DRIVE_REVIEW.chmod(0o755)

for p in (HYBRID,DETECT,LOCAL_REVIEW,DRIVE_REVIEW):
    r=subprocess.run([str(VENV),"-m","py_compile",str(p)],text=True,capture_output=True)
    if r.returncode:raise SystemExit(f"COMPILE_FAILED {p}: {r.stderr[-1200:]}")

# Shadow test the new ensemble on three newest local clips before switching services.
sys.path.insert(0,str(BIN))
from importlib.machinery import SourceFileLoader
hy=SourceFileLoader('c720p_person_hybrid_v116_shadow',str(HYBRID)).load_module()
root=Path("/opt/homeassistant/config/www/frontyard-security-new")
clips=sorted((root/"clips").glob("*.mp4"),key=lambda p:p.stat().st_mtime,reverse=True)[:3]
shadow=[]
detector=hy.HybridDetector()
for p in clips:
    st=time.time();res=detector.analyze_clip(p,"quick")
    shadow.append({"clip":p.name,"status":res["status"],"mobile":res["mobile_peak"],"yolo":res["yolo_peak"],"seconds":round(time.time()-st,1)})
if clips and not shadow:raise SystemExit("V116_SHADOW_FAILED")

# Switch the live units only after model load, compile and inference all succeeded.
def replace_exec(p,cmd):
    s=p.read_text()
    s,n=re.subn(r"^ExecStart=.*$",cmd,s,count=1,flags=re.M)
    if n!=1:raise SystemExit("EXECSTART_ANCHOR_MISSING:"+str(p))
    p.write_text(s)

replace_exec(DETECT_SU,
    "ExecStart=/usr/bin/flock -n -E 0 /run/user/1000/c720p-vision.lock "
    "/home/jespern/c720p-home-hub/person-detector/venv/bin/python "
    "/home/jespern/c720p-home-hub/bin/c720p-person-highlight-detect-v116.py")
replace_exec(LOCAL_SU,
    "ExecStart=/usr/bin/flock -n -E 0 /run/user/1000/c720p-vision.lock "
    "/home/jespern/c720p-home-hub/person-detector/venv/bin/python "
    "/home/jespern/c720p-home-hub/bin/c720p-person-no-person-clean-v116.py")
replace_exec(DRIVE_SU,
    "ExecStart=/usr/bin/flock -n -E 0 /run/user/1000/c720p-vision.lock "
    "/home/jespern/c720p-home-hub/person-detector/venv/bin/python "
    "/home/jespern/c720p-home-hub/bin/c720p-drive-person-revalidate-v116.py")

# Descriptions make the new safety model visible in systemd diagnostics.
for p,old,new in (
    (DETECT_SU,"Description=C720P","Description=C720P"),
):
    pass
for p in (DETECT_SU,LOCAL_SU,DRIVE_SU):
    s=p.read_text()
    if "Environment=C720P_PERSON_MODEL=v116-hybrid" not in s:
        s=s.replace("[Service]\n","[Service]\nEnvironment=C720P_PERSON_MODEL=v116-hybrid\n",1)
    p.write_text(s)

subprocess.run(["systemctl","--user","daemon-reload"],check=True,timeout=20)
for t in (DETECT_TU,LOCAL_TU,DRIVE_TU):
    if t.exists():subprocess.run(["systemctl","--user","enable","--now",t.name],check=False,timeout=30)

# Run one foreground quick pass. It is bounded to four clips.
run=subprocess.run(["systemctl","--user","start",DETECT_SU.name],text=True,capture_output=True,timeout=180)
if run.returncode:raise SystemExit("V116_LIVE_DETECT_FAILED:"+run.stderr[-1000:])

idx=json.loads((BASE/"state/person-detection-index.json").read_text())
newrows=[v for k,v in idx.get("items",{}).items() if k.startswith("new:") and v.get("model")==hy.MODEL_ID]
newrows.sort(key=lambda x:str(x.get("timestamp") or ""),reverse=True)

print(json.dumps({
    "ok":True,
    "version":"v116",
    "backup":str(BACK),
    "model":str(YOLO),
    "model_sha256":hashlib.sha256(YOLO.read_bytes()).hexdigest(),
    "shadow":shadow,
    "live_hybrid_rows":len(newrows),
    "live_hybrid_latest":[{
        "clip_no":x.get("clip_no"),"timestamp":x.get("timestamp"),"status":x.get("person_status"),
        "mobile":x.get("person_confidence_mobile"),"yolo":x.get("person_confidence_yolo"),
        "reason":x.get("person_status_reason")
    } for x in newrows[:8]],
    "detector_timer":subprocess.run(["systemctl","--user","is-active",DETECT_TU.name],text=True,capture_output=True).stdout.strip() if DETECT_TU.exists() else "missing",
    "local_review_timer":subprocess.run(["systemctl","--user","is-active",LOCAL_TU.name],text=True,capture_output=True).stdout.strip() if LOCAL_TU.exists() else "missing",
    "drive_review_timer":subprocess.run(["systemctl","--user","is-active",DRIVE_TU.name],text=True,capture_output=True).stdout.strip() if DRIVE_TU.exists() else "missing",
    "direct_classifier_deletion":False
},indent=2))
