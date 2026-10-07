#!/usr/bin/env python3
from __future__ import annotations
import json, pathlib, urllib.request, urllib.parse, tempfile, hashlib, os, time, shutil, subprocess, math

import cv2
import numpy as np

HOME=pathlib.Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
WWW=pathlib.Path("/opt/homeassistant/config/www")
OUT=WWW/"c720p-saved-thumbs"
MAN=OUT/"manifest.json"
ARCH=BASE/"state/drive-security-archive.json"
API="http://127.0.0.1:8795/new/api/saved"
PLAY="http://127.0.0.1:8795/new/clip/"
PROTO=BASE/"person-detector/model/deploy.prototxt"
MODEL=BASE/"person-detector/model/mobilenet_iter_73000.caffemodel"
VERSION="v107"
OUT.mkdir(parents=True,exist_ok=True)

NET=cv2.dnn.readNetFromCaffe(str(PROTO),str(MODEL))
PERSON_CLASS=15
SAMPLE_FRACTIONS=(.06,.14,.22,.30,.38,.46,.54,.62,.70,.78,.86,.94)

def load(p,default):
    try:return json.loads(pathlib.Path(p).read_text())
    except Exception:return default

def atomic(p,obj):
    p=pathlib.Path(p)
    q=p.with_suffix(p.suffix+".tmp-v107")
    q.write_text(json.dumps(obj,indent=2,sort_keys=True)+"\n")
    os.replace(q,p)

def saved_rows():
    last=None
    for attempt in range(6):
        try:
            with urllib.request.urlopen(API+"?t="+str(time.time()),timeout=75) as r:
                d=json.loads(r.read().decode())
            return [x for x in d.get("events",[]) if isinstance(x,dict) and x.get("remote_name") and (not x.get("state") or x.get("state")=="verified")]
        except Exception as e:
            last=e
            time.sleep(min(10,2+attempt*2))
    raise last

def download_once(url,dst):
    req=urllib.request.Request(url,headers={"User-Agent":"C720P-Saved-Thumb-V107"})
    with urllib.request.urlopen(req,timeout=240) as r, open(dst,"wb") as f:
        shutil.copyfileobj(r,f,length=1024*1024)
    return dst.is_file() and dst.stat().st_size>10000

