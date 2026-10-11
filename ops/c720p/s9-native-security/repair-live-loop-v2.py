#!/usr/bin/env python3
"""Repair the looping S9+ Live view without touching camera or recorded-video playback.

Publish a stable authenticated native-MJPEG renderer for Live only, preserving
the shared recording player and all S9+ native camera/SD services. Atomic rollback.
"""
import argparse,hashlib,json,os,re,shutil,tempfile
from pathlib import Path
from datetime import datetime,timezone

WWW=Path('/opt/homeassistant/config/www')
BACKUP=Path('/home/jespern/c720p-home-hub/backups/s9-live-stability')
SCRIPT=WWW/'security-video-playback.js'
PAGE=WWW/'c720p-surveillance.html'
OLD_Q='security-video-playback.js?v=C720P_SECURITY_SMOOTH_VIDEO_V1'
NEW_Q='security-video-playback.js?v=C720P_SECURITY_NATIVE_MJPEG_STABLE_V2_20261011'
MARKER='C720P_SECURITY_NATIVE_MJPEG_STABLE_V2'
BEG='async function liveSession(state){'
END='function startLive(img,options={}){'
NEW_LIVE=r'''/* C720P_SECURITY_NATIVE_MJPEG_STABLE_V2:
 * An MP4 MediaSource playback timeline is not a reliable wall-clock live view on
 * this low-power hub. Use the existing authenticated, continuously produced
 * native phone MJPEG stream instead. No extra capture, GPU processing or media
 * transcoding on the C720P. Saved MP4 player stays unchanged.
 */
async function liveSession(state){
 if(state.running||state.retryTimer||!state.wanted||!visible(state.img))return;
 cleanupLive(state);
 state.running=true;
 const generation=state.generation,controller=new AbortController();
 state.abort=controller;
 const current=()=>state.wanted&&state.generation===generation&&!controller.signal.aborted;
 const img=state.img;
 let finished=false;
 function retry(reason){
  if(finished||!current())return;
  finished=true;
  cleanupLive(state);
  // Single bounded retry timer; prevents an image/load/error restart storm.
  liveStatus(state,'Live reconnecting · '+reason);
  state.mjpegRetryDelay=Math.min(30000,Math.max(6000,(state.mjpegRetryDelay||6000)*1.5));
  const expected=state.generation;
  state.retryTimer=setTimeout(()=>{
   state.retryTimer=null;
   if(state.generation===expected&&state.wanted&&visible(state.img))liveSession(state);
  },state.mjpegRetryDelay);
 }
 liveStatus(state,'Connecting live camera…');
 try{
  const client=relay();
  if(typeof client.url!=='function')throw Error('Signed camera relay unavailable');
  const signed=await client.url('/new/live.mjpg');
  if(!current())return;
  // Bypass the shared HTMLImageElement.src interception that normally sends
  // all /new/live.mjpg images back into the looping MP4 player.
  img.dataset.securityProfile='live-mjpeg-native';
  img.onload=()=>{
   if(!current())return;
   state.mjpegRetryDelay=0;
   liveStatus(state,'LIVE · S9+ native camera');
  };
  img.onerror=()=>retry('camera stream interrupted');
  imageSrc.set.call(img,signed);
  const start=Date.now();
  state.watchdog=setInterval(()=>{
   if(!current())return;
   if(img.naturalWidth>0){
    state.mjpegRetryDelay=0;
    liveStatus(state,'LIVE · S9+ native camera');
    clearInterval(state.watchdog);state.watchdog=null;
   }else if(Date.now()-start>16000){
    retry('waiting for first frame');
   }
  },3000);
 }catch(e){
  if(current())retry('temporary connection issue');
 }
}
'''
def patch_js(original):
 if MARKER in original:
  if original.count(MARKER)!=1 or 'imageSrc.set.call(img,signed)' not in original:
   raise ValueError('partial_mjpeg_upgrade')
  return original
 if original.count(BEG)!=1 or original.count(END)!=1:
  raise ValueError('unexpected_live_controller')
 i=original.index(BEG);j=original.index(END,i)
 old=original[i:j]
 if not (4000<len(old)<9500 and "/new/live.mp4" in old and "source.addSourceBuffer(mime)" in old):
  raise ValueError('unrecognized_h264_live_controller')
 if 'const imageSrc=Object.getOwnPropertyDescriptor(image,' not in original:
  raise ValueError('missing_original_image_setter')
 if 'nativeRemove.call(state.img,' not in original:raise ValueError('missing_live_cleanup')
 # Clear previous MJPEG handlers before replacing/restarting the native stream.
 updated=original.replace(
   "nativeRemove.call(state.img,'src');state.img.style.display=state.previousDisplay||'';state.running=false;",
   "state.img.onload=null;state.img.onerror=null;nativeRemove.call(state.img,'src');state.img.style.display=state.previousDisplay||'';state.running=false;",1)
 if updated==original:raise ValueError('cleanup_not_found')
 i=updated.index(BEG);j=updated.index(END,i)
 return updated[:i]+NEW_LIVE+updated[j:]

