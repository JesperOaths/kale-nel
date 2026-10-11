#!/usr/bin/env python3
"""Transactional Home Assistant Security V8:
Today-only recordings, archive unchanged, evidence review, proper face thumbnails,
all-video playback FPS instrumentation. Does not alter phone, media, or database.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import urllib.request

ROOT=Path("/opt/homeassistant/config/www")
BACK=Path("/home/jespern/c720p-home-hub/backups/security-v8")
STAGED=Path("/home/jespern/c720p-home-hub/build/security-v8/security-review-v8.html")
ROOT_PAGE=ROOT/"c720p-surveillance.html"
FACES=ROOT/"frontyard-security-new/face-appearances.html"
TODAY=ROOT/"frontyard-security-new/security-review-v8.html"
MEDIA=ROOT/"frontyard-security-new/security-archive-v7.html"
TRACKS=ROOT/"frontyard-security-new/security-tracks-v7.html"

ROOT_STYLE=r"""<style id="s9v8-tabs-style">
#s9v8-evidence{position:absolute;inset:0;display:none;background:#0c1520;z-index:65;min-width:0;min-height:0}
#s9v8-evidence.s9v8-visible{display:block!important}
#s9v8-evidence iframe{width:100%;height:100%;border:0;background:#0c1520;display:block}
#s9v5-nav button[data-view=evidence][aria-current=page]{background:#21443f!important;color:#effff6!important;border-color:#4b9587!important}
</style>"""
ROOT_JS=r"""<script id="s9v8-tabs-script">
(()=>{
'use strict';
const TODAY='/local/frontyard-security-new/security-review-v8.html?mode=today';
const EVIDENCE='/local/frontyard-security-new/security-review-v8.html?mode=evidence';
function mount(){
 const shell=document.getElementById('s9v5-shell'),nav=document.getElementById('s9v5-nav'),
 stage=document.getElementById('s9v5-stage'),frame=document.getElementById('s9SavedFolderFrame');
 if(!shell||!nav||!stage||!frame)return false;
 // Recordings intentionally shows ONLY today. Original browser is retained on disk
 // as a rollback, while Archive continues showing the full clip catalogue.
 frame.dataset.src=TODAY;
 if(frame.getAttribute('src')!==TODAY)frame.removeAttribute('src');
 let b=nav.querySelector('button[data-view=evidence]');
 if(b)return true;
 b=document.createElement('button');b.type='button';b.dataset.view='evidence';b.title='Evidence & analytics';b.setAttribute('aria-current','false');
 let ico=document.createElement('span');ico.className='s9v5-nav-icon';ico.textContent='▤';
 let label=document.createElement('span');label.className='s9v5-nav-label';label.textContent='Evidence & analytics';b.append(ico,label);
 const tracks=nav.querySelector('button[data-view=tracks]'),archive=nav.querySelector('button[data-view=archive]');
 if(tracks)tracks.insertAdjacentElement('afterend',b);else nav.insertBefore(b,archive||null);
 const pane=document.createElement('section');pane.id='s9v8-evidence';pane.setAttribute('aria-hidden','true');
 const iframe=document.createElement('iframe');iframe.title='Detailed S9+ recording analytics and model evidence';iframe.loading='lazy';iframe.dataset.src=EVIDENCE;
 pane.append(iframe);stage.style.position='relative';stage.append(pane);
 const hide=()=>{pane.classList.remove('s9v8-visible');pane.setAttribute('aria-hidden','true');b.setAttribute('aria-current','false');
  try{iframe.contentWindow?.document.querySelectorAll('video').forEach(v=>v.pause())}catch(_){}};
 nav.addEventListener('click',event=>{if(event.target.closest('button[data-view]')!==b)hide()});
 b.addEventListener('click',()=>{
  nav.querySelector('button[data-view=saved]')?.click();
  shell.dataset.view='evidence';
  nav.querySelectorAll('button[data-view]').forEach(n=>n.setAttribute('aria-current',n===b?'page':'false'));
  const title=document.getElementById('s9v5-title'),sub=document.getElementById('s9v5-subtitle');
  if(title)title.textContent='Evidence & analytics';
  if(sub)sub.textContent='Detector confidence · sampled frames · anonymous clues';
  pane.classList.add('s9v8-visible');pane.setAttribute('aria-hidden','false');
  if(!iframe.src||!iframe.getAttribute('src'))iframe.src=EVIDENCE;
 });
 // Hidden panes must not have active competing decoders when the user
 // changes tabs. This also avoids stutter caused by multiple MP4s running.
 nav.addEventListener('click',event=>{
  const next=event.target.closest('button[data-view]');
  if(!next)return;
  document.querySelectorAll('#s9v5-stage iframe').forEach(f=>{
   if(f===iframe&&next===b)return;
   if(f===frame&&next.dataset.view==='saved')return;
   try{f.contentWindow?.document.querySelectorAll('video').forEach(v=>v.pause())}catch(_){}
  });
 });
 return true;
}
let n=0;const wait=setInterval(()=>{if(mount()||++n>45)clearInterval(wait)},200);
})();
</script>"""

PERFORMANCE_JS=r"""<script id="s9v8-player-performance">
(()=>{
'use strict';
const monitored=new WeakSet();
function hook(video){
 if(monitored.has(video))return;monitored.add(video);
 video.setAttribute('playsinline','');video.preload='metadata';
 const output=document.createElement('div');output.className='s9v8-playback-hud';
 output.style.cssText='font:11px/1.35 system-ui,sans-serif;color:#bdd4e1;padding:6px 3px;min-height:21px';
 video.insertAdjacentElement('afterend',output);
 let frames=0,started=0,active=true;
 const tick=(time,metadata)=>{
  if(!active||!video.isConnected)return;
  if(!video.paused){
   if(!started)started=time;frames++;
   if(time-started>=1500){
    const fps=frames*1000/(time-started),q=video.getVideoPlaybackQuality?.();
    output.textContent='Displayed '+fps.toFixed(1)+' FPS'+(q?' · dropped '+q.droppedVideoFrames:'')+
      (fps>=24?' · ≥24 FPS':' · below 24 FPS target');
    frames=0;started=time;
   }
  }else{started=0;frames=0}
  video.requestVideoFrameCallback(tick);
 };
 if(video.requestVideoFrameCallback)video.requestVideoFrameCallback(tick);
 else output.textContent='Playback FPS unavailable in this browser';
 video.addEventListener('error',()=>output.textContent='Video playback failed · original retained on S9+');
}
const obs=new MutationObserver(()=>document.querySelectorAll('video').forEach(hook));
obs.observe(document.documentElement,{subtree:true,childList:true});
document.querySelectorAll('video').forEach(hook);
document.addEventListener('visibilitychange',()=>{if(document.hidden)document.querySelectorAll('video').forEach(v=>v.pause())});
window.addEventListener('pagehide',()=>{document.querySelectorAll('video').forEach(v=>v.pause())});
})();
</script>"""

def change_face(src):
 marker='id="s9v8-face-thumbnails"'
 if marker in src:return src
 if "function addVisual(card,item){" not in src or "function addTrackClues(card,item){" not in src:
  raise RuntimeError("face_page_unknown")
 start=src.index("function addVisual(card,item){")
 end=src.index("function addTrackClues(card,item){",start)
 repl=r"""function addVisual(card,item){
 const v=make('div',undefined,'visual'),badge=make('span',types[item.kind],'type');v.append(badge);
 // Historical scans may identify a possible person without finding a frontal
 // face; show the actual scene thumbnail, correctly labelled, instead of an
 // empty face placeholder. All 69 known person clips have cached thumbnails.
 const candidate=item.kind==='face'?item.snap:null;
 const scene=String(item.rec.snapshot_name||'');
 const safe=/^(?:motion_[0-9]{13}|rec_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2})[.]mp4[.]thumb[.]jpg$/;
 const fallback=make('small','Thumbnail unavailable · original recording retained');v.append(fallback);
 if(candidate){
  const img=make('img');img.alt='Unverified frontal-face crop from recording';
  img.loading='lazy';img.decoding='async';img.dataset.relayPath='/new/saved/face/'+candidate;
  img.onload=()=>fallback.remove();img.onerror=()=>{
   img.remove();if(safe.test(scene))mountScene();
  };v.append(img);state.observer?.observe(img);
 }else if(safe.test(scene))mountScene();
 function mountScene(){
  const img=make('img');img.alt='Scene thumbnail, not an isolated face or verified identity';
  img.loading='lazy';img.decoding='async';
  img.src='/local/frontyard-security-new/s9-phone-thumbs/'+encodeURIComponent(scene);
  img.onload=()=>fallback.remove();
  img.onerror=()=>img.remove();
  v.append(img);
 }
 card.append(v);
}
"""
 src=src[:start]+repl+src[end:]
 old="const clipOK=/^motion_[0-9]{13}[.]mp4$/;"
 if src.count(old)!=1:raise RuntimeError("face_clip_regex_changed")
 src=src.replace(old,"const clipOK=/^(?:motion_[0-9]{13}|rec_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2})[.]mp4$/;",1)
 old_stamp="function clipStamp(rec){const name=String(rec.clip_no||'');return clipOK.test(name)?Number(name.slice(7,20)):0;}"
 new_stamp="""function clipStamp(rec){const name=String(rec.clip_no||'');
 if(/^motion_[0-9]{13}[.]mp4$/.test(name))return Number(name.slice(7,20));
 const m=name.match(/^rec_([0-9]{4}-[0-9]{2}-[0-9]{2})_([0-9]{2})-([0-9]{2})[.]mp4$/);
 if(m)return Date.parse(m[1]+'T'+m[2]+':'+m[3]+':00+02:00')||0;
 return 0;}"""
 if old_stamp not in src:raise RuntimeError("face_timestamp_changed")
 src=src.replace(old_stamp,new_stamp,1)
 return src.replace("</body>",'<span hidden id="s9v8-face-thumbnails"></span>\n'+PERFORMANCE_JS+"</body>",1)

def update_html(src,marker,css,js):
 if marker in src:return src
 if src.count("</head>")!=1 or src.count("</body>")!=1:raise RuntimeError("unknown_markup")
 return src.replace("</head>",css+"</head>",1).replace("</body>",js+"</body>",1)

def test_local_server(uri):
 with urllib.request.urlopen(uri,timeout=12) as r:
  if r.status!=200:raise RuntimeError("http_"+str(r.status))
  return r.read(1_100_000).decode("utf-8","replace")

def main():
 if not STAGED.is_file():raise RuntimeError("review_template_missing")
 review=STAGED.read_text()
 if 'id="s9v8-review-script"' not in review or 'C720PSecureRelay' not in review:
  raise RuntimeError("review_script_invalid")
 if 'gejast-auth-gate.js' not in review:raise RuntimeError("review_auth_gate_missing")
 if len(review)<14000:raise RuntimeError("review_page_too_small")
 originals={}
 updates={}
 for path in (ROOT_PAGE,FACES,MEDIA,TRACKS):
  if not path.is_file() or path.is_symlink():raise RuntimeError("missing_asset_"+path.name)
  originals[path]=path.read_bytes()
 oldroot=originals[ROOT_PAGE].decode()
 oldfaces=originals[FACES].decode()
 if 's9v7-root-script' not in oldroot or 's9v5-command-script' not in oldroot:
  raise RuntimeError("root_not_current")
 updates[ROOT_PAGE]=update_html(oldroot,"s9v8-tabs-script",ROOT_STYLE,ROOT_JS)
 updates[FACES]=change_face(oldfaces)
 for path in (MEDIA,TRACKS):
  text=originals[path].decode()
  if 's9v8-player-performance' not in text:
   text=text.replace("</body>",PERFORMANCE_JS+"</body>",1)
  updates[path]=text
 if TODAY.exists():originals[TODAY]=TODAY.read_bytes()
 updates[TODAY]=review
 # Face gallery and review share a real local thumbnail route validated by
 # S9 index, without fetching or changing any source video from the phone.
 BACK.mkdir(parents=True,exist_ok=True)
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 backup=BACK/stamp;backup.mkdir(mode=0o700,exist_ok=False)
 for i,(path,original) in enumerate(originals.items()):(backup/(str(i)+'-'+path.name)).write_bytes(original)
 published=[]
 try:
  for path,content in updates.items():
   temp=path.with_name(path.name+".security-v8-stage")
   temp.write_text(content,encoding="utf-8")
   os.chmod(temp,path.stat().st_mode&0o777 if path.exists() else 0o644)
   os.replace(temp,path);published.append(path)
  check=test_local_server('http://127.0.0.1:8123/local/frontyard-security-new/security-review-v8.html?mode=today')
  if 'id="s9v8-review-script"' not in check:raise RuntimeError("today_http_readback")
  check=test_local_server('http://127.0.0.1:8123/local/c720p-surveillance.html')
  if 'id="s9v8-tabs-script"' not in check:raise RuntimeError("nav_http_readback")
  check=test_local_server('http://127.0.0.1:8123/local/frontyard-security-new/face-appearances.html')
  if 'id="s9v8-face-thumbnails"' not in check:raise RuntimeError("face_http_readback")
  print("S9_SECURITY_V8_DEPLOYED",json.dumps({"backup":str(backup),
    "files":[p.name for p in updates],"today_only":True,
    "evidence_separate":True,"all_date_archive_preserved":True,
    "faces_cached_thumbnails":True,"video_fps_instrumented":True,
    "phone_camera_modified":False,"media_deleted":False},sort_keys=True))
 except Exception:
  for path in reversed(published):
   if path in originals:path.write_bytes(originals[path])
   else:path.unlink(missing_ok=True)
  raise

if __name__=="__main__":main()
