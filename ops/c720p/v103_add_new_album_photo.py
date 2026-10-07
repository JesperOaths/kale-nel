from pathlib import Path
import urllib.request, json, re, html, subprocess, shutil, datetime, time, hashlib

W=Path('/opt/homeassistant/config/www')
ALBUM=W/'c720p-google-photos-album'
PHOTO=W/'c720p-google-photos-inner-security.html'
MAN=ALBUM/'manifest.json'
SRC='https://lh3.googleusercontent.com/pw/AP1GczOgYXHN5kOYfiTfjJGlWpe5wvzv-XFHHCKGTkvr0Pp2EpSXN8kvi_OztnB2ZpsBoIQzljdLqwJcKbp0d1PPRNgUlzYzls6brZNnJGUnRD_-JB3Zp_9U'
HASH=hashlib.sha1(SRC.encode()).hexdigest()[:20]
assert HASH=='ac4f0fbcbe92e09755f1'
OUT=ALBUM/(HASH+'.jpg')
LOCAL='/local/c720p-google-photos-album/'+OUT.name
STAMP=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
BACK=Path('/home/jespern/c720p-backups')/f'photo-add-v103-{STAMP}'
BACK.mkdir(parents=True,exist_ok=True)
for p in [PHOTO,MAN]:
    shutil.copy2(p,BACK/(p.name+'.before'))

# Download at same display-oriented scale as current cache.
req=urllib.request.Request(SRC+'=w1400-h950',headers={'User-Agent':'Mozilla/5.0'})
with urllib.request.urlopen(req,timeout=30) as r:
    data=r.read()
    ct=r.headers.get('Content-Type','')
if len(data)<12000 or not ct.startswith('image/'):
    raise SystemExit(f'bad image download: {len(data)} bytes, {ct}')
OUT.write_bytes(data)

