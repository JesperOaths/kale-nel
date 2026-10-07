#!/home/jespern/c720p-home-hub/.venv-webdriver/bin/python
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.by import By
from pathlib import Path
import urllib.request, json, re, subprocess, datetime, time, hashlib, shutil, sys

WWW=Path('/opt/homeassistant/config/www')
ALBUM=WWW/'c720p-google-photos-album'
MAN=ALBUM/'manifest.json'
PHOTO=WWW/'c720p-google-photos-inner-security.html'
WRAP=WWW/'c720p-release/home-live-primary-v2.html'
BACKROOT=Path('/home/jespern/c720p-backups')
TARGET_ASPECT=3.22

def browser():
    o=Options();o.binary_location='/usr/bin/chromium'
    for a in ['--headless=new','--no-sandbox','--disable-gpu','--window-size=1400,1000','--disable-dev-shm-usage']:
        o.add_argument(a)
    return webdriver.Chrome(options=o)

def scrape_sources(d,url):
    d.get(url);time.sleep(4)
    body=d.find_element(By.TAG_NAME,'body')
    seen=set();stable=0;last=-1
    for n in range(45):
        vals=d.execute_script(r'''
const u=[];
for(const i of document.images){for(const x of [i.src,i.currentSrc,i.getAttribute('src'),i.getAttribute('data-src')])if(x)u.push(x);}
for(const e of performance.getEntriesByType('resource'))if(e.name)u.push(e.name);
return u;''')
        for x in vals:
            if 'googleusercontent.com' in x and '/pw/' in x:
                y=x.replace('\\u003d','=').replace('\\u0026','&').split('?')[0]
                y=re.sub(r'=([wsrhpc]|rw|w)[^/?]*$','',y)
                seen.add(y)
        try:body.send_keys(Keys.PAGE_DOWN)
        except:pass
        d.execute_script(r'''window.scrollBy(0,Math.max(innerHeight*.9,700));
for(const el of document.querySelectorAll('*')){const s=getComputedStyle(el);if((s.overflowY==='auto'||s.overflowY==='scroll')&&el.scrollHeight>el.clientHeight+200)el.scrollTop=Math.min(el.scrollHeight,el.scrollTop+Math.max(el.clientHeight*.9,700));}''')
        time.sleep(.55)
        if len(seen)==last:stable+=1
        else:stable=0
        last=len(seen)
        if stable>=9 and n>14:break
    return sorted(seen)

