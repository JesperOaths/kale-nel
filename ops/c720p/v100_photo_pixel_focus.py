from pathlib import Path
import re,json,html,subprocess,datetime,shutil,time,sys

W=Path('/opt/homeassistant/config/www')
PHOTO=W/'c720p-google-photos-inner-security.html'
STAMP=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
BACK=Path('/home/jespern/c720p-backups')/f'photo-focus-v100-{STAMP}'
BACK.mkdir(parents=True,exist_ok=True)
shutil.copy2(PHOTO,BACK/(PHOTO.name+'.before'))

src=PHOTO.read_text(encoding='utf-8')
m=re.search(r'const FRAMING=(\{.*?\});',src,re.S)
if not m: raise SystemExit('FRAMING map not found')
meta=json.loads(m.group(1))
files=sorted(meta)
if len(files)!=60: raise SystemExit(f'expected 60 photos, found {len(files)}')

TARGET_ASPECT=3.22
analysis_html='''<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:monospace}#result{white-space:pre-wrap}</style></head><body><pre id="status">running</pre><pre id="result"></pre><script>
const META=__META__;
const FILES=Object.keys(META).sort();
const TARGET=__TARGET__;

function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function rectSum(I,w,x1,y1,x2,y2){const s=w+1;return I[y2*s+x2]-I[y1*s+x2]-I[y2*s+x1]+I[y1*s+x1]}
function integral(a,w,h){const I=new Float64Array((w+1)*(h+1));for(let y=1;y<=h;y++){let r=0;for(let x=1;x<=w;x++){r+=a[(y-1)*w+x-1];I[y*(w+1)+x]=I[(y-1)*(w+1)+x]+r}}return I}
function intersection(a,b){const x1=Math.max(a.x1,b.x1),y1=Math.max(a.y1,b.y1),x2=Math.min(a.x2,b.x2),y2=Math.min(a.y2,b.y2);return Math.max(0,x2-x1)*Math.max(0,y2-y1)}
function expandBox(b,pad,w,h){return{x1:clamp(b.x1-pad*w,0,w),y1:clamp(b.y1-pad*h,0,h),x2:clamp(b.x2+pad*w,0,w),y2:clamp(b.y2+pad*h,0,h)}}
function loadImg(name){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src='/local/c720p-google-photos-album/'+name+'?a='+Date.now()})}

async function analyze(name){
 const meta=META[name],img=await loadImg(name);
 const maxD=240,scale=Math.min(1,maxD/Math.max(img.naturalWidth,img.naturalHeight));
 const w=Math.max(48,Math.round(img.naturalWidth*scale)),h=Math.max(48,Math.round(img.naturalHeight*scale));
 const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(img,0,0,w,h);
 const d=x.getImageData(0,0,w,h).data,N=w*h;
 const lum=new Float64Array(N),sat=new Float64Array(N);let mr=0,mg=0,mb=0;
 for(let i=0;i<N;i++){const q=i*4,r=d[q],g=d[q+1],b=d[q+2],mx=Math.max(r,g,b),mn=Math.min(r,g,b);lum[i]=.2126*r+.7152*g+.0722*b;sat[i]=mx-mn;mr+=r;mg+=g;mb+=b}
 mr/=N;mg/=N;mb/=N;
 const sal=new Float64Array(N);let total=0,maxSal=0,wx=0,wy=0;
 for(let yy=1;yy<h-1;yy++)for(let xx=1;xx<w-1;xx++){const i=yy*w+xx,q=i*4;
   const gx=Math.abs(lum[i+1]-lum[i-1]),gy=Math.abs(lum[i+w]-lum[i-w]);
   const edge=gx+gy;
   const cd=Math.sqrt((d[q]-mr)**2+(d[q+1]-mg)**2+(d[q+2]-mb)**2);
   const local=Math.abs(lum[i]-(lum[i-1]+lum[i+1]+lum[i-w]+lum[i+w])*.25);
   let v=edge*1.35+sat[i]*.34+cd*.30+local*.85;
   // suppress tiny high-frequency edge noise near outermost border
   const border=Math.min(xx/w,1-xx/w,yy/h,1-yy/h);
   if(border<.018)v*=.35;
   sal[i]=v;total+=v;maxSal=Math.max(maxSal,v);wx+=xx*v;wy+=yy*v;
 }
 if(total<=0)total=1;
 const cx=wx/total,cy=wy/total;
 let vx=0,vy=0;
 for(let yy=1;yy<h-1;yy++)for(let xx=1;xx<w-1;xx++){const v=sal[yy*w+xx];vx+=((xx-cx)/w)**2*v;vy+=((yy-cy)/h)**2*v}
 const spreadX=Math.sqrt(vx/total),spreadY=Math.sqrt(vy/total);
 const I=integral(sal,w,h);

 let bbox=null,faces=Number(meta.faces||0);
 if(Array.isArray(meta.bbox)){
   bbox={x1:meta.bbox[0]*w,y1:meta.bbox[1]*h,x2:meta.bbox[2]*w,y2:meta.bbox[3]*h};
 }
 const expanded=bbox?expandBox(bbox,faces>=2?.045:.06,w,h):null;
 let subjectSal=0,outsideSal=total;
 if(expanded){
   subjectSal=rectSum(I,w,Math.floor(expanded.x1),Math.floor(expanded.y1),Math.ceil(expanded.x2),Math.ceil(expanded.y2));
   outsideSal=Math.max(0,total-subjectSal);
 }
 const bgInterest=expanded?outsideSal/total:1;

 // Candidate focal points: detected-subject center, saliency center, blends and high-saliency peaks.
 const points=[];
 function add(px,py,tag){px=clamp(px,0,w);py=clamp(py,0,h);if(!points.some(p=>Math.hypot(p.x-px,p.y-py)<3))points.push({x:px,y:py,tag})}
 add((Number(meta.x)||50)/100*w,(Number(meta.y)||50)/100*h,'subject');
 add(cx,cy,'saliency');
 add(((Number(meta.x)||50)/100*w)*.72+cx*.28,((Number(meta.y)||50)/100*h)*.72+cy*.28,'blend');
 // Non-max saliency peaks.
 const peaks=[];for(let yy=4;yy<h-4;yy+=3)for(let xx=4;xx<w-4;xx+=3)peaks.push([sal[yy*w+xx],xx,yy]);
 peaks.sort((a,b)=>b[0]-a[0]);
 for(const p of peaks){if(points.filter(q=>q.tag==='peak').length>=5)break;if(!points.some(q=>Math.hypot(q.x-p[1],q.y-p[2])<Math.min(w,h)*.12))add(p[1],p[2],'peak')}
 // Slight offsets around the subject center help composition without losing it.
 const sx=(Number(meta.x)||50)/100*w,sy=(Number(meta.y)||50)/100*h;
 for(const dx of [-.07,0,.07])for(const dy of [-.06,0,.06])add(sx+dx*w,sy+dy*h,'subject-grid');

 const imgAspect=w/h;
 let baseW,baseH;
 if(imgAspect>=TARGET){baseH=h;baseW=h*TARGET}else{baseW=w;baseH=w/TARGET}
 const zooms=[1,1.035,1.07,1.11,1.16,1.22,1.29,1.37];
 let best=null;
 for(const z of zooms){
   const cw=baseW/z,ch=baseH/z;
   for(const p of points){
     let x1=clamp(p.x-cw/2,0,w-cw),y1=clamp(p.y-ch/2,0,h-ch),x2=x1+cw,y2=y1+ch;
     const crop={x1,y1,x2,y2},area=cw*ch;
     const inside=rectSum(I,w,Math.floor(x1),Math.floor(y1),Math.ceil(x2),Math.ceil(y2));
     const salCov=inside/total;
     const density=(inside/Math.max(1,area))/(total/N);
     let subjCov=1,edgeMargin=.25;
     if(expanded){
       const subArea=Math.max(1,(expanded.x2-expanded.x1)*(expanded.y2-expanded.y1));
       subjCov=intersection(crop,expanded)/subArea;
       if(subjCov>.92){
         const ml=(expanded.x1-x1)/cw,mr=(x2-expanded.x2)/cw,mt=(expanded.y1-y1)/ch,mb=(y2-expanded.y2)/ch;
         edgeMargin=Math.max(0,Math.min(ml,mr,mt,mb));
       }else edgeMargin=0;
     }
     const faceWeight=faces>=4?6.8:faces>=2?5.8:faces==1?4.7:0;
     const required=faces>=3?.985:faces>=1?.955:0;
     let score=salCov*2.4+Math.min(density,3)*.42;
     if(expanded){
       score+=subjCov*faceWeight;
       if(subjCov<required)score-=(required-subjCov)*14;
       score+=Math.min(edgeMargin,.12)*2.4;
     }
     // Zoom is rewarded only when background outside the subject is genuinely weak.
     const zoomAmt=z-1;
     const zoomPenalty=zoomAmt*(bgInterest>.52?1.8:bgInterest>.38?1.1:.48);
     score-=zoomPenalty;
     // For no-face images, broad saliency should resist aggressive crops.
     if(!expanded){score-=zoomAmt*(spreadY>.22?1.5:spreadY>.16?.9:.4)}
     // Prefer a stable focal point unless another crop is materially better.
     if(p.tag==='subject'||p.tag==='blend')score+=.06;
     const cand={score,z,crop,point:p,salCov,density,subjCov,edgeMargin};
     if(!best||cand.score>best.score)best=cand;
   }
 }

 // Decide whether any cover crop is intrinsically too destructive for this very-wide frame.
 let contain=false,reason='pixel_crop';
 if(expanded){
   const bw=(expanded.x2-expanded.x1)/w,bh=(expanded.y2-expanded.y1)/h;
   const baseRelH=baseH/h,baseRelW=baseW/w;
   if(faces>=4 || bw>baseRelW*.94 || bh>baseRelH*.93 || best.subjCov<(faces>=2?.98:.94)) {contain=true;reason='preserve_subjects'}
   // Two-person/group images touching image edges get extra protection.
   const touches=(expanded.x1<.035*w)+(expanded.x2>.965*w)+(expanded.y1<.035*h)+(expanded.y2>.965*h);
   if(faces>=2&&touches>=1&&best.edgeMargin<.035){contain=true;reason='edge_subject_protection'}
 }else{
   // If salient content is vertically distributed beyond a cover strip, preserve the full scene.
   if(imgAspect<1.0 && spreadY>.145){contain=true;reason='portrait_scene'}
   else if(spreadY>(baseH/h)*.48 && best.salCov<.72){contain=true;reason='distributed_scene'}
 }
 if(String(meta.fit)==='contain'&&faces>=2){contain=true;reason='existing_group_protection'}

 let fx=contain?clamp((bbox?((bbox.x1+bbox.x2)/2):cx)/w*100,8,92):clamp(((best.crop.x1+best.crop.x2)/2)/w*100,6,94);
 let fy=contain?clamp((bbox?((bbox.y1+bbox.y2)/2):cy)/h*100,8,92):clamp(((best.crop.y1+best.crop.y2)/2)/h*100,6,94);
 let zoom=contain?1:best.z;
 return {
   x:+fx.toFixed(1),y:+fy.toFixed(1),fit:contain?'contain':'cover',zoom:+zoom.toFixed(3),zoomPct:Math.round(zoom*100),
   faces,sourceWidth:img.naturalWidth,sourceHeight:img.naturalHeight,
   saliencyX:+(cx/w*100).toFixed(1),saliencyY:+(cy/h*100).toFixed(1),
   spreadX:+spreadX.toFixed(4),spreadY:+spreadY.toFixed(4),
   saliencyCoverage:+best.salCov.toFixed(4),subjectCoverage:+best.subjCov.toFixed(4),
   backgroundInterest:+bgInterest.toFixed(4),score:+best.score.toFixed(4),
   reason
 };
}

(async()=>{
 const out={};let n=0;
 for(const f of FILES){
   try{out[f]=await analyze(f)}catch(e){out[f]={x:50,y:50,fit:'contain',zoom:1,zoomPct:100,faces:META[f].faces||0,reason:'analysis_error',error:String(e)}}
   n++;document.getElementById('status').textContent=n+'/'+FILES.length;
   await new Promise(r=>setTimeout(r,8));
 }
 document.getElementById('result').textContent=JSON.stringify(out);
 document.body.dataset.done='1';
 document.getElementById('status').textContent='done '+FILES.length;
})();
</script></body></html>'''.replace('__META__',json.dumps(meta,separators=(',',':'))).replace('__TARGET__',str(TARGET_ASPECT))

