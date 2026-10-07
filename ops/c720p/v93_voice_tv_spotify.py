from pathlib import Path
import re, shutil, datetime

WWW=Path('/opt/homeassistant/config/www')
STAMP=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
BACK=Path('/home/jespern/c720p-backups')/f'v93-ui-{STAMP}'
BACK.mkdir(parents=True,exist_ok=True)

def backup(p):
    if p.exists():
        shutil.copy2(p,BACK/(p.name+'.before'))

# Voice: preserve outer dimensions; redesign only internals.
p=WWW/'c720p-voice-banner.html'; backup(p)
s=p.read_text(encoding='utf-8')
css=r'''<style id="C720P_VOICE_SPACE_V93">
/* V93: internal-only redesign. The surrounding Lovelace iframe/aspect ratio is untouched. */
.card{overflow:hidden!important;padding:0!important}
.inner{
  height:100%!important;min-height:0!important;box-sizing:border-box!important;
  padding:10px 12px 9px!important;
  display:grid!important;
  grid-template-rows:minmax(0,1fr) auto!important;
  gap:8px!important;
}
.main{
  min-height:0!important;
  display:grid!important;
  grid-template-columns:72px minmax(0,1fr)!important;
  align-items:center!important;
  gap:12px!important;
  padding:0!important;margin:0!important;
}
.orb{
  width:68px!important;height:68px!important;min-width:68px!important;
  border-radius:50%!important;
  display:grid!important;place-items:center!important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 8px 22px rgba(0,0,0,.28),0 0 22px rgba(58,186,255,.08)!important;
}
.copy{min-width:0!important;display:flex!important;flex-direction:column!important;justify-content:center!important;gap:5px!important}
.title{
  font-size:22px!important;line-height:23px!important;font-weight:1000!important;
  letter-spacing:-.025em!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important
}
.detail{
  font-size:12px!important;line-height:14px!important;font-weight:760!important;
  color:#b8cbd9!important;white-space:normal!important;max-height:29px!important;overflow:hidden!important
}
.metrics{
  width:100%!important;
  display:grid!important;
  grid-template-columns:repeat(4,minmax(0,1fr))!important;
  gap:6px!important;
  margin:0!important;padding:0!important;
}
.metric{
  min-width:0!important;min-height:43px!important;
  padding:5px 6px!important;border-radius:10px!important;
  display:flex!important;flex-direction:column!important;justify-content:center!important;align-items:center!important;
  text-align:center!important;
  background:linear-gradient(155deg,rgba(255,255,255,.06),rgba(255,255,255,.025))!important;
  border:1px solid rgba(255,255,255,.095)!important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.035)!important
}
.metric .label{
  font-size:7.5px!important;line-height:9px!important;font-weight:900!important;
  letter-spacing:.05em!important;text-transform:uppercase!important;color:#829bad!important;
  white-space:nowrap!important
}
.metric .value{
  margin-top:2px!important;font-size:16px!important;line-height:17px!important;font-weight:1000!important;
  color:#f4fbff!important;font-variant-numeric:tabular-nums!important;
  white-space:nowrap!important
}
.metric.peak .value{color:#ffc978!important}
.metric.mic .value{color:#8ce5ff!important}
.version{
  position:absolute!important;right:9px!important;top:7px!important;
  font-size:7px!important;line-height:8px!important;opacity:.44!important
}
</style>'''
if 'C720P_VOICE_SPACE_V93' not in s:
    s=s.replace('</head>',css+'\n</head>',1)
p.write_text(s,encoding='utf-8')

# TV / Surround copy cleanup + visual order swap without altering handlers.
p=WWW/'c720p-tv-surround-v21.html'; backup(p)
s=p.read_text(encoding='utf-8')
s=s.replace('Find IR +','')
s=s.replace('TV & surround','TV & Surround')
swap_js=r'''<script id="C720P_TV_VOLUME_ORDER_V93">
document.addEventListener('DOMContentLoaded',()=>{
  const buttons=[...document.querySelectorAll('button')];
  const minus=buttons.find(b=>/volume\s*[−-]/i.test((b.textContent||'').trim()));
  const plus=buttons.find(b=>/volume\s*\+/i.test((b.textContent||'').trim()));
  if(minus&&plus&&minus.parentElement===plus.parentElement){
    const p=minus.parentElement;
    if(minus.compareDocumentPosition(plus)&Node.DOCUMENT_POSITION_FOLLOWING){
      p.insertBefore(plus,minus);
    }
  }
});
</script>'''
if 'C720P_TV_VOLUME_ORDER_V93' not in s:
    s=s.replace('</body>',swap_js+'\n</body>',1)
p.write_text(s,encoding='utf-8')