ANALYZE_JS=r'''
const done=arguments[arguments.length-1],TARGET=3.22;
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
(async()=>{
 try{
  let img=document.images[0];
  if(!img){img=new Image();img.src=location.href;document.body.appendChild(img);}
  if(!img.complete)await new Promise((r,j)=>{img.onload=r;img.onerror=j});
  const maxD=280,sc=Math.min(1,maxD/Math.max(img.naturalWidth,img.naturalHeight)),w=Math.max(48,Math.round(img.naturalWidth*sc)),h=Math.max(48,Math.round(img.naturalHeight*sc));
  const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(img,0,0,w,h);
  const d=x.getImageData(0,0,w,h).data,N=w*h,L=new Float64Array(N),S=new Float64Array(N);let mr=0,mg=0,mb=0;
  for(let i=0;i<N;i++){let q=i*4,r=d[q],g=d[q+1],b=d[q+2],mx=Math.max(r,g,b),mn=Math.min(r,g,b);L[i]=.2126*r+.7152*g+.0722*b;S[i]=mx-mn;mr+=r;mg+=g;mb+=b}mr/=N;mg/=N;mb/=N;
  let total=0,wx=0,wy=0;const sal=new Float64Array(N);
  for(let yy=1;yy<h-1;yy++)for(let xx=1;xx<w-1;xx++){let i=yy*w+xx,q=i*4,edge=Math.abs(L[i+1]-L[i-1])+Math.abs(L[i+w]-L[i-w]),cd=Math.hypot(d[q]-mr,d[q+1]-mg,d[q+2]-mb),local=Math.abs(L[i]-(L[i-1]+L[i+1]+L[i-w]+L[i+w])*.25),v=edge*1.35+S[i]*.34+cd*.30+local*.85,border=Math.min(xx/w,1-xx/w,yy/h,1-yy/h);if(border<.018)v*=.35;sal[i]=v;total+=v;wx+=xx*v;wy+=yy*v}
  if(total<=0)total=1;let cx=wx/total,cy=wy/total,vx=0,vy=0;
  for(let yy=1;yy<h-1;yy++)for(let xx=1;xx<w-1;xx++){let v=sal[yy*w+xx];vx+=((xx-cx)/w)**2*v;vy+=((yy-cy)/h)**2*v}
  const spreadX=Math.sqrt(vx/total),spreadY=Math.sqrt(vy/total),aspect=img.naturalWidth/img.naturalHeight;
  let faces=[];
  if(typeof FaceDetector==='function'){try{faces=await new FaceDetector({fastMode:false,maxDetectedFaces:12}).detect(img)}catch(e){}}
  let bbox=null;
  if(faces.length){const bs=faces.map(f=>f.boundingBox);bbox={x1:Math.min(...bs.map(b=>b.x)),y1:Math.min(...bs.map(b=>b.y)),x2:Math.max(...bs.map(b=>b.x+b.width)),y2:Math.max(...bs.map(b=>b.y+b.height))};cx=((bbox.x1+bbox.x2)/2)/img.naturalWidth*w;cy=((bbox.y1+bbox.y2)/2)/img.naturalHeight*h}
  let fit='contain',zoom=1.04,reason='saliency_scene';
  if(faces.length>=4){zoom=1.02;reason='group_preserve'}
  else if(faces.length>=2){zoom=1.04;reason='pair_preserve'}
  else if(faces.length===1){fit=aspect>=1.45?'cover':'contain';zoom=fit==='cover'?1.06:1.08;reason='single_face_focus'}
  else if(aspect>=1.9&&spreadY<.16){fit='cover';zoom=1.06;reason='wide_saliency_focus'}
  else if(aspect>=1.45&&spreadY<.14){fit='cover';zoom=1.05;reason='landscape_saliency_focus'}
  else if(aspect<.80){fit='contain';zoom=spreadY<.15?1.08:1.04;reason='portrait_preserve'}
  else{fit='contain';zoom=spreadY<.16?1.07:1.04;reason='scene_preserve'}
  let fx=clamp(cx/w*100,7,93),fy=clamp(cy/h*100,7,93),edgeTouches=0,nb=null;
  if(bbox){edgeTouches=(bbox.x1<img.naturalWidth*.03)+(bbox.y1<img.naturalHeight*.03)+(bbox.x2>img.naturalWidth*.97)+(bbox.y2>img.naturalHeight*.97);if(edgeTouches)zoom=Math.min(zoom,1.04);nb=[bbox.x1/img.naturalWidth,bbox.y1/img.naturalHeight,bbox.x2/img.naturalWidth,bbox.y2/img.naturalHeight].map(v=>+v.toFixed(4))}
  done({x:+fx.toFixed(1),y:+fy.toFixed(1),fit,zoom:+zoom.toFixed(3),zoomPct:Math.round(zoom*100),faces:faces.length,width:img.naturalWidth,height:img.naturalHeight,spreadX:+spreadX.toFixed(4),spreadY:+spreadY.toFixed(4),saliencyX:+((wx/total)/w*100).toFixed(1),saliencyY:+((wy/total)/h*100).toFixed(1),edgeTouches,reason,bbox:nb,faceDetector:typeof FaceDetector});
 }catch(e){done({error:String(e)})}
})();'''

def download(base,h):
    out=ALBUM/(h+'.jpg')
    req=urllib.request.Request(base+'=w1400-h950',headers={'User-Agent':'Mozilla/5.0'})
    with urllib.request.urlopen(req,timeout=30) as r:
        data=r.read();ct=r.headers.get('Content-Type','')
    if len(data)<12000 or not ct.startswith('image/'):
        raise RuntimeError(f'bad image {h}: {len(data)} bytes {ct}')
    out.write_bytes(data)
    return out

def analyze(d,out):
    u='http://127.0.0.1:8123/local/c720p-google-photos-album/'+out.name+'?sync='+str(int(time.time()))
    d.get(u);time.sleep(.6)
    d.set_script_timeout(20)
    a=d.execute_async_script(ANALYZE_JS)
    if not isinstance(a,dict) or a.get('error'):raise RuntimeError('analysis failed '+repr(a))
    return a

