#!/usr/bin/env python3
"""Guarded fix for invisible S9+ Camera Settings in the C720P Security shell.

V23 restores native controls but leaves the original #panel-controls section
outside the newer #s9v5-stage. That stage overlays the original .app content;
controls can report 4 available while visually appearing blank. Move the
*same live DOM element* inside the stage when mounted; existing event listeners,
authenticated relay, control values and manual selection safeguards stay intact.

Default is read-only dry-run. --apply backs up exact previous HTML, performs an
atomic static-page replacement, verifies served HTML and native S9 API, and
rolls back on any failure. No APK, camera or recordings are modified.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import shutil
import tempfile
import time
import urllib.request

PAGE=Path("/opt/homeassistant/config/www/c720p-surveillance.html")
BACKUP=Path("/home/jespern/c720p-home-hub/backups/security-camera-settings-stage-v24")
MARK="SECURITY_CAMERA_SETTINGS_STAGE_MOUNT_V24"
SCRIPT=r'''
<script id="security-camera-settings-stage-v24">
/* SECURITY_CAMERA_SETTINGS_STAGE_MOUNT_V24
 * Camera Settings is a legacy section initially outside #s9v5-shell.
 * The newer visible #s9v5-stage overlaps its original location. Reparent
 * the same section so its existing controls and handlers remain intact.
 */
(()=>{
 'use strict';
 function mountCameraSettings(){
  const stage=document.getElementById('s9v5-stage');
  const panel=document.getElementById('panel-controls');
  if(!stage||!panel)return;
  if(panel.parentElement!==stage)stage.appendChild(panel);
  const nav=document.querySelector('#s9v5-nav button[data-view="camera"]');
  if(nav?.getAttribute('aria-current')==='page'){
   panel.hidden=false;
   panel.classList.add('s9v5-active');
   panel.style.setProperty('display','block','important');
  }
 }
 document.addEventListener('click',event=>{
  if(event.target?.closest?.('#s9v5-nav button[data-view="camera"]'))
   setTimeout(mountCameraSettings,0);
 },true);
 window.addEventListener('pageshow',mountCameraSettings);
 setInterval(mountCameraSettings,1200);
 mountCameraSettings();
})();
</script>
'''
def sha(blob):return hashlib.sha256(blob).hexdigest()

def patch(html):
    if MARK in html:
        if html.count(MARK)!=1 or 'stage.appendChild(panel)' not in html:
            raise RuntimeError("unexpected_v24_revision")
        return html
    required=(
      'id="panel-controls"','id="s9v5-stage"',
      'id="cameraControls"','id="cameraControlMsg"',
      'SECURITY_CAMERA_SETTINGS_INLINE_V23',
      'security-settings-panel-safety-v22',
      'function showPanel(name)',
      "nav.getAttribute('aria-current')",
      'C720PSecureRelay.fetch')
    for token in required:
        if token not in html:raise RuntimeError("missing_expected_root_contract:"+token)
    if html.count('id="panel-controls"')!=1 or html.count('id="cameraControls"')!=1 or html.count('</body>')!=1:
        raise RuntimeError("duplicate_or_missing_document_anchors")
    return html.replace('</body>',SCRIPT+'</body>',1)

def run(apply):
    if PAGE.is_symlink() or not PAGE.is_file():raise RuntimeError("invalid_page")
    before=PAGE.read_bytes()
    # The Security shell is also updated by independent authorized workers.
    # Preserve their changes: add only the isolated stage-mount script after
    # verifying structural contracts. Recheck the exact bytes immediately
    # before atomic replacement and retain the complete rollback backup.
    after=patch(before.decode("utf-8")).encode()
    result={"version":MARK,"mode":"apply" if apply else "dry_run",
            "previous_sha256":sha(before),"patched_sha256":sha(after),
            "will_modify":before!=after,"only_static_security_ui":True}
    if not apply or before==after:
        print(json.dumps(result,separators=(",",":")));return
    BACKUP.mkdir(parents=True,exist_ok=True)
    backup=BACKUP/(time.strftime("%Y%m%dT%H%M%SZ",time.gmtime())+".html")
    if backup.exists():raise RuntimeError("backup_collision")
    shutil.copy2(PAGE,backup)
    if backup.read_bytes()!=before:raise RuntimeError("backup_readback_mismatch")
    descriptor,temp=tempfile.mkstemp(prefix=".camera-settings-v24-",dir=PAGE.parent)
    changed=False
    try:
        with os.fdopen(descriptor,"wb") as f:
            f.write(after);f.flush();os.fsync(f.fileno())
        meta=PAGE.stat()
        os.chmod(temp,meta.st_mode&0o777)
        try:os.chown(temp,meta.st_uid,meta.st_gid)
        except PermissionError:pass
        if PAGE.read_bytes()!=before:raise RuntimeError("concurrent_html_edit")
        os.replace(temp,PAGE);changed=True
        if sha(PAGE.read_bytes())!=sha(after):raise RuntimeError("live_file_hash_mismatch")
        url="http://127.0.0.1:8123/local/c720p-surveillance.html?camera-settings-stage-v24="+str(int(time.time()))
        with urllib.request.urlopen(url,timeout=13) as response:
            served=response.read(300000)
            if response.status!=200 or MARK.encode() not in served:
                raise RuntimeError("HA_served_page_missing_v24")
        with urllib.request.urlopen("http://127.0.0.1:8794/new/camera-controls",timeout=10) as response:
            c=json.load(response)
            if c.get('ok') is not True or not all(x in c.get('controls',{}) for x in ('zoom','exposure_ev','focus','torch')):
                raise RuntimeError("native_camera_controls_not_available")
        result.update({"verified":True,"served_http":200,"backup":str(backup),
                       "camera_controls":list(c.get("controls",{})),"recordings_untouched":True})
        print(json.dumps(result,separators=(",",":")))
    except BaseException:
        if changed:shutil.copy2(backup,PAGE)
        raise
    finally:
        if os.path.exists(temp):os.unlink(temp)
if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--apply",action="store_true")
    run(p.parse_args().apply)