analysis_path=W/'c720p-photo-analysis-v100.html'
analysis_path.write_text(analysis_html,encoding='utf-8')
url='http://127.0.0.1:8123/local/c720p-photo-analysis-v100.html?v='+STAMP
cmd=['chromium','--headless','--disable-gpu','--no-sandbox','--window-size=1000,310','--virtual-time-budget=65000','--dump-dom',url]
r=subprocess.run(cmd,text=True,capture_output=True,timeout=90)
if r.returncode!=0 and not r.stdout: raise SystemExit('chromium analysis failed: '+r.stderr[-1500:])
dm=re.search(r'<pre id="result">(.*?)</pre>',r.stdout,re.S)
if not dm: raise SystemExit('analysis result not found; stderr='+r.stderr[-1000:])
raw=html.unescape(dm.group(1))
result=json.loads(raw)
if len(result)!=60: raise SystemExit(f'analysis produced {len(result)} results')
errs=[k for k,v in result.items() if v.get('reason')=='analysis_error']
if errs: raise SystemExit('analysis errors: '+repr(errs))

report=W/'c720p-photo-framing-v100.json'
report.write_text(json.dumps(result,indent=2,sort_keys=True),encoding='utf-8')

# Patch slideshow to use the new pixel-derived map and remove the older V94 map/function.
newmap=json.dumps(result,separators=(',',':'))
pat=r'const SMART_FRAMING_V94=.*?;\n  function c720pApplyAnalyzedFrame\(img,url,legacy\)\{.*?\n  \}'
nm='''const SMART_FRAMING_V100=%s;
  function c720pApplyAnalyzedFrame(img,url,legacy){
    const key=String(url||"").split("/").pop().split("?")[0],f=SMART_FRAMING_V100[key]||{x:50,y:50,zoom:1,zoomPct:100,fit:"contain"};
    img.dataset.framingV100="1";
    img.dataset.smartFit=f.fit;
    img.dataset.zoomPct=String(f.zoomPct);
    img.dataset.focusX=String(f.x);
    img.dataset.focusY=String(f.y);
    img.style.objectFit=f.fit;
    img.style.objectPosition=f.x+"%% "+f.y+"%%";
    img.style.transformOrigin=f.x+"%% "+f.y+"%%";
    img.style.setProperty("--photo-zoom-v100",String(f.zoom));
  }'''%newmap
