#!/usr/bin/env python3
"""Install dormant native-S9 compatibility hooks; do NOT switch camera mode yet."""
from pathlib import Path
import datetime,shutil,subprocess
ROOT=Path("/home/jespern")
BACK=ROOT/"c720p-home-hub"/"backups"/"native-security-cutover"
BACK.mkdir(parents=True,exist_ok=True)
HUB=ROOT/"c720p-security-camera-new"/"c720p-frontyard-security-new.py"
RELAY=ROOT/"c720p-home-hub"/"bin"/"c720p-lan-camera-relay.py"
def stage(file,old,new,marker):
 s=file.read_text()
 if marker in s:
  print("ALREADY_PATCHED",str(file));return False
 if s.count(old)!=1:raise RuntimeError("Unexpected source anchor in "+str(file))
 out=s.replace(old,new)
 compile(out,str(file),"exec")
 stamp=datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
 b=BACK/(file.name+"."+stamp+".backup")
 shutil.copy2(file,b)
 t=file.with_name(file.name+".nativeS9temp")
 t.write_text(out);t.chmod(file.stat().st_mode&0o777);t.replace(file)
 print("INSTALLED",str(file),"backup",str(b))
 return True
hub_anchor='    # S9_GPU_PERSON_OFFLOAD_V1'
hub_add='''    # S9_NATIVE_SECURITY_CUTOVER_V1: phone owns the 4K MP4, motion and categorization.
    # Never trigger another C720P FFmpeg recording in this mode.
    if str(cfg.get("motion_mode","")).lower()=="s9_native_phone":
        try:
            with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=2) as r:
                native=json.loads(r.read(18000).decode("utf-8"))
            healthy=bool(native.get("ok")) and bool(native.get("native_4k_enabled"))
            mode=str(native.get("mode") or "")
            active=healthy and mode in ("starting","recording","stopping")
            set_runtime(last_motion_poll=time.time(),last_motion_active=active,
                last_motion_value=100.0 if active else 0.0,
                last_motion_source="s9-native-camera2-on-phone",
                last_motion_mode="s9-native-phone",
                camera_ok=healthy,
                s9_ml_camera_capture_owned_by_phone=True,
                s9_native_recorder_mode=mode,
                s9_native_reviewed_clips=int(native.get("reviewed") or 0),
                s9_native_last_recording=native.get("last_file"),
                s9_native_temperature_c=native.get("temperature_c"),
                s9_native_archive="microSD_only")
        except Exception as exc:
            set_runtime(last_motion_poll=time.time(),last_motion_active=False,
                last_motion_value=0.0,last_motion_mode="s9-native-phone",
                last_motion_source="s9-native-phone-unreachable",
                camera_ok=False,
                s9_native_telemetry_error=type(exc).__name__)
        return False,0.0
''' + hub_anchor
relay_anchor="  url=f'http://127.0.0.1:{UP[cam]}{path}{qs}'"
relay_replace="""  # S9_NATIVE_SECURITY_RELAY_V1: switch only S9 authenticated live path.
  if cam=='new' and path=='/live.mjpg' and Path('/home/jespern/c720p-home-hub/state/s9-native-security-active.flag').is_file():
   url='http://127.0.0.1:18808/mjpeg'
  else:
   url=f'http://127.0.0.1:{UP[cam]}{path}{qs}'"""
relay2="cam,kind=parts; url=f'http://127.0.0.1:{UP[cam]}/{kind}'"
relay2new="""cam,kind=parts
  if cam=='new' and kind=='live.mjpg' and Path('/home/jespern/c720p-home-hub/state/s9-native-security-active.flag').is_file():
   url='http://127.0.0.1:18808/mjpeg'
  else:url=f'http://127.0.0.1:{UP[cam]}/{kind}'"""
changedH=False;changedR=False
try:
 changedH=stage(HUB,hub_anchor,hub_add,"S9_NATIVE_SECURITY_CUTOVER_V1")
 changedR=stage(RELAY,relay_anchor,relay_replace,"S9_NATIVE_SECURITY_RELAY_V1")
 if relay2 not in RELAY.read_text() and "if cam=='new' and kind=='live.mjpg'" not in RELAY.read_text():
  raise RuntimeError("second relay path source changed")
 if relay2 in RELAY.read_text():
  data=RELAY.read_text().replace(relay2,relay2new)
  compile(data,str(RELAY),"exec")
  temp=RELAY.with_name(RELAY.name+".nativeS9temp")
  temp.write_text(data);temp.chmod(RELAY.stat().st_mode&0o777);temp.replace(RELAY)
 print("SOURCE_PATCHES_PREPARED_NO_CUTOVER",changedH,changedR)
except Exception:
 # No automatic overwrites here: the backups were printed, and current mode stays old.
 raise