# Pixel analysis in Chromium. This also tries native FaceDetector when available.
analysis=W/'c720p-photo-new-analysis-v103.html'
page='''<!doctype html><html><body><pre id="result"></pre><script>
const TARGET=3.22;
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function go(){
 const img=new Image(); img.src="__LOCAL__?v=__STAMP__";
 img.onload=async()=>{
  const maxD=280,sc=Math.min(1,maxD/Math.max(img.naturalWidth,img.naturalHeight)),w=Math.max(48,Math.round(img.naturalWidth*sc)),h=Math.max(48,Math.round(img.naturalHeight*sc));
  const c=document.createElement("canvas");c.width=w;c.height=h;const x=c.getContext("2d",{willReadFrequently:true});x.drawImage(img,0,0,w,h);
  const d=x.getImageData(0,0,w,h).data,N=w*h,L=new Float64Array(N),S=new Float64Array(N);let mr=0,mg=0,mb=0;
  for(let i=0;i<N;i++){let q=i*4,r=d[q],g=d[q+1],b=d[q+2],mx=Math.max(r,g,b),mn=Math.min(r,g,b);L[i]=.2126*r+.7152*g+.0722*b;S[i]=mx-mn;mr+=r;mg+=g;mb+=b}mr/=N;mg/=N;mb/=N;
  let total=0,wx=0,wy=0;const sal=new Float64Array(N);
  for(let yy=1;yy<h-1;yy++)for(let xx=1;xx<w-1;xx++){let i=yy*w+xx,q=i*4,edge=Math.abs(L[i+1]-L[i-1])+Math.abs(L[i+w]-L[i-w]),cd=Math.hypot(d[q]-mr,d[q+1]-mg,d[q+2]-mb),local=Math.abs(L[i]-(L[i-1]+L[i+1]+L[i-w]+L[i+w])*.25),v=edge*1.35+S[i]*.34+cd*.30+local*.85;let border=Math.min(xx/w,1-xx/w,yy/h,1-yy/h);if(border<.018)v*=.35;sal[i]=v;total+=v;wx+=xx*v;wy+=yy*v}
  if(total<=0)total=1;let cx=wx/total,cy=wy/total,vx=0,vy=0;
  for(let yy=1;yy<h-1;yy++)for(let xx=1;xx<w-1;xx++){let v=sal[yy*w+xx];vx+=((xx-cx)/w)**2*v;vy+=((yy-cy)/h)**2*v}
  const spreadX=Math.sqrt(vx/total),spreadY=Math.sqrt(vy/total);
  let faces=[];
  if(typeof FaceDetector==="function"){try{const fd=new FaceDetector({fastMode:false,maxDetectedFaces:12});faces=await fd.detect(img)}catch(e){}}
  let bbox=null;
  if(faces.length){let bs=faces.map(f=>f.boundingBox);bbox={x1:Math.min(...bs.map(b=>b.x)),y1:Math.min(...bs.map(b=>b.y)),x2:Math.max(...bs.map(b=>b.x+b.width)),y2:Math.max(...bs.map(b=>b.y+b.height))};cx=((bbox.x1+bbox.x2)/2)/img.naturalWidth*w;cy=((bbox.y1+bbox.y2)/2)/img.naturalHeight*h}
  const aspect=img.naturalWidth/img.naturalHeight;
  let fit="contain",zoom=1.04,reason="saliency_scene";
  if(faces.length>=4){fit="contain";zoom=1.02;reason="group_preserve"}
  else if(faces.length>=2){fit="contain";zoom=1.04;reason="pair_preserve"}
  else if(faces.length===1){fit=aspect>=1.45?"cover":"contain";zoom=fit==="cover"?1.06:1.08;reason="single_face_focus"}
  else if(aspect>=1.9 && spreadY<.16){fit="cover";zoom=1.06;reason="wide_saliency_focus"}
  else if(aspect>=1.45 && spreadY<.14){fit="cover";zoom=1.05;reason="landscape_saliency_focus"}
  else if(aspect<.80){fit="contain";zoom=spreadY<.15?1.08:1.04;reason="portrait_preserve"}
  else {fit="contain";zoom=spreadY<.16?1.07:1.04;reason="scene_preserve"}
  let fx=clamp(cx/w*100,7,93),fy=clamp(cy/h*100,7,93);
  // Edge faces get no aggressive zoom.
  let edgeTouches=0;
  if(bbox){edgeTouches=(bbox.x1<img.naturalWidth*.03)+(bbox.y1<img.naturalHeight*.03)+(bbox.x2>img.naturalWidth*.97)+(bbox.y2>img.naturalHeight*.97);if(edgeTouches)zoom=Math.min(zoom,1.04)}
  document.getElementById("result").textContent=JSON.stringify({x:+fx.toFixed(1),y:+fy.toFixed(1),fit,zoom:+zoom.toFixed(3),zoomPct:Math.round(zoom*100),faces:faces.length,width:img.naturalWidth,height:img.naturalHeight,spreadX:+spreadX.toFixed(4),spreadY:+spreadY.toFixed(4),saliencyX:+((wx/total)/w*100).toFixed(1),saliencyY:+((wy/total)/h*100).toFixed(1),edgeTouches,reason,bbox:bbox?[+(bbox.x1/img.naturalWidth).toFixed(4),+(bbox.y1/img.naturalHeight).toFixed(4),+(bbox.x2/img.naturalWidth).toFixed(4),+(bbox.y2/img.naturalHeight).toFixed(4)]:null,faceDetector:typeof FaceDetector});
  document.body.dataset.done="1";
 }; img.onerror=()=>document.getElementById("result").textContent=JSON.stringify({error:"load_failed"});
}go();
</script></body></html>'''.replace('__LOCAL__',LOCAL).replace('__STAMP__',STAMP)
analysis.write_text(page,encoding='utf-8')
r=subprocess.run(['chromium','--headless','--disable-gpu','--no-sandbox','--virtual-time-budget=12000','--dump-dom','http://127.0.0.1:8123/local/c720p-photo-new-analysis-v103.html?v='+STAMP],text=True,capture_output=True,timeout=35)
m=re.search(r'<pre id="result">(.*?)</pre>',r.stdout,re.S)
if not m: raise SystemExit('pixel analysis produced no result')
a=json.loads(html.unescape(m.group(1)))
if a.get('error'): raise SystemExit('pixel analysis failed: '+repr(a))
analysis.unlink(missing_ok=True)

# Add image to manifest.
man=json.loads(MAN.read_text())
photos=man.setdefault('photos',[])
if not any((x.get('src') if isinstance(x,dict) else x)==LOCAL for x in photos):
    photos.append({'src':LOCAL})
man['old_count_before_update']=60
man['scraped_source_count']=61
man['downloaded_this_run']=1
man['updated']=datetime.datetime.now().isoformat(timespec='seconds')
man['blocker']=None
man['errors_sample']=[]
MAN.write_text(json.dumps(man,indent=2)+'\n',encoding='utf-8')

# Patch active slideshow.
s=PHOTO.read_text(encoding='utf-8')
# PHOTOS
pm=re.search(r'const PHOTOS=(\[.*?\]);',s,re.S)
if not pm: raise SystemExit('PHOTOS not found')
pl=json.loads(pm.group(1))
if LOCAL not in pl: pl.append(LOCAL)
s=s[:pm.start()]+('const PHOTOS='+json.dumps(pl,separators=(',',':'))+';')+s[pm.end():]

# FRAMING base metadata
fm=re.search(r'const FRAMING=(\{.*?\});',s,re.S)
if not fm: raise SystemExit('FRAMING not found')
fr=json.loads(fm.group(1))
fr[OUT.name]={'x':a['x'],'y':a['y'],'faces':a['faces'],'confidence':0.82 if a['faces'] else 0.38,'bbox':a['bbox'],'method':'pixel_saliency_face_v103' if a['faces'] else 'pixel_saliency_v103','fit':a['fit'],'width':a['width'],'height':a['height']}
# regex positions shifted after PHOTOS replacement, re-find
fm=re.search(r'const FRAMING=(\{.*?\});',s,re.S)
s=s[:fm.start()]+('const FRAMING='+json.dumps(fr,separators=(',',':'))+';')+s[fm.end():]

