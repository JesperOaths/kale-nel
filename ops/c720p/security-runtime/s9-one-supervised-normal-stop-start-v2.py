#!/usr/bin/env python3
"""One supervised native S9 CameraService STOP/START; explicit --execute once.

No APK install, no trial endpoints, no counter edits, no global ADB reset,
no raw CameraService stop/kill. The normal STOP is the current Activity button.
Normal START is the same Activity's onNewIntent(enable_native_camera).
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET

PHONE="192.168.178.250:5555"
SERIAL="27bb603837047ece"
MODEL="SM-G965F"
APK="37091d542b8708db26f520a67af8a4edbb687c80d2b24c01d87bf1a2d8b5d059"
URL="http://127.0.0.1:18808/status"
ACTIVITY="nl.kalenel.s9security/.CameraActivity"
SD="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K"
CHECK_FLAGS=("capture_segment_continuation_pending","preview_jpeg_worker_busy",
 "movement_4k_backfill_queued","appearance_backfill_queued",
 "face_backfill_queued","historical_import_queued",
 "garden_archive_triage_queued","preroll_diagnostic_active")
BLOCKED_UNITS=("c720p-s9-complete-clip-worker.service",
 "c720p-s9-person-presence-v44.service","c720p-s9-priority-rescan-worker.service",
 "c720p-s9-standalone-catalog.service","c720p-s9-local-sd-catalog.service",
 "c720p-s9-original-hash-ledger-v1.service",
 "c720p-s9-visual-index-v36.service","c720p-s9-fast-recent-clips.service",
 "c720p-s9-historical-v28.service","c720p-s9-evidence-quality.service",
 "c720p-s9-face-v5-cool-window.service",
 "c720p-camera-android-power-save.service")
BLOCKED_JOB_WORDS=("c720p-s9-","camera-android-power-save.service")
class Refuse(Exception): pass

def cmd(args,timeout=7):
    try:p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
    except (OSError,subprocess.TimeoutExpired) as e:raise Refuse("command_unavailable:"+args[0]) from e
    return p.returncode,p.stdout.strip(),p.stderr.strip()[:130]

def adb(*args,timeout=7):
    return cmd(["/usr/bin/adb","-s",PHONE,*args],timeout=timeout)

def okadb(*args,timeout=7):
    rc,out,err=adb(*args,timeout=timeout)
    if rc:raise Refuse("adb_command_failed:"+str(args[:2])+":"+err[:60])
    return out

def status():
    try:
        with urllib.request.urlopen(URL,timeout=3) as resp:
            if resp.status!=200:raise Refuse("status_http_non200")
            return json.loads(resp.read(65536))
    except (OSError,ValueError) as e:raise Refuse("native_http_unavailable") from e

def service():
    rc,out,err=adb("shell","dumpsys","activity","services","nl.kalenel.s9security")
    if rc:return None
    return "ServiceRecord" in out and "CameraService" in out

def service_record():
    """Exact registered service generation; unchanged application PID is irrelevant."""
    rc,out,err=adb("shell","dumpsys","activity","services","nl.kalenel.s9security")
    if rc:return None
    match=re.search(r"ServiceRecord[{]([0-9a-f]+) u[0-9]+ nl[.]kalenel[.]s9security/[.]CameraService[}]",out)
    return match.group(1) if match else ""

def identity():
    if okadb("get-state")!="device":raise Refuse("adb_not_device")
    if okadb("shell","getprop","ro.product.model")!=MODEL:raise Refuse("model_mismatch")
    if okadb("shell","getprop","ro.serialno")!=SERIAL:raise Refuse("serial_mismatch")
    rc,out,err=cmd(["/usr/bin/adb","forward","--list"])
    if rc or PHONE+" tcp:18808 tcp:8808" not in out.splitlines():
        raise Refuse("expected_forward_unavailable")
    return True

def runchecks(a,b):
    if any(d.get("mode")!="watching" for d in (a,b)):raise Refuse("not_idle_watching")
    if a.get("recorded")!=b.get("recorded"):raise Refuse("new_recording_started")
    if b.get("frames",0)<=a.get("frames",0):raise Refuse("sensor_not_advancing")
    if type(b.get("last_frame_age_ms")) is not int or b["last_frame_age_ms"]>=2000:
        raise Refuse("sensor_frames_stale")
    if not 0<b.get("temperature_c",100)<40.5:raise Refuse("temperature_guard")
    if b.get("sd_free_bytes",0)<20*1024**3:raise Refuse("sd_reserve_guard")
    if b.get("continuous_4k_production_persisted") is not True:
        raise Refuse("4k_production_preference_missing")
    if any(b.get(k) is not False for k in CHECK_FLAGS):raise Refuse("recorder_busy_or_unknown")
    return True

def exclusion_check():
    jobs=cmd(["systemctl","--user","list-jobs","--no-pager"],timeout=5)[1]
    if any(x in jobs for x in BLOCKED_JOB_WORDS):raise Refuse("competing_systemd_job")
    for unit in BLOCKED_UNITS:
        state=cmd(["systemctl","--user","is-active",unit],timeout=3)[1]
        # Historical failed oneshots are not active workers, but activating
        # oneshots (is-active may exit nonzero) MUST block camera maintenance.
        if state not in ("inactive","failed"):
            raise Refuse("competing_worker:"+unit+":"+state)
    # The S9 go2rtc relay is passive; it stays running.
    return True

def ui_stop():
    okadb("shell","input","keyevent","KEYCODE_WAKEUP")
    okadb("shell","am","start","-n",ACTIVITY,timeout=8)
    file="/data/local/tmp/s9-supervised-native-control-readonly.xml"
    try:
        okadb("shell","uiautomator","dump",file,timeout=12)
        root=ET.fromstring(okadb("shell","cat",file,timeout=8))
    except (ET.ParseError,Refuse) as exc:raise Refuse("native_UI_not_verified") from exc
    finally:
        try:adb("shell","rm","-f",file)
        except Refuse:pass
    nodes=[n.attrib for n in root.iter()
           if n.attrib.get("package")=="nl.kalenel.s9security"
           and n.attrib.get("text","").upper()=="STOP NATIVE SERVICE"
           and n.attrib.get("clickable")=="true"]
    if len(nodes)!=1:raise Refuse("native_stop_control_missing_or_ambiguous")
    bounds=nodes[0].get("bounds","")
    match=re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]",bounds)
    if not match:raise Refuse("native_stop_control_bounds_invalid")
    x1,y1,x2,y2=map(int,match.groups())
    if not(0<x1<x2<=4000 and 0<y1<y2<=4000):
        raise Refuse("native_stop_control_bounds_invalid")
    return ((x1+x2)//2,(y1+y2)//2)

def media():
    counts={}
    for suffix in ("mp4","recording","tmp"):
        listing=okadb("shell","find",SD,"-maxdepth","1","-type","f",
                      "-name","*."+suffix,timeout=12)
        counts[suffix]=len([x for x in listing.splitlines() if x.startswith(SD+"/")])
    return counts

class Journal:
    def __init__(self,path):
        self.path=Path(path)
        if self.path.exists():raise Refuse("journal_already_exists_refuse_duplicate_transaction")
        self.data={"schema":"s9_single_supervised_normal_stop_start_v2",
                   "utc":dt.datetime.now(dt.timezone.utc).isoformat(),
                   "stop_attempted":False,"stop_confirmed":False,
                   "start_attempted":False,"start_confirmed":False,
                   "camera_recovered":False,"events":[]}
        self.write("created")
    def write(self,event,**kw):
        self.data.update(kw)
        self.data["events"].append({"utc":dt.datetime.now(dt.timezone.utc).isoformat(),"event":event})
        tmp=self.path.with_name(self.path.name+".tmp")
        with tmp.open("w") as f:
            os.fchmod(f.fileno(),0o600)
            json.dump(self.data,f,indent=2,sort_keys=True);f.write("\n")
            f.flush();os.fsync(f.fileno())
        os.replace(tmp,self.path)
        print("STAGE",event,flush=True)

def bridge_recover_once(j):
    if j.data.get("bridge_recovery_attempted"):return False
    j.write("bounded_bridge_recovery",bridge_recovery_attempted=True)
    # Only the existing supported *connection* repair unit, never CameraService.
    rc,out,err=cmd(["systemctl","--user","start","c720p-s9-native-camera-bridge.service"],timeout=16)
    if rc:return False
    try:identity();return True
    except Refuse:return False

def run(j):
    identity()
    first=status()
    exclusion_check()
    if service() is not True:raise Refuse("foreground_camera_service_not_registered")
    first_service_record=service_record()
    if not first_service_record:raise Refuse("old_service_generation_unavailable")
    apk_path=okadb("shell","pm","path","nl.kalenel.s9security").splitlines()[0].removeprefix("package:")
    if okadb("shell","sha256sum",apk_path).split()[0]!=APK:
        raise Refuse("installed_APK_digest_mismatch")
    before=media()
    if before["tmp"] or before["recording"]>1:raise Refuse("unfinalized_media_unknown")
    time.sleep(2)
    identity()
    second=status()
    runchecks(first,second)
    exclusion_check()
    button=ui_stop()
    identity()
    latest=status()
    runchecks(second,latest)
    exclusion_check()
    if service() is not True:raise Refuse("camera_service_missing_before_stop")
    if service_record()!=first_service_record:raise Refuse("service_changed_before_stop")
    if latest.get("recorded")!=first.get("recorded"):
        raise Refuse("new_motion_event")
    j.write("all_guards_passed",old_service_generation=first_service_record,
            apk_sha256=APK,recordings_before=before,
            before_mode=latest.get("mode"),before_temp_c=latest.get("temperature_c"),
            before_frames=latest.get("frames"),before_ring_ms=latest.get("continuous_4k_buffered_ms"),
            stop_control_xy=button)
    # Mark BEFORE sending. If the command fails, its delivery is uncertain:
    # no second STOP is permitted.
    j.write("stop_attempted",stop_attempted=True)
    rc,out,err=adb("shell","input","tap",str(button[0]),str(button[1]),timeout=8)
    j.write("stop_returned",stop_return_code=rc,stop_return_error=err)
    if rc:raise Refuse("stop_delivery_uncertain_no_repeat")
    confirmed=False
    for attempt in range(12):
        try:
            identity()
        except Refuse:
            if not bridge_recover_once(j):raise Refuse("transport_lost_after_stop")
        current=service_record()
        if current is None:raise Refuse("service_state_unavailable_after_stop")
        if current and current!=first_service_record:
            # Android/the owner's other controller rearmed a NEW service
            # between polls. Never send a second START on top of it.
            j.write("service_generation_replaced_without_operator_start",
                    stop_confirmed=True,old_service_generation=first_service_record,
                    new_service_generation=current,operator_start_suppressed=True)
            return
        if current=="":
            time.sleep(1)
            if service_record()=="":
                confirmed=True
                break
        time.sleep(1)
    if not confirmed:raise Refuse("async_shutdown_not_confirmed")
    # A now-closed 8808 endpoint is *expected* after stopSelf().
    j.write("shutdown_confirmed",stop_confirmed=True)
    identity()
    # No second STOP and no low-level forced 4K rearm.
    j.write("start_attempted",start_attempted=True)
    rc,out,err=adb("shell","am","start","-n",ACTIVITY,
                   "--ez","enable_native_camera","true",
                   "--ez","pilot_only","false",timeout=10)
    j.write("normal_start_returned",start_return_code=rc,
            start_return_error=err,start_activity_response=out[:160])
    if rc:raise Refuse("normal_activity_start_not_accepted")
    j.write("normal_start_accepted",start_confirmed=True)

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--execute",action="store_true")
    p.add_argument("--journal",required=True)
    a=p.parse_args()
    if not a.execute:
        print("REFUSED: --execute required; source import/test safe")
        return 2
    j=Journal(a.journal)
    try:
        run(j)
        return 0
    except Exception as e:
        j.write("aborted",failure_type=type(e).__name__,
                failure=str(e)[:230])
        return 3

if __name__=="__main__":sys.exit(main())
