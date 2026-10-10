#!/usr/bin/env python3
"""S9+ Home Assistant live camera: authenticated MJPEG with streaming-fetch fallback.

HTML-only patch to the existing Security Live tab. Avoids relying on removed
IP Webcam Home Assistant entities. On-image authentication/decode failure,
uses the SAME signed relay with its authenticated fetch method, parses a
bounded MJPEG stream, and renders individual JPEG frames. Never exposes
relay credentials, modifies the camera, or touches archived MP4s.
"""
import argparse
from datetime import datetime,timezone
import os
from pathlib import Path
import shutil

MARKER='S9_SECURITY_LIVE_V4_AUTHENTICATED_MJPEG_FETCH_FALLBACK'
WWW=Path('/opt/homeassistant/config/www')
SECURITY=WWW/'c720p-surveillance.html'
BEGIN='/* S9_NATIVE_RELAY_MAIN_STREAM_V2:'
END='function refreshPhoneBatteries()'

JS=r'''/* S9_SECURITY_LIVE_V4_AUTHENTICATED_MJPEG_FETCH_FALLBACK */
let s9LiveGeneration=0;
let s9LiveBusy=false,s9LiveAbort=null,s9LiveRetryTimer=null,s9LiveWatchdog=null;
let s9LiveObjectURL='',s9LiveMode='';
const s9LiveStatus=(message,cls='')=>{
 const status=document.getElementById('cameraStatus');
 if(status){status.textContent=message;status.className='status'+(cls?' '+cls:'')}
};
function s9LiveStop(){
 s9LiveGeneration++;
 if(s9LiveAbort){s9LiveAbort.abort();s9LiveAbort=null}
 if(s9LiveRetryTimer){clearTimeout(s9LiveRetryTimer);s9LiveRetryTimer=null}
 if(s9LiveWatchdog){clearTimeout(s9LiveWatchdog);s9LiveWatchdog=null}
 const img=document.getElementById('cameraLive');
 if(img){img.onload=null;img.onerror=null;img.removeAttribute('src');delete img.dataset.mode}
 if(s9LiveObjectURL){URL.revokeObjectURL(s9LiveObjectURL);s9LiveObjectURL=''}
 s9LiveBusy=false;s9LiveMode='';
}
function s9LiveRetry(gen,why){
 if(gen!==s9LiveGeneration||active!=='live')return;
 s9LiveStatus('S9+ live relay reconnecting · '+why);
 if(s9LiveRetryTimer)clearTimeout(s9LiveRetryTimer);
 s9LiveRetryTimer=setTimeout(()=>{
  s9LiveRetryTimer=null;
  if(gen!==s9LiveGeneration||active!=='live')return;
  s9LiveStop();
  streams(true);
 },4500);
}
function s9ShowFetchedFrame(frame,gen){
 if(gen!==s9LiveGeneration||active!=='live')return;
 const img=document.getElementById('cameraLive');
 if(!img)return;
 const next=URL.createObjectURL(new Blob([frame],{type:'image/jpeg'}));
 const previous=s9LiveObjectURL;
 s9LiveObjectURL=next;
 img.onload=()=>{
  if(gen!==s9LiveGeneration)return;
  s9LiveStatus('LIVE · S9+ native camera · authenticated stream','ok');
  if(previous)URL.revokeObjectURL(previous);
 };
 img.onerror=()=>{
  if(previous)URL.revokeObjectURL(previous);
  s9LiveStatus('S9+ live JPEG decode failed · retrying');
 };
 img.src=next;img.dataset.mode='s9-authenticated-jpeg';
}
async function s9FetchMjpeg(gen){
 const relay=window.C720PSecureRelay;
 if(!relay?.fetch)throw Error('authenticated relay not available');
 const abort=new AbortController();s9LiveAbort=abort;
 const resp=await relay.fetch('/new/live.mjpg',{signal:abort.signal,cache:'no-store'});
 if(!resp.ok)throw Error('stream HTTP '+resp.status);
 if(!String(resp.headers.get('Content-Type')||'').includes('multipart/x-mixed-replace'))
  throw Error('unexpected media type');
 if(!resp.body?.getReader)throw Error('streaming fetch unavailable');
 const reader=resp.body.getReader();
 let buf=new Uint8Array(0),lastFrame=0;
 try{
  while(gen===s9LiveGeneration && active==='live' && !abort.signal.aborted){
   const {done,value}=await reader.read();
   if(done)throw Error('relay stream ended');
   if(!value?.length)continue;
   const merged=new Uint8Array(Math.min(buf.length+value.length,900000));
   if(buf.length+value.length<=900000){
    merged.set(buf);merged.set(value,buf.length);
   }else{
    const last=Math.min(buf.length,150000),tail=Math.min(value.length,650000);
    merged.set(buf.slice(buf.length-last),0);
    merged.set(value.slice(value.length-tail),last);
   }
   buf=merged;
   while(buf.length>3){
    let start=-1,end=-1;
    for(let i=0;i<buf.length-1;i++){
     if(buf[i]===255&&buf[i+1]===216){start=i;break}
    }
    if(start<0){buf=buf.slice(-1);break}
    for(let j=start+2;j<buf.length-1;j++){
     if(buf[j]===255&&buf[j+1]===217){end=j+2;break}
    }
    if(end<0){buf=buf.slice(start);break}
    const now=Date.now();
    if(now-lastFrame>=650){
     s9ShowFetchedFrame(buf.slice(start,end),gen);
     lastFrame=now;
    }
    buf=buf.slice(end);
   }
  }
 }finally{
  try{await reader.cancel()}catch(_){}
 }
}
async function s9StartFetchFallback(gen){
 if(gen!==s9LiveGeneration||active!=='live')return;
 s9LiveMode='fetch';s9LiveStatus('Connecting authenticated S9+ live frames…');
 const img=document.getElementById('cameraLive');
 if(img){img.onerror=null;img.onload=null;img.removeAttribute('src')}
 try{await s9FetchMjpeg(gen)}
 catch(err){
  if(gen!==s9LiveGeneration||active!=='live')return;
  const message=String(err?.message||'connection failed').slice(0,100);
  s9LiveRetry(gen,message);
 }
}
async function streams(on){
 if(!on){
  if(s9LiveMode||s9LiveBusy||s9LiveObjectURL)s9LiveStop();
  return;
 }
 if(s9LiveBusy||s9LiveMode||s9LiveRetryTimer)return;
 const img=document.getElementById('cameraLive');
 if(!img)return;
 s9LiveBusy=true;
 const gen=++s9LiveGeneration;
 s9LiveStatus('Connecting native S9+ camera…');
 const fast=document.getElementById('cameraFast');
 if(fast){fast.style.display='none';fast.src='about:blank'}
 try{
  if(!window.C720PSecureRelay?.url)throw Error('signed relay client unavailable');
  const url=await window.C720PSecureRelay.url('/new/live.mjpg');
  if(gen!==s9LiveGeneration||active!=='live')return;
  s9LiveMode='image';
  img.onload=()=>{
   if(gen!==s9LiveGeneration)return;
   if(s9LiveWatchdog){clearTimeout(s9LiveWatchdog);s9LiveWatchdog=null}
   s9LiveStatus('LIVE · S9+ native camera','ok');
  };
  img.onerror=()=>{
   if(gen!==s9LiveGeneration)return;
   if(s9LiveWatchdog){clearTimeout(s9LiveWatchdog);s9LiveWatchdog=null}
   s9StartFetchFallback(gen);
  };
  img.dataset.mode='s9-native-signed-mjpeg';
  img.src=url;
  s9LiveWatchdog=setTimeout(()=>{
   s9LiveWatchdog=null;
   if(gen===s9LiveGeneration&&active==='live'&&
      s9LiveMode==='image'&&img.naturalWidth===0)
    s9StartFetchFallback(gen);
  },9000);
 }catch(err){
  if(gen!==s9LiveGeneration||active!=='live')return;
  s9LiveMode='fetch';
  s9LiveStatus('S9+ signed image unavailable · trying authenticated stream');
  await s9StartFetchFallback(gen);
 }finally{s9LiveBusy=false}
}
'''

