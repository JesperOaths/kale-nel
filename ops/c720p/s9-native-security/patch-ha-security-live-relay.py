#!/usr/bin/env python3
"""Keep Home Assistant Security live view working after disabling IP Webcam."""
from pathlib import Path
import datetime,re,shutil
path=Path("/opt/homeassistant/config/www/c720p-surveillance.html")
src=path.read_text()
if "S9_NATIVE_RELAY_MAIN_STREAM_V2" in src:
 print("SECURITY_NATIVE_RELAY_ALREADY_PRESENT");raise SystemExit(0)
a="function streams(on)"
b="function refreshPhoneBatteries()"
start=src.find(a)
end=src.find(b,start)
if start<0 or end<=start or end-start>2300:
 raise RuntimeError("Unexpected live view UI structure, left original untouched")
old=src[start:end]
if "camera.s9_direct" not in old or "startHA" not in old:
 raise RuntimeError("Unknown existing live source, left original untouched")
new=r"""/* S9_NATIVE_RELAY_MAIN_STREAM_V2: private signed LAN relay for standalone Camera2. */
let s9LiveGeneration=0;
async function streams(on){
  const n=$('#cameraLive'),f=$('#cameraFast'),status=$('#cameraStatus');
  const generation=++s9LiveGeneration;
  if(f){f.style.display='none';f.src='about:blank'}
  if(!on){stopImg(n);return}
  if(!n)return;
  if(status){status.textContent='connecting native S9+…';status.className='status'}
  const fallback=()=>{
    if(generation!==s9LiveGeneration)return;
    if(!startHA(n,'camera.s9_direct','#cameraStatus'))
      startHA(n,'camera.s9','#cameraStatus');
  };
  try{
    if(!window.C720PSecureRelay||!C720PSecureRelay.url)throw Error('signed relay unavailable');
    const u=await C720PSecureRelay.url('/new/live.mjpg');
    if(generation!==s9LiveGeneration)return;
    stopImg(n);
    n.dataset.mode='s9-native-4k-mjpeg';
    n.onload=()=>{
      if(generation!==s9LiveGeneration)return;
      if(status){status.textContent='live · native S9+';status.className='status ok'}
    };
    n.onerror=()=>{stopImg(n);fallback()};
    n.src=u+(u.includes('?')?'&':'?')+'v='+Date.now();
    if(status){status.textContent='live · native S9+';status.className='status ok'}
  }catch(e){fallback()}
}
"""
backup=path.with_name(path.name+".before-native-stream-"+datetime.datetime.now().strftime("%Y%m%d%H%M%S"))
shutil.copy2(path,backup)
temp=path.with_suffix(".html.live-tmp")
temp.write_text(src[:start]+new+src[end:])
temp.chmod(path.stat().st_mode&0o777)
temp.replace(path)
print("HA_SECURITY_NATIVE_RELAY_PATCHED",backup)
