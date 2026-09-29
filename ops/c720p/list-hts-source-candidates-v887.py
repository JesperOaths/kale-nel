#!/usr/bin/env python3
from pathlib import Path
import zipfile,tempfile,sqlite3,re,hashlib

roots=[
    Path.home()/"leanremote_extract",
    Path.home()/"Downloads"/"leanremote_extract",
    Path.home()/"Downloads",
    Path.home(),
]
hits=[]
for root in roots:
    if root.exists():
        hits.extend(root.rglob("visio.zip"))
hits=sorted(set(hits),key=lambda p:(len(str(p)),str(p)))
if not hits:
    raise SystemExit("NO_VISIO_ZIP")
zpath=hits[0]
tmp=Path(tempfile.mkdtemp(prefix="hts-v887-"))
with zipfile.ZipFile(zpath) as z:
    names=z.namelist()
    name="visio" if "visio" in names else names[0]
    z.extract(name,tmp)
db=tmp/name

con=sqlite3.connect(str(db))
rows=con.execute("""
select fragment,button_fragment,frequency,main_frame
from remote
where frequency is not null and main_frame is not null
and (
 lower(fragment) like 'samht%' or
 lower(fragment) like 'samav%' or
 lower(fragment) like 'sambl%' or
 lower(fragment) like 'samsoudbar%' or
 lower(fragment) like '%samsung%'
)
order by fragment,button_fragment
""").fetchall()
con.close()

button_terms=("function","source","input","tv/video","tv video","tv_video",
              "bluetooth","blue","bt","b/t","hdmi","arc","aux","digital",
              "dvd","usb","tuner","fm","radio")

def decode_hex(frame):
    nums=[int(x.strip()) for x in str(frame).split(",") if x.strip()]
    if len(nums)<68: return "?"
    bits=[]
    for i in range(2,66,2):
        bits.append(1 if nums[i+1]>1000 else 0)
    v=0
    for b in bits:v=(v<<1)|b
    return f"{v:08X}"

cands=[]
seen=set()
for frag,btn,freq,frame in rows:
    label=f"{frag} / {btn}"
    if not any(t in str(btn).lower() for t in button_terms):
        continue
    nums=[int(x.strip()) for x in str(frame).split(",") if x.strip()]
    hx=decode_hex(frame)
    sig=(int(freq),hx,len(nums),str(btn).lower())
    if sig in seen: continue
    seen.add(sig)
    score=0
    lo=label.lower()
    for t in ("bluetooth","b/t"," bt","function","source","input","tv/video","tv video"):
        if t in lo: score-=100
    for t in ("hdmi","arc","aux","digital","dvd","usb","tuner","fm","radio"):
        if t in lo: score-=20
    if "samht5" in lo: score-=40
    elif "samht" in lo: score-=20
    cands.append((score,label,int(freq),len(nums),hx,hashlib.sha256(str(frame).encode()).hexdigest()[:16]))

cands.sort(key=lambda x:(x[0],x[1].lower()))
print("VISIO_ZIP="+str(zpath))
print("CANDIDATE_COUNT="+str(len(cands)))
for n,(score,label,freq,nnums,hx,sha) in enumerate(cands[:160],1):
    print(f"{n:03d}|score={score}|{label}|freq={freq}|len={nnums}|hex={hx}|sha={sha}")
print("RESULT=V887_SOURCE_CANDIDATES_LISTED")