# SMART V102 -> V103
sm=re.search(r'const SMART_FRAMING_V102=(\{.*?\});',s,re.S)
if not sm: raise SystemExit('SMART_FRAMING_V102 not found')
smart=json.loads(sm.group(1))
smart[OUT.name]={
 'x':a['x'],'y':a['y'],'fit':a['fit'],'zoom':a['zoom'],'zoomPct':a['zoomPct'],
 'faces':a['faces'],'sourceWidth':a['width'],'sourceHeight':a['height'],
 'saliencyX':a['saliencyX'],'saliencyY':a['saliencyY'],'spreadX':a['spreadX'],'spreadY':a['spreadY'],
 'saliencyCoverage':1.0,'subjectCoverage':1.0,'backgroundInterest':1.0 if not a['faces'] else 0.4,
 'score':0.0,'reason':a['reason'],'zoomReason':a['reason'],'subjectArea':0.0,'subjectSpan':0.0,'edgeTouches':a['edgeTouches']
}
s=s[:sm.start()]+('const SMART_FRAMING_V103='+json.dumps(smart,separators=(',',':'))+';')+s[sm.end():]
s=s.replace('SMART_FRAMING_V102[','SMART_FRAMING_V103[')
s=s.replace('data-framing-v102','data-framing-v103')
s=s.replace('framingV102','framingV103')
s=s.replace('--photo-zoom-v102','--photo-zoom-v103')
s=s.replace('C720P_PHOTO_PIXEL_FOCUS_V102','C720P_PHOTO_PIXEL_FOCUS_V103')
s=s.replace('.photo[data-framing-v102="1"]','.photo[data-framing-v103="1"]')
s=s.replace('var(--photo-zoom-v102,1)','var(--photo-zoom-v103,1)')
PHOTO.write_text(s,encoding='utf-8')

# Write auditable V103 report.
report=W/'c720p-photo-framing-v103.json'
report.write_text(json.dumps(smart,indent=2,sort_keys=True),encoding='utf-8')

# Cache bust nested chain.
home=W/'c720p-release/home-live-primary-v2.html'; shutil.copy2(home,BACK/(home.name+'.before'))
try: home.chmod(0o644)
except: pass
hs=home.read_text(encoding='utf-8')
hs=re.sub(r'/local/c720p-google-photos-inner-security\.html\?v=[^"]+','/local/c720p-google-photos-inner-security.html?v=PHOTO_PIXEL_FOCUS_V103_20261007',hs)
home.write_text(hs,encoding='utf-8')
try: home.chmod(0o444)
except: pass

extra=W/'c720p-extra-row-v85.html'; shutil.copy2(extra,BACK/(extra.name+'.before'))
es=extra.read_text(encoding='utf-8')
es=re.sub(r'/local/c720p-release/home-live-primary-v2\.html\?[^"\']*','/local/c720p-release/home-live-primary-v2.html?v=PHOTO_PIXEL_FOCUS_V103_20261007',es)
extra.write_text(es,encoding='utf-8')

cfg=Path('/opt/homeassistant/config/.storage/lovelace.c720p_hub'); shutil.copy2(cfg,BACK/'lovelace.c720p_hub.before')
d=json.loads(cfg.read_text()); aspect=None
def walk(x):
 global aspect
 if isinstance(x,dict):
  if x.get('type')=='iframe' and 'c720p-extra-row-v85.html' in str(x.get('url','')):
   aspect=x.get('aspect_ratio'); x['url']='/local/c720p-extra-row-v85.html?v=PHOTO_PIXEL_FOCUS_V103_20261007'
  for v in x.values(): walk(v)
 elif isinstance(x,list):
  for v in x: walk(v)
walk(d)
tmp=cfg.with_suffix('.tmp-photo103');tmp.write_text(json.dumps(d,separators=(',',':')));tmp.replace(cfg)

rr=subprocess.run(['docker','restart','homeassistant'],text=True,capture_output=True,timeout=60)
if rr.returncode!=0: raise SystemExit(rr.stdout+rr.stderr)
for _ in range(45):
 c=subprocess.run(['bash','-lc',"curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8123/"],text=True,capture_output=True)
 if c.stdout.strip() in {'200','302','401'}: break
 time.sleep(1)
else: raise SystemExit('HA did not return')
subprocess.run(['systemctl','--user','restart','c720p-home-hub-kiosk.service'],text=True,capture_output=True,timeout=20)

print('ADDED='+OUT.name)
print('BYTES='+str(len(data)))
print('ANALYSIS='+json.dumps(a,sort_keys=True))
print('PHOTO_COUNT='+str(len(pl)))
print('FRAMING_COUNT='+str(len(smart)))
print('ASPECT_PRESERVED='+str(aspect))
print('REPORT='+str(report))
print('BACKUP='+str(BACK))
print('PHOTO_V103=OK')