src2,n=re.subn(pat,nm,src,count=1,flags=re.S)
if n!=1: raise SystemExit('failed replacing V94 map/function')

css='''<style id="C720P_PHOTO_PIXEL_FOCUS_V100">
.photo[data-framing-v100="1"]{
  object-position:var(--focus-pos,center center)!important;
  transform:scale(var(--photo-zoom-v100,1))!important;
  transition:opacity .7s ease,transform .45s ease,object-position .45s ease!important;
}
.photo[data-framing-v100="1"][data-smart-fit="contain"]{object-fit:contain!important}
.photo[data-framing-v100="1"][data-smart-fit="cover"]{object-fit:cover!important}
</style>'''
# object-position inline already wins; --focus-pos fallback harmless.
if 'C720P_PHOTO_PIXEL_FOCUS_V100' not in src2: src2=src2.replace('</head>',css+'\n</head>',1)

# Stage background should use V100 focal point too.
old='''    stage.style.setProperty("--stage-focus-x",String(frame.x)+"%");
    stage.style.setProperty("--stage-focus-y",String(frame.y)+"%");'''
new='''    const frameKey=String(url||"").split("/").pop().split("?")[0];
    const analyzedFrame=SMART_FRAMING_V100[frameKey]||frame;
    stage.style.setProperty("--stage-focus-x",String(analyzedFrame.x)+"%");
    stage.style.setProperty("--stage-focus-y",String(analyzedFrame.y)+"%");'''
