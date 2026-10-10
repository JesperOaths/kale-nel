#!/usr/bin/env python3
"""Reduce Home Assistant authenticated JPEG fallback display throttling.

Only updates an already-deployed S9+ Live widget. The original 4K MP4s,
camera controls, Saved tabs and authenticated relay stay unchanged.
"""
import argparse
from pathlib import Path
from datetime import datetime,timezone
import os,shutil

PAGE=Path('/opt/homeassistant/config/www/c720p-surveillance.html')
MARKER='S9_LIVE_PHONE_8FPS_DISPLAY_V2'
OLD='if(now-lastFrame>=240)'
NEW='if(now-lastFrame>=95)'

def patch(html):
    if MARKER in html:
        if html.count(MARKER)!=1 or html.count(NEW)!=1:raise ValueError('partial_8fps_live_upgrade')
        return html
    for marker in ['s9-live-scroll-and-frame-fps-v1',
                   'S9_SECURITY_LIVE_V4_AUTHENTICATED_MJPEG_FETCH_FALLBACK',
                   'id="cameraLive"']:
        if marker not in html:raise ValueError('required_live_widget_missing')
    if html.count(OLD)!=1 or html.count('</head>')!=1:
        raise ValueError('prior_live_frame_cap_not_found')
    return html.replace(OLD,NEW,1).replace('</head>','<!-- '+MARKER+' -->\n</head>',1)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--page',type=Path,default=PAGE)
    ap.add_argument('--apply',action='store_true')
    args=ap.parse_args()
    old=args.page.read_text();new=patch(old)
    if patch(new)!=new:raise RuntimeError('not_idempotent')
    if not args.apply:
        print('S9_LIVE_8FPS_DISPLAY_DRY_RUN',old!=new);return
    if old==new:
        print('S9_LIVE_8FPS_DISPLAY_ALREADY_ACTIVE');return
    back=Path('/home/jespern/c720p-home-hub/backups/s9-security-ui-repair')
    back.mkdir(parents=True,exist_ok=True)
    dest=back/('c720p-surveillance.before-8fps.'+
        datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.html')
    shutil.copy2(args.page,dest);os.chmod(dest,0o600)
    stage=args.page.with_name(args.page.name+'.fps8-stage')
    installed=False
    try:
        stage.write_text(new);os.chmod(stage,args.page.stat().st_mode&0o777)
        if stage.read_text()!=new:raise RuntimeError('staged_html_mismatch')
        os.replace(stage,args.page);installed=True
        if patch(args.page.read_text())!=new:raise RuntimeError('postwrite_mismatch')
    except Exception:
        stage.unlink(missing_ok=True)
        if installed:
            tmp=args.page.with_name(args.page.name+'.fps8-rollback')
            shutil.copy2(dest,tmp);os.replace(tmp,args.page)
        raise
    print('S9_PHONE_8FPS_SECURITY_DISPLAY_ACTIVE',str(dest),
        'camera_not_restarted=True','original_recordings_unchanged=True')

if __name__=='__main__':main()
