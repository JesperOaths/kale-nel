#!/usr/bin/env python3
from __future__ import annotations
import json, pathlib, subprocess, tempfile, urllib.request, urllib.parse, hashlib, os, time, re

HOME=pathlib.Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
WWW=pathlib.Path("/opt/homeassistant/config/www")
OUT=WWW/"c720p-saved-thumbs"
MAN=OUT/"manifest.json"
API="http://127.0.0.1:8795/new/api/saved"
PLAY="http://127.0.0.1:8795/new/clip/"
SNAPS=WWW/"frontyard-security-new"/"snapshots"
OUT.mkdir(parents=True,exist_ok=True)

def load(p,default):
    try:return json.loads(pathlib.Path(p).read_text())
    except:return default

def atomic(p,obj):
    q=p.with_suffix(p.suffix+".tmp-v106")
    q.write_text(json.dumps(obj,indent=2,sort_keys=True)+"\n")
    os.replace(q,p)

def api():
    with urllib.request.urlopen(API+"?t="+str(time.time()),timeout=60) as r:
        d=json.loads(r.read().decode())
    return [x for x in d.get("events",[]) if isinstance(x,dict) and x.get("remote_name") and (not x.get("state") or x.get("state")=="verified")]

def duration(url):
    r=subprocess.run(["ffprobe","-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",url],text=True,capture_output=True,timeout=45)
    try:return float(r.stdout.strip())
    except:return 0.0

def frame(url,t,dst):
    r=subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-ss",f"{max(0,t):.3f}","-i",url,"-frames:v","1","-vf","scale=360:-2", "-q:v","3","-y",str(dst)],text=True,capture_output=True,timeout=60)
    return r.returncode==0 and dst.is_file() and dst.stat().st_size>2000

def scene_candidates(url,tmp):
    patt=tmp/"scene-%03d.jpg"
    meta=tmp/"scene-meta.txt"
    filt=f"fps=1,select='gt(scene,0.018)',metadata=print:file={meta},scale=360:-2"
    r=subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-i",url,"-vf",filt,"-vsync","vfr","-frames:v","12","-q:v","3","-y",str(patt)],text=True,capture_output=True,timeout=120)
    files=sorted(tmp.glob("scene-*.jpg"))
    scores=[]
    if meta.exists():
        cur_t=None
        for line in meta.read_text(errors="ignore").splitlines():
            m=re.search(r"pts_time:([0-9.]+)",line)
            if m:cur_t=float(m.group(1))
            m=re.search(r"lavfi\.scene_score=([0-9.eE+-]+)",line)
            if m and cur_t is not None:scores.append((float(m.group(1)),cur_t))
    scores=sorted(scores,reverse=True)
    return [t for _,t in scores[:6]],files

def hstack(imgs,out):
    if len(imgs)<3:return False
    cmd=["ffmpeg","-hide_banner","-loglevel","error"]
    for p in imgs[:3]:cmd+=["-i",str(p)]
    # Three time-separated views make motion/person changes distinguishable.
    filt="[0:v]scale=320:200:force_original_aspect_ratio=increase,crop=320:200[a];[1:v]scale=320:200:force_original_aspect_ratio=increase,crop=320:200[b];[2:v]scale=320:200:force_original_aspect_ratio=increase,crop=320:200[c];[a][b][c]hstack=inputs=3,scale=720:200"
    cmd+=["-filter_complex",filt,"-frames:v","1","-q:v","3","-y",str(out)]
    r=subprocess.run(cmd,text=True,capture_output=True,timeout=45)
    return r.returncode==0 and out.is_file() and out.stat().st_size>4000

def detection_for(e):
    arch=load(ARCH,{"items":[]}); det=load(DET,{"items":{}})
    name=pathlib.Path(str(e.get("remote_name") or "")).name
    row=next((x for x in arch.get("items",[]) if x.get("camera")=="new" and pathlib.Path(str(x.get("remote_name") or "")).name==name),{})
    local=pathlib.Path(str(row.get("local_clip_name") or "")).name
    return (det.get("items") or {}).get("new:"+local,{}) if local else {}