# Spotify: hub-consistent tactile controls, while retaining existing button semantics.
p=WWW/'c720p-spotify-compact-v1.html'; backup(p)
s=p.read_text(encoding='utf-8')
css=r'''<style id="C720P_SPOTIFY_CONTROLS_V93">
button,.btn,[role="button"]{
  -webkit-tap-highlight-color:transparent;
}
button{
  min-width:38px!important;height:36px!important;
  border-radius:11px!important;
  border:1px solid rgba(75,210,139,.22)!important;
  color:#effff6!important;
  background:
    radial-gradient(90% 140% at 12% 0%,rgba(67,218,139,.17),transparent 60%),
    linear-gradient(145deg,rgba(17,45,35,.90),rgba(10,27,22,.90))!important;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.075),
    inset 0 -1px 0 rgba(0,0,0,.16),
    0 4px 12px rgba(0,0,0,.18)!important;
  font-weight:950!important;
  transition:transform .12s ease,filter .12s ease,border-color .12s ease!important;
}
button:hover{filter:brightness(1.12)!important;border-color:rgba(88,229,153,.38)!important}
button:active{transform:translateY(1px) scale(.96)!important;filter:brightness(.96)!important}
button svg,button ha-icon{filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))!important}
.controls,.buttons,.playerControls,.transport,.actions{
  gap:7px!important;
}
.controls button:first-child,.playerControls button:first-child{
  border-color:rgba(89,222,151,.34)!important;
}
</style>'''
if 'C720P_SPOTIFY_CONTROLS_V93' not in s:
    s=s.replace('</head>',css+'\n</head>',1)
p.write_text(s,encoding='utf-8')

print('VOICE_PATCH=OK')
print('TV_COPY_ORDER_PATCH=OK')
print('SPOTIFY_PATCH=OK')
print('BACKUP='+str(BACK))


# --- SMART PHOTO FRAMING V93 ---
from pathlib import Path
import shutil,datetime,re

WWW=Path('/opt/homeassistant/config/www')
p=WWW/'c720p-google-photos-inner-security.html'
STAMP=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
BACK=Path('/home/jespern/c720p-backups')/f'photo-smart-v93-{STAMP}'
BACK.mkdir(parents=True,exist_ok=True)
shutil.copy2(p,BACK/(p.name+'.before'))
s=p.read_text(encoding='utf-8')

css=r'''<style id="C720P_PHOTO_SMART_FRAME_V93">
/* V93 smart per-photo framing. The blurred stage remains a full-frame safety net. */
.photo[data-smart-fit="contain"]{
  object-fit:contain!important;object-position:var(--smart-pos,50% 50%)!important;transform:none!important
}
.photo[data-smart-fit="balanced"]{
  object-fit:cover!important;object-position:var(--smart-pos,50% 50%)!important;transform:scale(1.015)!important
}
.photo[data-smart-fit="medium"]{
  object-fit:cover!important;object-position:var(--smart-pos,50% 50%)!important;transform:scale(1.075)!important
}
.photo[data-smart-fit="close"]{
  object-fit:cover!important;object-position:var(--smart-pos,50% 50%)!important;transform:scale(1.14)!important
}
</style>'''

