#!/usr/bin/env python3
"""Make the S9 live-camera image vertically scrollable inside HA Security.

Only affects the Live tab. Preserves the signed camera feed, 4K recording,
all Saved tabs, and camera controls. The stream fetch fallback can show
fresh JPEGs up to 4 FPS once the phone's preview source is upgraded.
"""
import argparse
from datetime import datetime, timezone
from pathlib import Path
import os
import shutil

MARKER='id="s9-live-scroll-and-frame-fps-v1"'
PATCH=r'''<style id="s9-live-scroll-and-frame-fps-v1">
/* Security is an embedded page with html/body/view overflow:hidden.
 * Scroll the live panel itself; no global HA or Saved-tab changes.
 */
#panel-live.active{
 overflow-y:auto!important;
 overflow-x:hidden!important;
 overscroll-behavior:contain;
 scrollbar-width:thin;
 touch-action:pan-y;
}
#panel-live .c720p-s9-live-only{
 height:auto!important;
 min-height:100%!important;
 display:block!important;
 padding:10px!important;
}
#panel-live .c720p-s9-live-only .cam{
 width:100%!important;
 height:auto!important;
 min-height:0!important;
 aspect-ratio:4/3!important;
 display:block!important;
 overflow:hidden!important;
 position:relative!important;
}
#panel-live #cameraLive{
 display:block!important;
 width:100%!important;
 height:auto!important;
 aspect-ratio:4/3!important;
 object-fit:contain!important;
}
#panel-live .badge,#panel-live #cameraStatus{
 z-index:3!important;
}
@media(max-width:820px){
 #panel-live .c720p-s9-live-only{padding:6px!important}
}
</style>'''
OLD='if(now-lastFrame>=650)'
NEW='if(now-lastFrame>=240)'

def patch(html):
    if html.count('</head>')!=1:
        raise ValueError("unexpected_security_head")
    for token in ['id="panel-live"','id="cameraLive"','id="cameraStatus"',
                  'S9_SECURITY_LIVE_V4_AUTHENTICATED_MJPEG_FETCH_FALLBACK',
                  's9SavedFolderFrame']:
        if token not in html:
            raise ValueError('missing_live_widget_'+token)
    if MARKER in html:
        if html.count(MARKER)!=1 or NEW not in html:
            raise ValueError("partial_or_unexpected_live_scroll_widget")
        return html
    if html.count(OLD)!=1:
        raise ValueError("fallback_FPS_source_contract_changed")
    updated=html.replace(OLD,NEW,1)
    return updated.replace('</head>',PATCH+'</head>',1)

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--page',type=Path,
      default=Path('/opt/homeassistant/config/www/c720p-surveillance.html'))
    p.add_argument('--apply',action='store_true')
    args=p.parse_args()
    before=args.page.read_text()
    after=patch(before)
    if patch(after)!=after:
        raise RuntimeError('live_scroll_patch_non_idempotent')
    if not args.apply:
        print('S9_LIVE_SCROLL_FPS_HTML_DRY_RUN',after!=before)
        return
    if before==after:
        print('S9_LIVE_SCROLL_FPS_ALREADY_ACTIVE')
        return
    root=Path('/home/jespern/c720p-home-hub/backups/s9-security-ui-repair')
    root.mkdir(parents=True,exist_ok=True)
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    back=root/('c720p-surveillance.before-live-scroll.'+stamp+'.html')
    shutil.copy2(args.page,back)
    os.chmod(back,0o600)
    temp=args.page.with_name(args.page.name+'.s9-live-scroll-stage')
    changed=False
    try:
        temp.write_text(after)
        os.chmod(temp,args.page.stat().st_mode&0o777)
        if temp.read_text()!=after:
            raise RuntimeError('staged_scroll_html_mismatch')
        os.replace(temp,args.page)
        changed=True
        if patch(args.page.read_text())!=after:
            raise RuntimeError('live_scroll_postwrite_mismatch')
    except Exception:
        temp.unlink(missing_ok=True)
        if changed:
            backup=args.page.with_name(args.page.name+'.scroll-rollback')
            shutil.copy2(back,backup)
            os.replace(backup,args.page)
        raise
    print('S9_LIVE_SCROLL_FPS_HTML_DEPLOYED','backup='+str(back),
          'camera_restarted=False','recordings_changed=False')

if __name__=='__main__':
    main()