def frame_duration(cap,path):
    fps=float(cap.get(cv2.CAP_PROP_FPS) or 0)
    count=float(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if fps>0 and count>0:return count/fps
    try:
        r=subprocess.run(["ffprobe","-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",str(path)],text=True,capture_output=True,timeout=20)
        return float((r.stdout or "0").strip() or 0)
    except Exception:return 0.0

def person_detect(frame):
    h,w=frame.shape[:2]
    blob=cv2.dnn.blobFromImage(cv2.resize(frame,(300,300)),0.007843,(300,300),127.5)
    NET.setInput(blob)
    det=NET.forward()
    best=0.0; box=None
    for i in range(det.shape[2]):
        cls=int(det[0,0,i,1]); conf=float(det[0,0,i,2])
        if cls!=PERSON_CLASS or conf<=best:continue
        x1=max(0,min(w-1,int(det[0,0,i,3]*w)))
        y1=max(0,min(h-1,int(det[0,0,i,4]*h)))
        x2=max(x1+1,min(w,int(det[0,0,i,5]*w)))
        y2=max(y1+1,min(h,int(det[0,0,i,6]*h)))
        best=conf;box=(x1,y1,x2,y2)
    return best,box

def read_samples(path):
    cap=cv2.VideoCapture(str(path))
    if not cap.isOpened():return [],0.0
    dur=frame_duration(cap,path)
    if dur<=0:
        cap.release();return [],0.0
    rows=[]
    for frac in SAMPLE_FRACTIONS:
        t=max(.05,min(dur-.05,dur*frac))
        cap.set(cv2.CAP_PROP_POS_MSEC,t*1000.0)
        ok,frame=cap.read()
        if not ok or frame is None:continue
        # Detection is done on source frame; scoring on a small grayscale proxy.
        pc,box=person_detect(frame)
        proxy=cv2.resize(frame,(192,108),interpolation=cv2.INTER_AREA)
        gray=cv2.cvtColor(proxy,cv2.COLOR_BGR2GRAY)
        detail=float(cv2.Laplacian(gray,cv2.CV_64F).var())
        brightness=float(gray.mean())
        rows.append({"frac":frac,"time":t,"frame":frame,"gray":gray,"person":pc,"box":box,"detail_raw":detail,"brightness":brightness})
    cap.release()
    # Motion score is max difference to either temporal neighbor so entering/leaving
    # people and other prominent movement are not lost.
    for i,x in enumerate(rows):
        diffs=[]
        if i>0:diffs.append(float(cv2.absdiff(x["gray"],rows[i-1]["gray"]).mean())/255.0)
        if i+1<len(rows):diffs.append(float(cv2.absdiff(x["gray"],rows[i+1]["gray"]).mean())/255.0)
        x["motion"]=max(diffs or [0.0])
        x["detail"]=x["detail_raw"]/(x["detail_raw"]+250.0)
        # Extreme darkness/overexposure should not win merely because of noise.
        b=x["brightness"]
        x["visibility"]=max(0.0,1.0-abs(b-115.0)/125.0)
    return rows,dur

def representative_score(x,person_mode):
    if person_mode:
        # Person evidence dominates. Motion/detail break ties and keep a visually
        # informative frame when the detector is weaker than the archive review.
        return 3.2*x["person"] + .72*x["motion"] + .26*x["detail"] + .10*x["visibility"]
    return 1.15*x["motion"] + .42*x["detail"] + .14*x["visibility"] + .20*x["person"]

def choose_three(rows,status):
    person_mode=status in ("confirmed_person","likely_person")
    for x in rows:x["score"]=representative_score(x,person_mode)
    if not rows:return []
    primary=max(range(len(rows)),key=lambda i:rows[i]["score"])
    min_gap=max(1,len(rows)//5)
    left=[i for i in range(primary) if primary-i>=min_gap]
    right=[i for i in range(primary+1,len(rows)) if i-primary>=min_gap]
    li=max(left,key=lambda i:rows[i]["score"]) if left else max(0,primary-1)
    ri=max(right,key=lambda i:rows[i]["score"]) if right else min(len(rows)-1,primary+1)
    picks=[]
    for i in (li,primary,ri):
        if i not in picks:picks.append(i)
    # Edge-primary fallback: add highest-value distinct moments until 3.
    for i in sorted(range(len(rows)),key=lambda i:rows[i]["score"],reverse=True):
        if i not in picks and all(abs(i-j)>=1 for j in picks):
            picks.append(i)
        if len(picks)>=3:break
    while len(picks)<3:picks.append(picks[-1] if picks else 0)
    picks=sorted(picks[:3],key=lambda i:rows[i]["time"])
    # Preserve which panel is the actual primary after chronological sorting.
    primary_panel=picks.index(primary) if primary in picks else max(range(3),key=lambda k:rows[picks[k]]["score"])
    return picks,primary_panel

def cover_crop(frame,w,h,box=None):
    ih,iw=frame.shape[:2]
    if box:
        x1,y1,x2,y2=box
        fx=(x1+x2)/2.0;fy=(y1+y2)/2.0
    else:
        fx=iw/2.0;fy=ih/2.0
    scale=max(w/iw,h/ih)
    nw=max(w,int(round(iw*scale)));nh=max(h,int(round(ih*scale)))
    im=cv2.resize(frame,(nw,nh),interpolation=cv2.INTER_AREA if scale<1 else cv2.INTER_LINEAR)
    fx*=nw/iw;fy*=nh/ih
    x=int(round(fx-w/2));y=int(round(fy-h/2))
    x=max(0,min(nw-w,x));y=max(0,min(nh-h,y))
    return im[y:y+h,x:x+w].copy()

def compose(rows,picks,primary_panel,out,status):
    panels=[]
    meta=[]
    for k,i in enumerate(picks):
        r=rows[i]
        # A person-centered crop is used only when detector evidence exists.
        panel=cover_crop(r["frame"],320,210,r["box"] if r["person"]>=.18 else None)
        # Thin separator and subtle timestamp make adjacent moments readable
        # without covering the subject.
        if k>0:cv2.line(panel,(0,0),(0,209),(220,230,235),2)
        label=f'{int(r["time"]//60)}:{int(r["time"]%60):02d}'
        cv2.rectangle(panel,(6,181),(58,204),(0,0,0),-1)
        cv2.putText(panel,label,(11,198),cv2.FONT_HERSHEY_SIMPLEX,.44,(245,250,255),1,cv2.LINE_AA)
        if k==primary_panel and status in ("confirmed_person","likely_person"):
            # The center-of-attention panel gets a restrained evidence outline.
            cv2.rectangle(panel,(2,2),(317,207),(90,220,125),2)
        panels.append(panel)
        meta.append({"time":round(r["time"],2),"person":round(r["person"],4),"motion":round(r["motion"],4),"detail":round(r["detail"],4),"score":round(r["score"],4)})
    sheet=cv2.hconcat(panels)
    # 900x197 keeps the wide 3-panel strip useful inside the existing card.
    sheet=cv2.resize(sheet,(900,197),interpolation=cv2.INTER_AREA)
    ok=cv2.imwrite(str(out),sheet,[int(cv2.IMWRITE_JPEG_QUALITY),88])
    return bool(ok and out.is_file() and out.stat().st_size>6000),meta

def generate(e,out):
    name=pathlib.Path(str(e["remote_name"])).name
    url=PLAY+urllib.parse.quote(name)
    status=str(e.get("person_status") or "unknown")
    with tempfile.TemporaryDirectory(prefix="c720p-thumb-v107-") as td:
        local=pathlib.Path(td)/"clip.mp4"
        if not download_once(url,local):return False,{"error":"download"}
        rows,dur=read_samples(local)
        if len(rows)<3:return False,{"error":"samples","samples":len(rows)}
        picks,primary_panel=choose_three(rows,status)
        ok,meta=compose(rows,picks,primary_panel,out,status)
        if not ok:return False,{"error":"compose"}
        p=meta[primary_panel]
        method="person-model+motion" if status in ("confirmed_person","likely_person") else "motion+detail"
        return True,{
            "version":VERSION,"duration":round(dur,2),"person_status":status,
            "thumbnail_method":method,"primary_panel":primary_panel,
            "primary_time":p["time"],"primary_person_confidence":p["person"],
            "panels":meta,"sample_count":len(rows),
            "model":"MobileNetSSD+motion-v107"
        }

def save_manifest(items,failures):
    atomic(MAN,{"version":VERSION,"updated_at":time.time(),"items":items,"failures":failures[-40:]})

def main():
    rows=saved_rows()
    old=load(MAN,{"items":{},"failures":[]})
    items=old.get("items",{}) if isinstance(old,dict) and isinstance(old.get("items"),dict) else {}
    failures=old.get("failures",[]) if isinstance(old,dict) and isinstance(old.get("failures"),list) else []
    live={pathlib.Path(str(x["remote_name"])).name for x in rows}
    removed=0
    for n in list(items):
        if n not in live:
            p=OUT/pathlib.Path(str(items[n].get("file") or "")).name
            try:p.unlink(missing_ok=True)
            except:pass
            items.pop(n,None);removed+=1
    save_manifest(items,failures)

    # Confirmed people first; newest first inside each evidence class.
    priority=sorted(rows,key=lambda e:str(e.get("timestamp") or ""),reverse=True)
    priority.sort(key=lambda e:0 if str(e.get("person_status"))=="confirmed_person" else 1 if str(e.get("person_status"))=="likely_person" else 2)
    limit=max(1,int(os.environ.get("C720P_THUMB_LIMIT","10")))
    max_seconds=max(60,int(os.environ.get("C720P_THUMB_MAX_SECONDS","780")))
    started=time.monotonic();made=0;attempts=0
    for e in priority:
        if made>=limit or attempts>=limit*2 or time.monotonic()-started>=max_seconds:break
        n=pathlib.Path(str(e["remote_name"])).name
        key=hashlib.sha1(n.encode()).hexdigest()[:20]+".jpg"
        dst=OUT/key
        rec=items.get(n,{})
        if dst.is_file() and dst.stat().st_size>6000 and rec.get("version")==VERSION:
            continue
        attempts+=1
        try:
            ok,meta=generate(e,dst)
        except Exception as ex:
            ok=False;meta={"error":type(ex).__name__+":"+str(ex)[:180]}
        if ok:
            items[n]={"file":key,"url":"/local/c720p-saved-thumbs/"+key,"generated_at":time.time(),**meta}
            failures=[x for x in failures if x.get("name")!=n]
            made+=1
        else:
            failures.append({"name":n,"at":time.time(),**meta})
            try:
                if dst.exists() and dst.stat().st_size<6000:dst.unlink()
            except:pass
        # Critical UX/resilience change: publish progress after EACH clip.
        save_manifest(items,failures)
    print(json.dumps({"ok":True,"version":VERSION,"saved_events":len(rows),"manifest_items":len(items),"generated":made,"attempts":attempts,"stale_removed":removed,"failures":failures[-10:]},indent=2))

if __name__=="__main__":
    main()