helper=r'''<script id="C720P_PHOTO_SMART_ANALYSIS_V93">
(function(){
  function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
  function pct(v){return clamp(v,8,92).toFixed(1)+"%"}
  function metadataMode(frame,img){
    const iw=img.naturalWidth||1,ih=img.naturalHeight||1;
    const sw=(img.parentElement&&img.parentElement.clientWidth)||iw;
    const sh=(img.parentElement&&img.parentElement.clientHeight)||ih;
    const mismatch=Math.max((iw/ih)/(sw/sh),(sw/sh)/(iw/ih));
    let mode=mismatch>1.62?"contain":"balanced";
    let pos="50% 50%";
    if(frame){
      const p=frame.position||frame.pos||frame.objectPosition;
      if(typeof p==="string"&&p.trim())pos=p;
      const f=String(frame.fit||"").toLowerCase();
      const z=Number(frame.zoom||frame.scale||1);
      if(f==="contain")mode="contain";
      else if(f==="cover")mode="medium";
      if(Number.isFinite(z)&&z>=1.13)mode="close";
    }
    return {mode,pos}
  }
  async function faceResult(img){
    if(!("FaceDetector" in window))return null;
    try{
      const fd=new FaceDetector({fastMode:true,maxDetectedFaces:12});
      const faces=await fd.detect(img);
      if(!faces||!faces.length)return null;
      let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
      for(const f of faces){const b=f.boundingBox;x1=Math.min(x1,b.x);y1=Math.min(y1,b.y);x2=Math.max(x2,b.x+b.width);y2=Math.max(y2,b.y+b.height)}
      const iw=img.naturalWidth||1,ih=img.naturalHeight||1;
      const w=x2-x1,h=y2-y1,cx=(x1+x2)/2,cy=(y1+y2)/2;
      const coverage=(w*h)/(iw*ih),spanX=w/iw,spanY=h/ih;
      let mode;
      if(faces.length>=3||spanX>.66||spanY>.72)mode="contain";
      else if(coverage<.075)mode="close";
      else if(coverage<.22)mode="medium";
      else mode="balanced";
      return {mode,pos:pct(cx/iw*100)+" "+pct(cy/ih*100),faces:faces.length}
    }catch(_){return null}
  }
  function saliencyResult(img){
    try{
      const c=document.createElement("canvas"),w=48,h=32;c.width=w;c.height=h;
      const ctx=c.getContext("2d",{willReadFrequently:true});ctx.drawImage(img,0,0,w,h);
      const d=ctx.getImageData(0,0,w,h).data,lum=new Float32Array(w*h);
      for(let i=0;i<w*h;i++){const q=i*4;lum[i]=.2126*d[q]+.7152*d[q+1]+.0722*d[q+2]}
      const g=[];let sum=0;
      for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;const v=Math.abs(lum[i+1]-lum[i-1])+Math.abs(lum[i+w]-lum[i-w]);g.push([x,y,v]);sum+=v}
      const mean=sum/Math.max(1,g.length);
      let vx=0,vy=0,wt=0,active=0;
      for(const a of g){const z=Math.max(0,a[2]-mean*.72);if(z>mean*.35)active++;vx+=a[0]*z;vy+=a[1]*z;wt+=z}
      if(wt<=0)return null;
      const cx=vx/wt,cy=vy/wt;let variance=0;
      for(const a of g){const z=Math.max(0,a[2]-mean*.72);const dx=(a[0]-cx)/w,dy=(a[1]-cy)/h;variance+=(dx*dx+dy*dy)*z}
      variance/=wt;
      const spread=Math.sqrt(variance),activeFrac=active/Math.max(1,g.length);
      let mode="balanced";
      if(spread>.30||activeFrac>.56)mode="contain";
      else if(spread<.18&&activeFrac<.34)mode="close";
      else if(spread<.245)mode="medium";
      return {mode,pos:pct(cx/w*100)+" "+pct(cy/h*100),spread,activeFrac}
    }catch(_){return null}
  }
  window.c720pSmartFrame=async function(img,frame){
    if(!img||!img.naturalWidth)return;
    let r=metadataMode(frame,img);
    const f=await faceResult(img);
    if(f)r=f;
    else{
      const s=saliencyResult(img);
      if(s){
        // Extreme portrait/panorama mismatches still stay fully visible.
        const iw=img.naturalWidth||1,ih=img.naturalHeight||1,sw=img.parentElement?.clientWidth||iw,sh=img.parentElement?.clientHeight||ih;
        const mismatch=Math.max((iw/ih)/(sw/sh),(sw/sh)/(iw/ih));
        if(mismatch<=1.68)r=s;
      }
    }
    img.dataset.smartFit=r.mode||"contain";
    img.style.setProperty("--smart-pos",r.pos||"50% 50%");
  };
  window.c720pScheduleSmartFrame=function(img,frame){
    const run=()=>window.c720pSmartFrame(img,frame);
    img.dataset.smartFit=(frame&&frame.fit==="cover")?"medium":"contain";
    img.style.setProperty("--smart-pos",(frame&&(frame.position||frame.pos||frame.objectPosition))||"50% 50%");
    if(img.complete&&img.naturalWidth)run();else img.addEventListener("load",run,{once:true});
  };
})();
</script>'''

if 'C720P_PHOTO_SMART_FRAME_V93' not in s:
    s=s.replace('</head>',css+'\n'+helper+'\n</head>',1)

# Undo V90's forced one-size-fits-all contain state at the actual image preparation point.
s=s.replace('hidden.style.objectFit="contain";','c720pScheduleSmartFrame(hidden,frame);')
s=s.replace('hidden.dataset.smartFit="contain";','')

# Remove the V90 CSS declarations that hard-force every image to contain/center/zero zoom;
# V93 attribute selectors above now decide per picture.
s=s.replace('object-fit:contain!important;','object-fit:contain!important;',1)  # preserve original base fallback
# We deliberately leave old V90 rules in place as fallback; the higher-specificity V93 selectors override them.

p.write_text(s,encoding='utf-8')
print('SMART_FRAME_PATCH=OK')
print('SCHEDULE_CALLS='+str(s.count('c720pScheduleSmartFrame(hidden,frame)')))
print('BACKUP='+str(BACK))