def person_times(di,dur):
    scores=di.get("person_frame_scores")
    if not isinstance(scores,list):return []
    vals=[]
    for i,x in enumerate(scores[:len(SAMPLE_FRACTIONS)]):
        try:score=float(x)
        except:continue
        vals.append((score,dur*SAMPLE_FRACTIONS[i]))
    vals.sort(reverse=True)
    picked=[]
    for score,t in vals:
        if score<=0:continue
        if all(abs(t-p[1])>max(.6,dur*.10) for p in picked):
            picked.append((score,t))
        if len(picked)>=3:break
    return [t for _,t in picked]

def generate(e,out):
    name=pathlib.Path(str(e["remote_name"])).name
    url=PLAY+urllib.parse.quote(name)
    dur=duration(url)
    if dur<=0:return False,{"error":"duration"}
    status=str(e.get("person_status") or "")
    with tempfile.TemporaryDirectory(prefix="c720p-thumb-v106-") as td:
        t=pathlib.Path(td)
        scene_times,_=scene_candidates(url,t)
        # Person-positive clips use the detector's 12 sampled person scores.
        # Put the strongest person-evidence moment in the CENTER panel, with
        # scene-change/context frames before and after it when possible.
        di=detection_for(e)
        pt=person_times(di,dur) if status in ("confirmed_person","likely_person") else []
        best_person=pt[0] if pt else None
        base=[dur*.18,dur*.50,dur*.82] if status in ("confirmed_person","likely_person") else [dur*.22,dur*.50,dur*.78]
        if best_person is not None:
            left=next((x for x in sorted(scene_times+pt[1:]+base) if x<best_person-max(.4,dur*.06)),max(.05,best_person-dur*.18))
            right=next((x for x in sorted(scene_times+pt[1:]+base) if x>best_person+max(.4,dur*.06)),min(dur-.05,best_person+dur*.18))
            times=[left,best_person,right]
        else:
            times=[]
            for x in scene_times+base:
                x=max(.05,min(dur-.05,x))
                if all(abs(x-y)>max(.4,dur*.08) for y in times):times.append(x)
                if len(times)>=3:break
            while len(times)<3:times.append(base[len(times)])
            times=sorted(times[:3])
        imgs=[]
        for i,x in enumerate(times):
            dst=t/f"pick-{i}.jpg"
            if not frame(url,x,dst):
                return False,{"error":"frame","time":x}
            imgs.append(dst)
        if not hstack(imgs,out):return False,{"error":"stack"}
        return True,{"duration":round(dur,2),"times":[round(x,2) for x in times],"person_status":status,"person_score_guided":bool(best_person is not None),"best_person_time":round(best_person,2) if best_person is not None else None}

def main():
    rows=api()
    old=load(MAN,{"version":"v106","items":{}})
    items=old.get("items",{}) if isinstance(old,dict) else {}
    live={pathlib.Path(str(x["remote_name"])).name for x in rows}
    removed=0
    for n in list(items):
        if n not in live:
            p=OUT/pathlib.Path(str(items[n].get("file") or "")).name
            try:p.unlink(missing_ok=True)
            except:pass
            items.pop(n,None);removed+=1
    # Confirmed-person clips and newest clips first.
    # Stable two-pass sort: newest first within each evidence class, with
    # confirmed-person clips ahead of likely-person and generic motion.
    priority=sorted(rows,key=lambda e:str(e.get("timestamp") or ""),reverse=True)
    priority.sort(key=lambda e:0 if str(e.get("person_status"))=="confirmed_person" else 1 if str(e.get("person_status"))=="likely_person" else 2)
    made=0;attempts=0;failed=[]
    limit=int(os.environ.get("C720P_THUMB_LIMIT","18"))
    for e in priority:
        if made>=limit or attempts>=max(12,limit*2):break
        n=pathlib.Path(str(e["remote_name"])).name
        key=hashlib.sha1(n.encode()).hexdigest()[:20]+".jpg"
        dst=OUT/key
        rec=items.get(n,{})
        if dst.is_file() and dst.stat().st_size>4000 and rec.get("version")=="v106":
            continue
        attempts+=1
        ok,meta=generate(e,dst)
        if ok:
            items[n]={"file":key,"url":"/local/c720p-saved-thumbs/"+key,"version":"v106","generated_at":time.time(),**meta}
            made+=1
        else:failed.append({"name":n,**meta})
    atomic(MAN,{"version":"v106","updated_at":time.time(),"items":items})
    print(json.dumps({"ok":True,"saved_events":len(rows),"manifest_items":len(items),"generated":made,"attempts":attempts,"stale_removed":removed,"failed":failed[:12]},indent=2))

if __name__=="__main__":main()
