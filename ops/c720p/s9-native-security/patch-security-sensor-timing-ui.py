#!/usr/bin/env python3
"""Add read-only S9+ sensor FPS/exposure status beneath Security live image.

The Camera2 app supplies sensor metadata; the C720P only forwards JSON via
the already-authenticated relay. No extra camera session, JPEG decoder,
model execution or storage of user images occurs on the hub.
"""
import argparse
from datetime import datetime,timezone
from pathlib import Path
import os,shutil

PAGE=Path('/opt/homeassistant/config/www/c720p-surveillance.html')
MARKER='id="s9-sensor-exposure-telemetry-v1"'
SCRIPT=r'''<script id="s9-sensor-exposure-telemetry-v1">
(()=>{
 'use strict';
 const id='s9-sensor-fps-and-exposure';
 function mount(){
  const target=document.querySelector('#panel-live .c720p-s9-live-only');
  if(!target)return null;
  let el=document.getElementById(id);
  if(el)return el;
  el=document.createElement('aside');el.id=id;
  el.style.cssText='color:#ddeefa;background:#10212ccc;border:1px solid #406175;border-radius:10px;padding:11px 14px;margin:12px 0;line-height:1.5;font-size:14px;';
  el.setAttribute('aria-live','off');
  el.textContent='S9+ sensor timing: waiting for camera data…';
  target.append(el);
  return el;
 }
 const formatted=(x,digits=1)=>x==null?'not measurable':Number(x).toFixed(digits);
 async function update(){
  const el=mount();if(!el||!window.C720PSecureRelay?.fetch)return;
  const live=document.getElementById('panel-live');
  if(!live?.classList.contains('active'))return;
  try{
   const response=await window.C720PSecureRelay.fetch('/new/api/live-person-watch',{cache:'no-store'});
   if(!response.ok)throw new Error('status_unavailable');
   const data=await response.json(), sensor=data.camera_sensor;
   if(!data.ok||!sensor||sensor.fps==null){
    el.textContent='S9+ sensor timing not yet available on the installed camera version.';
    return;
   }
   const items=[
    'Sensor '+formatted(sensor.fps)+' FPS',
    'Exposure '+formatted(sensor.exposure_ms)+' ms',
    'Frame duration '+formatted(sensor.frame_duration_ms)+' ms',
    'ISO '+formatted(sensor.iso,0),
    'AE '+(sensor.ae_state||'unknown')
   ];
   if(sensor.ae_target_fps_min!=null&&sensor.ae_target_fps_max!=null)
    items.push('AE target '+sensor.ae_target_fps_min+'–'+sensor.ae_target_fps_max+' FPS');
   const note=sensor.long_exposure?
    ' · Low-light exposure is long enough to restrict smooth sensor capture; changing playback resolution will not fix this.':'';
   el.textContent='S9+ on-device camera: '+items.join(' · ')+note;
  }catch(_){el.textContent='S9+ sensor timing temporarily unavailable.';}
 }
 const observer=new MutationObserver(()=>{if(!document.getElementById(id))mount();});
 if(document.body)observer.observe(document.body,{childList:true,subtree:false});
 mount();update();setInterval(update,10000);
})();
</script>'''

def patch(html):
    if MARKER in html:
        if html.count(MARKER)!=1:raise ValueError('duplicate_sensor_diagnostics')
        return html
    for required in ('id="panel-live"','id="cameraLive"',
                     's9-live-scroll-and-frame-fps-v1',
                     'S9_SECURITY_LIVE_V4_AUTHENTICATED_MJPEG_FETCH_FALLBACK'):
        if required not in html:raise ValueError('missing_security_contract_'+required)
    if html.count('</body>')!=1:raise ValueError('unexpected_HTML_body')
    return html.replace('</body>',SCRIPT+'\n</body>',1)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--page',type=Path,default=PAGE)
    ap.add_argument('--apply',action='store_true')
    args=ap.parse_args()
    old=args.page.read_text()
    new=patch(old)
    if patch(new)!=new:raise RuntimeError('not_idempotent')
    if not args.apply:
        print('S9_SENSOR_TELEMETRY_HTML_DRY_RUN',old!=new)
        return
    if old==new:
        print('S9_SENSOR_TELEMETRY_ALREADY_ACTIVE')
        return
    back=Path('/home/jespern/c720p-home-hub/backups/s9-security-ui-repair')
    back.mkdir(parents=True,exist_ok=True)
    backup=back/('surveillance.before-sensor-fps.'+
        datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.html')
    shutil.copy2(args.page,backup);os.chmod(backup,0o600)
    staged=args.page.with_name(args.page.name+'.sensor-fps-stage')
    wrote=False
    try:
        staged.write_text(new);os.chmod(staged,args.page.stat().st_mode&0o777)
        if staged.read_text()!=new:raise RuntimeError('staging_failed')
        os.replace(staged,args.page);wrote=True
        if patch(args.page.read_text())!=new:raise RuntimeError('postwrite_mismatch')
    except Exception:
        staged.unlink(missing_ok=True)
        if wrote:
            rolled=args.page.with_name(args.page.name+'.sensor-fps-rollback')
            shutil.copy2(backup,rolled);os.replace(rolled,args.page)
        raise
    print('S9_SENSOR_TELEMETRY_ON_SECURITY_LIVE_ACTIVE',
        'backup='+str(backup),'camera_restart=False','original_media_changed=False')

if __name__=='__main__':
    main()
