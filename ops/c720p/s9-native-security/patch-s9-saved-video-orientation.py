#!/usr/bin/env python3
"""Non-destructive orientation controls for all Saved Clips HTML5 MP4 players.

This edits ONLY the Home Assistant Security HTML. Original MP4 files,
verified manifests, thumbnails, archive APIs and Camera2 are untouched.
Each corrected angle is stored in this browser's localStorage, per MP4 name.
A separate operator-approved remux is required to change file metadata.
"""
import argparse
from datetime import datetime, timezone
import os
from pathlib import Path
import shutil

STYLE = 'id="s9-video-orientation-style-v1"'
SCRIPT = 'id="s9-video-orientation-script-v1"'
SNIPPET = r'''
<style id="s9-video-orientation-style-v1">
.s9-rotation-shell{width:100%;max-width:100%;margin:8px 0 12px;min-width:0}
.s9-rotation-bar{display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin:6px 0;font-size:12px;color:#dceef8}
.s9-rotation-bar button{font:inherit;color:#f2f9ff;background:#29516b;border:1px solid #6d9db8;border-radius:7px;padding:6px 9px;cursor:pointer}
.s9-rotation-bar button:focus-visible{outline:2px solid #b4e9ff;outline-offset:2px}
.s9-rotation-bar .s9-rotation-label{font-size:12px;color:#c1dae9;overflow-wrap:anywhere}
.s9-rotation-stage{position:relative;margin:7px auto;overflow:hidden;max-width:100%;background:#000;border-radius:6px}
.s9-rotation-stage video{position:absolute!important;top:50%!important;left:50%!important;
  max-width:none!important;max-height:none!important;object-fit:fill!important;
  margin:0!important}
</style>
<script id="s9-video-orientation-script-v1">
(()=>{
 'use strict';
 const PREFIX='c720p-security-playback-rotation-v1:';
 const FILE=/(?:motion_[0-9]{13}|native4k_[0-9]{13}|rec_20[0-9]{2}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}|[a-zA-Z0-9_-]{2,100})[.]mp4(?=$|[^a-zA-Z0-9_.-])/;
 const states=new WeakMap();
 const active=new Set();
 function getName(video){
  const explicit=String(video.dataset.s9OrientationClip||'');
  if(FILE.test(explicit))return explicit.match(FILE)[0];
  // The authenticated URL can carry a volatile signature. Persist ONLY the
  // MP4 basename, never the relay token, full URL or signed query string.
  let src=video.getAttribute('src')||video.querySelector('source')?.getAttribute('src')||video.currentSrc||'';
  try{src=decodeURIComponent(src)}catch(_){}
  const match=String(src).match(FILE);
  return match?match[0]:null;
 }
 function restored(name){
  if(!name)return 0;
  try{
   const value=localStorage.getItem(PREFIX+name);
   if(value===null)return 0;
   const angle=Number(value);
   return [0,90,180,270].includes(angle)?angle:0;
  }catch(_){return 0}
 }
 function save(name,angle){
  if(!name)return false;
  try{localStorage.setItem(PREFIX+name,String(angle));return true}
  catch(_){return false}
 }
 function setView(state){
  const v=state.video;
  const w=Math.max(1,Number(v.videoWidth)||1280);
  const h=Math.max(1,Number(v.videoHeight)||720);
  const quarter=state.angle===90||state.angle===270;
  const outerW=quarter?h:w,outerH=quarter?w:h;
  const maxW=Math.max(120,Math.min(state.shell.getBoundingClientRect().width||
    (document.documentElement.clientWidth||800)*.88,1100));
  const maxH=Math.max(130,Math.min((window.innerHeight||800)*.68,760));
  const factor=Math.min(maxW/outerW,maxH/outerH);
  const n=x=>Math.max(1,Math.round(x*factor))+'px';
  state.stage.style.width=n(outerW);
  state.stage.style.height=n(outerH);
  v.style.setProperty('width',n(w),'important');
  v.style.setProperty('height',n(h),'important');
  v.style.setProperty('transform','translate(-50%,-50%) rotate('+state.angle+'deg)','important');
  state.bar.hidden=!(v.getAttribute('src')||v.currentSrc||v.querySelector('source'));
  state.label.textContent='Display correction '+state.angle+'° · '+
   (state.name?(state.persisted?'saved in this browser':'browser storage unavailable'):'this viewing only; filename unavailable');
 }
 function refresh(state){
  const name=getName(state.video);
  const source=String(state.video.getAttribute('src')||state.video.currentSrc||'');
  if(name!==state.name || (!name && source!==state.source)){
   state.name=name;
   state.angle=restored(name);
   state.persisted=Boolean(name);
  }
  state.source=source;
  setView(state);
 }
 function attach(video){
  if(states.has(video))return;
  // Only actual user-facing media players; leave snapshots and MJPEG alone.
  if(!video.controls)return;
  const parent=video.parentNode;
  if(!parent)return;
  const shell=document.createElement('div');shell.className='s9-rotation-shell';
  const bar=document.createElement('div');bar.className='s9-rotation-bar';
  bar.setAttribute('role','group');bar.setAttribute('aria-label','Saved clip display orientation');
  const label=document.createElement('span');label.className='s9-rotation-label';
  function button(text,change){
   const el=document.createElement('button');el.type='button';el.textContent=text;
   el.addEventListener('click',()=>change());bar.append(el);
  }
  const stage=document.createElement('div');stage.className='s9-rotation-stage';
  const state={video,shell,bar,stage,label,name:null,source:'',angle:0,persisted:false};
  button('↶ 90°',()=>turn(state,-90));
  button('↷ 90°',()=>turn(state,90));
  button('Reset',()=>turn(state,0,true));
  bar.append(label);
  parent.insertBefore(shell,video);
  shell.append(bar,stage);stage.append(video);
  states.set(video,state);active.add(state);
  video.addEventListener('loadedmetadata',()=>refresh(state));
  video.addEventListener('loadstart',()=>refresh(state));
  refresh(state);
 }
 function turn(state,delta,reset=false){
  refresh(state);
  state.angle=reset?0:(state.angle+delta+360)%360;
  state.persisted=save(state.name,state.angle);
  setView(state);
 }
 function scan(){
  for(const video of document.querySelectorAll('video[controls]')){
   if(!states.has(video))attach(video);
   else refresh(states.get(video));
  }
  // Avoid growing a retained set after dialogs are closed and removed.
  for(const state of active){
   if(!state.video.isConnected)active.delete(state);
  }
 }
 const observer=new MutationObserver(scan);
 observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
 window.addEventListener('resize',()=>{
  for(const state of active)if(state.video.isConnected)setView(state);
 });
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan,{once:true});
 else scan();
})();
</script>
'''

