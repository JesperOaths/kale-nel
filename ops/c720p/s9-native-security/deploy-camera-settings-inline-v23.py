#!/usr/bin/env python3
"""Restore working inline native Camera2 controls on Home Assistant Security.

The V22 camera panel hides a pre-existing functioning inline control renderer
and displays an iframe whose sizing/relay load can leave the panel blank.
This V23 guarded patch restores the existing controls (no changes to control
commands, API paths, camera firmware, recordings, face review, or navigation).
Default = dry run. --apply is a backed-up atomic write with HA readback.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import time
import urllib.request

ROOT=Path("/opt/homeassistant/config/www/c720p-surveillance.html")
BACK=Path("/home/jespern/c720p-home-hub/backups/camera-settings-inline-v23")
EXPECTED_SHA="73c0541b57939fd1f3ca32ec8a369da76c5d95f7da0e1e42f66ce87f6d2bffb5"
MARK="SECURITY_CAMERA_SETTINGS_INLINE_V23"
OLD='#s9v5-shell #panel-controls>.controls{display:none!important}'
OLD_IFRAME='#s9v5-shell #panel-controls #s9v22-camera-frame{display:block!important;width:100%!important;height:100%!important;min-height:0!important;border:0!important;background:#0e1721}'
NEW='''/* SECURITY_CAMERA_SETTINGS_INLINE_V23: Show the existing proven native S9+ controls.
   V22 hid these and depended entirely on an iframe that could collapse. */
#s9v5-shell #panel-controls{overflow-y:auto!important;padding:clamp(16px,2vw,30px)!important;background:#0e1721!important}
#s9v5-shell #panel-controls>.controls{display:block!important;width:min(100%,1180px)!important;margin-inline:auto!important;min-height:260px!important}
#s9v5-shell #panel-controls #s9v22-camera-frame{display:none!important}
#s9v5-shell #panel-controls .controlcam{background:#142532!important;border:1px solid #385164!important;border-radius:16px!important}
#s9v5-shell #panel-controls #cameraControls{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(min(210px,100%),1fr))!important;gap:16px!important}
#s9v5-shell #panel-controls #cameraControlMsg{display:block!important;min-height:24px!important;margin-top:15px!important}
'''
def digest(x):return hashlib.sha256(x).hexdigest()

def patch(s):
    if MARK in s:
        if 'display:block!important;width:min(100%,1180px)' not in s:
            raise RuntimeError("existing_v23_incomplete")
        return s
    if s.count(OLD)!=1 or s.count(OLD_IFRAME)!=1:
        raise RuntimeError("V22_camera_panel_contract_changed")
    if s.count('id="cameraControls"')!=1 or s.count('id="cameraControlMsg"')!=1:
        raise RuntimeError("inline_camera_controls_absent")
    if 'function refreshControls(){loadControls(' not in s or 'function tab(t)' not in s:
        raise RuntimeError("native_control_refresh_wiring_missing")
    if 'C720PSecureRelay.fetch' not in s or 'explicit-user-selection-v1' not in s:
        raise RuntimeError("authenticated_camera_control_contract_missing")
    # Replace the entire single V22 style declaration without disturbing its
    # other selector block; force the older inline renderer visible and the
    # unused iframe hidden by the exact target rule replacements.
    s=s.replace(OLD,NEW,1).replace(OLD_IFRAME,'',1)
    return s

def run(apply):
    if ROOT.is_symlink() or not ROOT.is_file():raise RuntimeError("unexpected_Security_root")
    original=ROOT.read_bytes()
    prior=digest(original)
    text=original.decode("utf-8")
    if MARK not in text and prior!=EXPECTED_SHA:
        raise RuntimeError("live_Security_page_modified_since_audit")
    updated=patch(text).encode()
    result={"version":MARK,"dry_run":not apply,
            "before_sha256":prior,"after_sha256":digest(updated),
            "will_change":updated!=original,
            "old_controls_reused":True,"s9_camera_untouched":True}
    if not apply or updated==original:
        print(json.dumps(result,separators=(",",":")));return
    BACK.mkdir(parents=True,exist_ok=True)
    backup=BACK/(time.strftime("%Y%m%dT%H%M%SZ",time.gmtime())+".html")
    if backup.exists():raise RuntimeError("backup_collision")
    shutil.copy2(ROOT,backup)
    if backup.read_bytes()!=original:raise RuntimeError("backup_readback_mismatch")
    descriptor,tmp=tempfile.mkstemp(prefix=".security-camera-v23-",dir=ROOT.parent)
    try:
        with os.fdopen(descriptor,"wb") as fd:
            fd.write(updated);fd.flush();os.fsync(fd.fileno())
        meta=ROOT.stat()
        os.chmod(tmp,meta.st_mode&0o777)
        try:os.chown(tmp,meta.st_uid,meta.st_gid)
        except PermissionError:pass
        if ROOT.read_bytes()!=original:raise RuntimeError("concurrent_ui_edit")
        os.replace(tmp,ROOT)
        if digest(ROOT.read_bytes())!=digest(updated):
            raise RuntimeError("post_write_sha_mismatch")
        # HA injects gate metadata on some requests; verify served content and
        # route rather than assuming raw bytes are preserved by the web layer.
        url="http://127.0.0.1:8123/local/c720p-surveillance.html?camera-settings-v23="+str(int(time.time()))
        with urllib.request.urlopen(url,timeout=15) as response:
            html=response.read(250000)
            if response.status!=200 or MARK.encode() not in html:
                raise RuntimeError("HA_camera_controls_served_html_missing")
        controls=json.loads(urllib.request.urlopen("http://127.0.0.1:8794/new/camera-controls",timeout=10).read(15000))
        if not controls.get("ok") or not all(k in controls.get("controls",{}) for k in ("zoom","exposure_ev","focus","torch")):
            raise RuntimeError("live_S9_controls_not_available")
        result.update({"verified":True,"backup":str(backup),
                       "ha_http":200,"control_keys":["zoom","exposure_ev","focus","torch"]})
        print(json.dumps(result,separators=(",",":")))
    except BaseException:
        shutil.copy2(backup,ROOT)
        raise
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--apply",action="store_true")
    run(parser.parse_args().apply)
