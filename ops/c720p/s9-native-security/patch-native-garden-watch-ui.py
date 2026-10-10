#!/usr/bin/env python3
"""Security page: show S9+ GPU garden-person status, not stale C720P AI."""
import argparse
from datetime import datetime,timezone
import os
from pathlib import Path
import shutil

PAGE=Path('/opt/homeassistant/config/www/frontyard-security-new/clips.html')
MARKER='S9_PHONE_GPU_GARDEN_UI_V2'
REPL={
 "S9+ live person & motion sensing":"S9+ front-garden person detection · on-phone GPU",
 "Private, read-only preview classification. Motion comes from the phone; person, vehicle and animal labels are unverified AI candidates. Never a verified person identity.":
  "The S9+ checks people only after front-garden motion. All image inference runs on the phone. Road vehicles are excluded from video triggers. Scores are uncalibrated AI candidates, not verified identities.",
 "no_object_detected:'No confident object detection in sampled preview',":
  "no_object_detected:'No confirmed garden-person trigger in the latest check',\n   garden_waiting_for_motion:'Watching garden · waiting for eligible motion',",
 "sensor_unavailable:'Live camera person classifier unavailable'":
  "sensor_unavailable:'Phone garden-person detector unavailable'",
 "const score=Number(data.status.person_score||0),vehicle=Number(data.status.vehicle_score||0),animal=Number(data.status.animal_score||0);":
  "const score=data.status.person_score===null?'Not checked recently':Math.round(Number(data.status.person_score||0)*100)+'%';\n    const checks=Number(data.status.person_checks||0),matches=Number(data.status.person_matches||0);",
 "stats[0].textContent='Person score '+Math.round(score*100)+'% · Vehicles '+Math.round(vehicle*100)+'% · Animals '+Math.round(animal*100)+'% · People detected in frame '+(data.status.simultaneous_people||0);":
  "stats[0].textContent='Person confidence '+score+' · On-phone checks '+checks+' · Person candidates '+matches+' · Garden zone '+(data.garden_zone||'unknown');",
 "stats[1].textContent='Camera '+(data.camera_mode||'unknown')+' · Temp '+(data.camera_temperature_c??'?')+'°C · Sample age '+Math.round(data.last_sample_age_ms/1000)+'s · Brightness/motion are checked on the S9+';":
  "stats[1].textContent='Camera '+(data.camera_mode||'unknown')+' · Temp '+(data.camera_temperature_c??'?')+'°C · GPU inference on S9+ · Last garden check '+(data.model_check_age_ms===null?'not yet available':Math.round(data.model_check_age_ms/1000)+'s ago');"
}

def patch(html):
    if MARKER in html:return html
    if html.count('</body>')!=1 or 'id="s9-live-person-watch-script-v1"' not in html:
        raise ValueError('unknown_live_person_security_widget')
    for old,new in REPL.items():
        if html.count(old)!=1:raise ValueError('source_widget_changed: '+old[:45])
        html=html.replace(old,new,1)
    return html.replace('</body>','<!-- '+MARKER+' -->\n</body>',1)

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--page',type=Path,default=PAGE)
    p.add_argument('--apply',action='store_true')
    args=p.parse_args()
    before=args.page.read_text()
    after=patch(before)
    if patch(after)!=after:raise RuntimeError('non_idempotent_status_widget')
    if not args.apply:
        print('S9_PHONE_GPU_STATUS_UI_DRY_RUN',before!=after);return
    if after==before:
        print('S9_PHONE_GPU_STATUS_UI_ALREADY_INSTALLED');return
    backdir=Path('/home/jespern/c720p-home-hub/backups/s9-security-ui-repair')
    backdir.mkdir(parents=True,exist_ok=True)
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup=backdir/('clips.before-phone-gpu-watch.'+stamp+'.html')
    shutil.copy2(args.page,backup);os.chmod(backup,0o600)
    stage=args.page.with_name(args.page.name+'.native-garden-status-stage')
    changed=False
    try:
        stage.write_text(after)
        os.chmod(stage,args.page.stat().st_mode&0o777)
        if stage.read_text()!=after:raise RuntimeError('staged_HTML_mismatch')
        os.replace(stage,args.page);changed=True
        if patch(args.page.read_text())!=after:raise RuntimeError('postwrite_HTML_mismatch')
    except Exception:
        stage.unlink(missing_ok=True)
        if changed:
            rollback=args.page.with_name(args.page.name+'.garden-status-rollback')
            shutil.copy2(backup,rollback);os.replace(rollback,args.page)
        raise
    print('S9_PHONE_GPU_GARDEN_ONLY_STATUS_UI_DEPLOYED',str(backup),
      'photos_changed=False','camera_restarted=False','images_decoded_on_hub=False')

if __name__=='__main__':main()