if old not in src2: raise SystemExit('stage focus block not found')
src2=src2.replace(old,new,1)

PHOTO.write_text(src2,encoding='utf-8')

# Cache bust nested chain.
home=W/'c720p-release/home-live-primary-v2.html'
shutil.copy2(home,BACK/(home.name+'.before'))
try:home.chmod(0o644)
except Exception:pass
hs=home.read_text(encoding='utf-8')
hs=re.sub(r'/local/c720p-google-photos-inner-security\.html\?v=[^"]+',
          '/local/c720p-google-photos-inner-security.html?v=PHOTO_PIXEL_FOCUS_V100_20261007',hs)
home.write_text(hs,encoding='utf-8')
try:home.chmod(0o444)
except Exception:pass

extra=W/'c720p-extra-row-v85.html'
shutil.copy2(extra,BACK/(extra.name+'.before'))
es=extra.read_text(encoding='utf-8')
es=re.sub(r'/local/c720p-release/home-live-primary-v2\.html\?[^"\']*',
          '/local/c720p-release/home-live-primary-v2.html?v=PHOTO_PIXEL_FOCUS_V100_20261007',es)
extra.write_text(es,encoding='utf-8')

cfg=Path('/opt/homeassistant/config/.storage/lovelace.c720p_hub')
shutil.copy2(cfg,BACK/'lovelace.c720p_hub.before')
d=json.loads(cfg.read_text()); aspect=None
def walk(x):
    global aspect
    if isinstance(x,dict):
        if x.get('type')=='iframe' and 'c720p-extra-row-v85.html' in str(x.get('url','')):
            aspect=x.get('aspect_ratio')
            x['url']='/local/c720p-extra-row-v85.html?v=PHOTO_PIXEL_FOCUS_V100_20261007'
        for v in x.values():walk(v)
    elif isinstance(x,list):
        for v in x:walk(v)
