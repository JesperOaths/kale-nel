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