def patch(original):
    if original.count('</body>')!=1 or 'id="cameraLive"' not in original or "id=\"cameraStatus\"" not in original:
        raise ValueError('unknown_security_live_page')
    if MARKER in original:return original
    i=original.find(BEGIN)
    j=original.find(END,i)
    if i<0 or j<i or j-i>7500:
        raise ValueError('known_signed_relay_streams_contract_not_found')
    prior=original[i:j]
    for expected in ['async function streams(on){','/new/live.mjpg','S9_NATIVE_RELAY_MAIN_STREAM_V3_RETAIN_MJPEG']:
        if expected not in prior:raise ValueError('unexpected_prior_live_player')
    return original[:i]+JS+original[j:]

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--page',type=Path,default=SECURITY)
    p.add_argument('--apply',action='store_true')
    a=p.parse_args()
    old=a.page.read_text()
    new=patch(old)
    if patch(new)!=new:raise RuntimeError('live_patch_not_idempotent')
    if not a.apply:
        print('S9_SECURITY_LIVE_V4_DRY_RUN',old!=new);return
    if new==old:
        print('S9_SECURITY_LIVE_V4_ALREADY_PRESENT');return
    backup_root=Path('/home/jespern/c720p-home-hub/backups/s9-live-v4')
    backup_root.mkdir(parents=True,exist_ok=True)
    timestamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    back=backup_root/('c720p-surveillance.before-live-v4-'+timestamp+'.html')
    shutil.copy2(a.page,back);os.chmod(back,0o600)
    stage=a.page.with_name(a.page.name+'.s9-live-v4-stage')
    replaced=False
    try:
        stage.write_text(new);os.chmod(stage,a.page.stat().st_mode&0o777)
        if stage.read_text()!=new:raise RuntimeError('staging_mismatch')
        os.replace(stage,a.page);replaced=True
        if patch(a.page.read_text())!=new:raise RuntimeError('post_install_mismatch')
    except Exception:
        stage.unlink(missing_ok=True)
        if replaced:
            temp=a.page.with_name(a.page.name+'.s9-live-v4-rollback')
            shutil.copy2(back,temp);os.replace(temp,a.page)
        raise
    print('S9_SECURITY_LIVE_V4_DEPLOYED',str(back),
          'camera_restarted=False','existing_MP4s_modified=False')

if __name__=='__main__':
    main()