def patch_page(original):
 if original.count(NEW_Q)==1 and OLD_Q not in original:return original
 if original.count(OLD_Q)!=1:raise ValueError('unknown_html_script_version')
 for a in ['id="cameraLive"','id="s9v7-root-script"','id="s9v6-security-script"']:
  if a not in original:raise ValueError('missing_security_page_'+a)
 return original.replace(OLD_Q,NEW_Q,1)

def upgrade(root,backups,apply=False):
 a=root/'security-video-playback.js';b=root/'c720p-surveillance.html'
 if not a.is_file() or not b.is_file() or a.is_symlink() or b.is_symlink():raise ValueError('missing_pages')
 old={a:a.read_text(),b:b.read_text()}
 new={a:patch_js(old[a]),b:patch_page(old[b])}
 for p,patch in [(a,patch_js),(b,patch_page)]:
  if patch(new[p])!=new[p]:raise RuntimeError('non_idempotent_'+p.name)
 if not apply:return {'dry_run':True,'changed':{p.name:old[p]!=new[p] for p in old},
    'native_mjpeg':True,'camera_modified':False}
 if all(old[p]==new[p] for p in old):return {'already_installed':True}
 folder=backups/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
 folder.mkdir(parents=True,exist_ok=False);os.chmod(folder,0o700)
 written=[]
 try:
  for p in (a,b):
   dst=folder/p.name;shutil.copy2(p,dst);os.chmod(dst,0o600)
   if dst.read_text()!=old[p]:raise RuntimeError('backup_readback_failed')
  for p in (a,b):
   if old[p]==new[p]:continue
   fd,name=tempfile.mkstemp(prefix='.s9-live-stable-',dir=p.parent);os.close(fd)
   tmp=Path(name)
   try:
    tmp.write_text(new[p]);st=p.stat()
    os.chmod(tmp,st.st_mode&0o777)
    try:os.chown(tmp,st.st_uid,st.st_gid)
    except PermissionError:pass
    if tmp.read_text()!=new[p]:raise RuntimeError('stage_mismatch')
    os.replace(tmp,p);written.append(p)
   finally:tmp.unlink(missing_ok=True)
  for p in (a,b):
   if p.read_text()!=new[p]:raise RuntimeError('postwrite_mismatch')
 except BaseException:
  for p in reversed(written):
   fd,name=tempfile.mkstemp(prefix='.s9-live-restore-',dir=p.parent);os.close(fd)
   tmp=Path(name)
   try:
    shutil.copy2(folder/p.name,tmp);os.replace(tmp,p)
   finally:tmp.unlink(missing_ok=True)
  raise
 return {'deployed':True,'backup':str(folder),
   'sha256':{p.name:hashlib.sha256(new[p].encode()).hexdigest() for p in (a,b)},
   'recorder_modified':False,'microSD_modified':False,'saved_video_player_modified':False}

if __name__=='__main__':
 cli=argparse.ArgumentParser()
 cli.add_argument('--root',type=Path,default=WWW)
 cli.add_argument('--backup-root',type=Path,default=BACKUP)
 cli.add_argument('--apply',action='store_true')
 opts=cli.parse_args()
 print('S9_LIVE_STABLE',json.dumps(upgrade(opts.root,opts.backup_root,opts.apply),sort_keys=True),flush=True)