def patch(new_rows,sources,errors):
    stamp=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    backup=BACKROOT/f'photo-auto-sync-{stamp}';backup.mkdir(parents=True,exist_ok=True)
    for p in [PHOTO,MAN,WRAP]:
        if p.exists():shutil.copy2(p,backup/(p.name+'.before'))
    s=PHOTO.read_text(encoding='utf-8')
    pm=re.search(r'const PHOTOS=(\[.*?\]);',s,re.S);fm=re.search(r'const FRAMING=(\{.*?\});',s,re.S);sm=re.search(r'const (SMART_FRAMING_V\d+)=(\{.*?\});',s,re.S)
    if not (pm and fm and sm):raise RuntimeError('active photo constants not found')
    photos=json.loads(pm.group(1));fr=json.loads(fm.group(1));smart_name=sm.group(1);smart=json.loads(sm.group(2))
    for h,a in new_rows:
        local='/local/c720p-google-photos-album/'+h+'.jpg'
        if local not in photos:photos.append(local)
        fr[h+'.jpg']={'x':a['x'],'y':a['y'],'faces':a['faces'],'confidence':0.82 if a['faces'] else 0.38,'bbox':a['bbox'],'method':'pixel_saliency_face_auto' if a['faces'] else 'pixel_saliency_auto','fit':a['fit'],'width':a['width'],'height':a['height']}
        smart[h+'.jpg']={'x':a['x'],'y':a['y'],'fit':a['fit'],'zoom':a['zoom'],'zoomPct':a['zoomPct'],'faces':a['faces'],'sourceWidth':a['width'],'sourceHeight':a['height'],'saliencyX':a['saliencyX'],'saliencyY':a['saliencyY'],'spreadX':a['spreadX'],'spreadY':a['spreadY'],'saliencyCoverage':1.0,'subjectCoverage':1.0,'backgroundInterest':1.0 if not a['faces'] else .4,'score':0.0,'reason':a['reason'],'zoomReason':a['reason'],'subjectArea':0.0,'subjectSpan':0.0,'edgeTouches':a['edgeTouches']}
    # Re-find after each replacement because offsets change.
    s=s[:pm.start()]+'const PHOTOS='+json.dumps(photos,separators=(',',':'))+';'+s[pm.end():]
    fm=re.search(r'const FRAMING=(\{.*?\});',s,re.S);s=s[:fm.start()]+'const FRAMING='+json.dumps(fr,separators=(',',':'))+';'+s[fm.end():]
    sm=re.search(r'const '+re.escape(smart_name)+r'=(\{.*?\});',s,re.S);s=s[:sm.start()]+'const '+smart_name+'='+json.dumps(smart,separators=(',',':'))+';'+s[sm.end():]
    PHOTO.write_text(s,encoding='utf-8')
    # Update current report.
    (WWW/'c720p-photo-framing-v103.json').write_text(json.dumps(smart,indent=2,sort_keys=True),encoding='utf-8')
    man=json.loads(MAN.read_text());mp=man.setdefault('photos',[])
    for h,_ in new_rows:
        local='/local/c720p-google-photos-album/'+h+'.jpg'
        if not any((x.get('src') if isinstance(x,dict) else x)==local for x in mp):mp.append({'src':local})
    man.update(updated=datetime.datetime.now().isoformat(timespec='seconds'),old_count_before_update=len(mp)-len(new_rows),scraped_source_count=len(sources),downloaded_this_run=len(new_rows),blocker=None,errors_sample=errors[:10])
    MAN.write_text(json.dumps(man,indent=2)+'\n',encoding='utf-8')
    # Wrapper gets a unique inner URL; the outer extra-row uses a dynamic wrapper URL.
    try:WRAP.chmod(0o644)
    except:pass
    ws=WRAP.read_text(encoding='utf-8')
    ws=re.sub(r'/local/c720p-google-photos-inner-security\.html\?v=[^"]+','/local/c720p-google-photos-inner-security.html?v=PHOTO_AUTO_'+stamp,ws)
    WRAP.write_text(ws,encoding='utf-8')
    try:WRAP.chmod(0o444)
    except:pass
    subprocess.run(['systemctl','--user','restart','c720p-home-hub-kiosk.service'],text=True,capture_output=True,timeout=20)
    return len(photos),len(smart),backup

def main():
    if not MAN.exists():raise SystemExit('active manifest missing')
    man=json.loads(MAN.read_text());url=man['source_url']
    d=browser()
    errors=[];new_rows=[]
    try:
        sources=scrape_sources(d,url)
        cached={p.stem for p in ALBUM.glob('*.jpg')}
        missing=[(hashlib.sha1(u.encode()).hexdigest()[:20],u) for u in sources if hashlib.sha1(u.encode()).hexdigest()[:20] not in cached]
        print('SCRAPED='+str(len(sources)));print('CACHED_BEFORE='+str(len(cached)));print('MISSING='+str(len(missing)))
        for h,u in missing:
            try:
                out=download(u,h);a=analyze(d,out);new_rows.append((h,a));print('ADDED '+h+' '+json.dumps(a,sort_keys=True))
            except Exception as e:
                errors.append(f'{h}: {e}');print('ERROR '+errors[-1],file=sys.stderr)
    finally:
        d.quit()
    if not new_rows:
        man['updated']=datetime.datetime.now().isoformat(timespec='seconds');man['scraped_source_count']=len(sources);man['downloaded_this_run']=0;man['errors_sample']=errors[:10];MAN.write_text(json.dumps(man,indent=2)+'\n',encoding='utf-8')
        print('NO_NEW=TRUE');return
    pc,fc,b=patch(new_rows,sources,errors)
    print('NEW_COUNT='+str(len(new_rows)));print('PHOTO_COUNT='+str(pc));print('FRAMING_COUNT='+str(fc));print('BACKUP='+str(b));print('SYNC_OK=TRUE')

if __name__=='__main__':main()
