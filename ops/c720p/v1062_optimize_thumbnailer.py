#!/usr/bin/env python3
from pathlib import Path
import re,shutil,datetime,py_compile,subprocess,time,json

P=Path('/home/jespern/c720p-home-hub/bin/c720p-saved-thumbnailer-v106.py')
stamp=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
B=Path('/home/jespern/c720p-backups')/f'thumbnailer-v1062-{stamp}'
B.mkdir(parents=True,exist_ok=True)
shutil.copy2(P,B/(P.name+'.before'))
s=P.read_text()

# Ensure the earlier correctness fixes are present.
if 'ARCH=BASE/"state/drive-security-archive.json"' not in s:
    s=s.replace('BASE=HOME/"c720p-home-hub"\n','BASE=HOME/"c720p-home-hub"\nARCH=BASE/"state/drive-security-archive.json"\nDET=BASE/"state/person-detection-index.json"\n',1)
s=s.replace('PLAY="http://127.0.0.1:8795/new/saved/clip/"','PLAY="http://127.0.0.1:8795/new/clip/"')
s=s.replace('for i,x in enumerate(scores[:len(SAMPLE_FRACTIONS)]):','for i,x in enumerate(scores):')
s=s.replace('vals.append((score,dur*SAMPLE_FRACTIONS[i]))','vals.append((score,dur*((i+0.5)/max(1,len(scores)))))')

# Add single-download helper.
anchor='''def duration(url):
    r=subprocess.run(["ffprobe","-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",url],text=True,capture_output=True,timeout=45)
    try:return float(r.stdout.strip())
    except:return 0.0
'''
helper=r'''
def download_once(url,dst):
    # One full local copy per saved clip is far cheaper than repeatedly seeking
    # the Drive-backed HTTP stream for ffprobe + scene scan + 3 frame extracts.
    req=urllib.request.Request(url,headers={"User-Agent":"C720P-Saved-Thumb-V1062"})
    with urllib.request.urlopen(req,timeout=180) as r, open(dst,"wb") as f:
        shutil.copyfileobj(r,f,length=1024*1024)
    return dst.is_file() and dst.stat().st_size>10000
'''
if 'def download_once(' not in s:
    if anchor not in s: raise SystemExit('duration anchor missing')
    s=s.replace(anchor,anchor+helper,1)
if 'import shutil' not in s.splitlines()[1:5]:
    s=s.replace('import json, pathlib, subprocess, tempfile, urllib.request, urllib.parse, hashlib, os, time, re',
                'import json, pathlib, subprocess, tempfile, urllib.request, urllib.parse, hashlib, os, time, re, shutil',1)

# Replace generate so all analysis works on the one local temp MP4.
start=s.find('def generate(e,out):')
end=s.find('\ndef main():',start)
if start<0 or end<0: raise SystemExit('generate block missing')
new_generate=r'''def generate(e,out):
    name=pathlib.Path(str(e["remote_name"])).name
    url=PLAY+urllib.parse.quote(name)
    status=str(e.get("person_status") or "")
    with tempfile.TemporaryDirectory(prefix="c720p-thumb-v1062-") as td:
        t=pathlib.Path(td)
        local=t/"clip.mp4"
        if not download_once(url,local):
            return False,{"error":"download"}
        dur=duration(str(local))
        if dur<=0:return False,{"error":"duration"}
        scene_times,_=scene_candidates(str(local),t)
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
            if not frame(str(local),x,dst):
                return False,{"error":"frame","time":x}
            imgs.append(dst)
        if not hstack(imgs,out):return False,{"error":"stack"}
        return True,{"duration":round(dur,2),"times":[round(x,2) for x in times],"person_status":status,"person_score_guided":bool(best_person is not None),"best_person_time":round(best_person,2) if best_person is not None else None,"source_strategy":"single-download-v1062"}
'''
s=s[:start]+new_generate+s[end:]
s=s.replace('"version":"v106"','"version":"v1062"')
s=s.replace('rec.get("version")=="v106"','rec.get("version")=="v1062"')
s=s.replace('{"version":"v106","updated_at"','{"version":"v1062","updated_at"')

P.write_text(s)
py_compile.compile(str(P),doraise=True)
print('THUMBNAILER_V1062=OK')
print('BACKUP='+str(B))