def patch(html: str) -> str:
    if html.count("</body>") != 1 or html.count('id="list"') != 1:
        raise ValueError("unrecognized_security_clips_page")
    if "/local/c720p-secure-relay-client.js" not in html:
        raise ValueError("signed_relay_required")
    if (STYLE in html) != (SCRIPT in html):
        raise ValueError("partially_installed_orientation_widget")
    if STYLE in html:
        if html.count(STYLE) != 1 or html.count(SCRIPT) != 1:
            raise ValueError("duplicated_orientation_widget")
        return html
    return html.replace("</body>", SNIPPET+"\n</body>", 1)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--page", type=Path, default=Path(
        "/opt/homeassistant/config/www/frontyard-security-new/clips.html"))
    parser.add_argument("--apply", action="store_true",
        help="Explicitly create rollback backup and apply HTML-only patch.")
    args=parser.parse_args()
    before=args.page.read_text()
    after=patch(before)
    if patch(after)!=after:
        raise RuntimeError("orientation_patch_not_idempotent")
    if not args.apply:
        print("S9_ORIENTATION_DRY_RUN changed=", before!=after)
        return
    if before==after:
        print("S9_ORIENTATION_ALREADY_PRESENT")
        return
    stamp=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup_root=Path("/home/jespern/c720p-home-hub/backups/s9-orientation")
    backup_root.mkdir(parents=True,exist_ok=True)
    backup=backup_root/("clips.html.before-orientation-"+stamp)
    shutil.copy2(args.page,backup)
    os.chmod(backup,0o600)
    stage=args.page.with_name(args.page.name+".orientation-stage")
    try:
        stage.write_text(after)
        os.chmod(stage,args.page.stat().st_mode & 0o777)
        if stage.read_text()!=after:
            raise RuntimeError("staged_orientation_integrity_error")
        os.replace(stage,args.page)
        if patch(args.page.read_text())!=after:
            raise RuntimeError("orientation_post_write_validation_failed")
    except Exception:
        stage.unlink(missing_ok=True)
        shutil.copy2(backup,args.page)
        raise
    print("S9_ORIENTATION_HTML_ONLY_DEPLOYED", "rollback_backup="+str(backup),
          "recordings_modified=False", "archive_restarted=False")

if __name__=="__main__":
    main()
