#!/usr/bin/env python3
"""Fix Security Live MJPEG being torn down every second.

Only patches existing native S9+ signed-relay view. No camera or Android
settings, SD recordings, retained clips, or other Home dashboard resources.
"""
import argparse
import os
from pathlib import Path

MARKER="S9_NATIVE_RELAY_MAIN_STREAM_V3_RETAIN_MJPEG"
WWW=Path("/opt/homeassistant/config/www")
SECURITY=WWW/"c720p-surveillance.html"
def patch(s):
 if MARKER in s:return s
 if s.count("S9_NATIVE_RELAY_MAIN_STREAM_V2")!=1 or s.count("async function streams(on){")!=1:
  raise ValueError("existing_native_security_live_contract_missing")
 old="""async function streams(on){
  const n=$('#cameraLive'),f=$('#cameraFast'),status=$('#cameraStatus');
  const generation=++s9LiveGeneration;"""
 new="""/* S9_NATIVE_RELAY_MAIN_STREAM_V3_RETAIN_MJPEG */
let s9LiveConnectStarted=0;
async function streams(on){
  const n=$('#cameraLive'),f=$('#cameraFast'),status=$('#cameraStatus');
  // A stable MJPEG connection must outlive the browser's first decoded frame.
  // Native frames normally load quickly, but reconnect after 12 s if stalled.
  if(on && n && n.dataset.mode==='s9-native-4k-mjpeg' && n.getAttribute('src')
     && (n.naturalWidth>0 || Date.now()-s9LiveConnectStarted<12000))return;
  const generation=++s9LiveGeneration;"""
 if s.count(old)!=1:raise ValueError("unexpected_live_streams_function")
 s=s.replace(old,new,1)
 old_loop="""setInterval(()=>{enforceRoute();if(active==='live'&&securityRouteActive())streams(true)},1000);"""
 new_loop="""setInterval(enforceRoute,1000);"""
 if s.count(old_loop)!=1:raise ValueError("double_live_watchdog_contract_changed")
 s=s.replace(old_loop,new_loop,1)
 old_src="""    n.src=u+(u.includes('?')?'&':'?')+'v='+Date.now();
    if(status){status.textContent='live · native S9+';status.className='status ok'}"""
 new_src="""    s9LiveConnectStarted=Date.now();
    n.src=u+(u.includes('?')?'&':'?')+'v='+s9LiveConnectStarted;
    if(status && n.naturalWidth===0){status.textContent='waiting for native S9+ frames…';status.className='status'}"""
 if s.count(old_src)!=1:raise ValueError("native_live_src_pattern_changed")
 s=s.replace(old_src,new_src,1)
 if s.count("n.onload=()=>{")!=1 or "status.textContent='live · native S9+'" not in s:
  raise ValueError("native_first_frame_indicator_changed")
 return s

if __name__=="__main__":
 a=argparse.ArgumentParser();a.add_argument("--file",type=Path,default=SECURITY)
 args=a.parse_args()
 original=args.file.read_text()
 updated=patch(original)
 if updated!=original:
  staged=args.file.with_name(args.file.name+".s9-mjpeg-v3-stage")
  staged.write_text(updated);os.chmod(staged,args.file.stat().st_mode&0o777)
  os.replace(staged,args.file)
 print("S9_SECURITY_LIVE_MJPEG_STABLE", "already_present" if updated==original else "patched")