walk(d)
tmp=cfg.with_suffix('.tmp-photo100');tmp.write_text(json.dumps(d,separators=(',',':')));tmp.replace(cfg)

r=subprocess.run(['docker','restart','homeassistant'],text=True,capture_output=True,timeout=60)
if r.returncode!=0: raise SystemExit(r.stdout+r.stderr)
for _ in range(45):
    c=subprocess.run(['bash','-lc',"curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8123/"],text=True,capture_output=True)
    if c.stdout.strip() in {'200','302','401'}: break
    time.sleep(1)
else: raise SystemExit('HA did not return')
subprocess.run(['systemctl','--user','restart','c720p-home-hub-kiosk.service'],text=True,capture_output=True,timeout=20)

# Summary.
fits={}
zooms={}
reasons={}
for v in result.values():
    fits[v['fit']]=fits.get(v['fit'],0)+1
    zooms[str(v['zoomPct'])]=zooms.get(str(v['zoomPct']),0)+1
    reasons[v['reason']]=reasons.get(v['reason'],0)+1
print('PHOTO_COUNT='+str(len(result)))
print('TARGET_ASPECT='+str(TARGET_ASPECT))
print('FITS='+json.dumps(fits,sort_keys=True))
print('ZOOMS='+json.dumps(zooms,sort_keys=True))
print('REASONS='+json.dumps(reasons,sort_keys=True))
print('FOCUS_POINTS='+str(len({(v["x"],v["y"]) for v in result.values()})))
print('EXTRA_ASPECT_PRESERVED='+str(aspect))
print('REPORT='+str(report))
print('BACKUP='+str(BACK))
print('PHOTO_V100=OK')
