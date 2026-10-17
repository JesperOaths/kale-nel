#!/usr/bin/env python3
"""Deploy only the S9+ night_mode allowlist to two existing private camera relays.

No camera capture command is sent. Preserve both original sources with SHA256,
compile-check replacements, restart authenticated relays, check night-mode
metadata and retained microSD archive, and restore both sources on any failure.
"""
from datetime import datetime,timezone
from pathlib import Path
import hashlib,json,os,py_compile,shutil,stat,subprocess,tempfile,time
import urllib.request,urllib.error

HOME=Path("/home/jespern/c720p-home-hub")
PROXY=HOME/"bin/s9_native_camera_controls.py"
LAN=HOME/"bin/c720p-lan-camera-relay.py"
BACKUP=HOME/"backups/s9-auto-night-controls-v19"
PROXY_UNIT="c720p-drive-security-archive.service"
LAN_UNIT="c720p-lan-camera-relay.service"
APP_ANCHOR='VALUES={'
APP_ADD='VALUES={"night_mode":re.compile(r"(?:auto|on|off)\\Z"),'
PROXY_STATUS_OLD='"can_change_while_recording":False,"mode":d.get("mode"),"controls":options'
PROXY_STATUS_NEW='"can_change_while_recording":False,"mode":d.get("mode"),"night_active":d["controls"].get("night_active") if isinstance(d["controls"].get("night_active"),bool) else None,"controls":options'
LAN_OLD="('zoom','exposure_ev','torch','focus','recording_rotation','garden_zone')"
LAN_NEW="('zoom','exposure_ev','torch','focus','recording_rotation','garden_zone','night_mode')"

def digest(b):
 return hashlib.sha256(b).hexdigest()

def request(port,path,timeout=9):
 with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}",timeout=timeout) as r:
  if r.status!=200:raise RuntimeError("status_http_not_ok")
  # S9 archive lists may exceed 150KB even at 136 recorded clips.
  # Read the complete bounded response, never parse a truncated JSON prefix.
  data=r.read(2_000_001)
  if len(data)>2_000_000:raise RuntimeError("camera_metadata_response_too_large")
  return json.loads(data)

def service(command,unit):
 p=subprocess.run(["systemctl","--user",command,unit],
   capture_output=True,text=True,timeout=28)
 if p.returncode:raise RuntimeError("service_"+unit+"_"+command+"_failed")
 return p.stdout.strip()

def controls(port,path):
 result=request(port,path)
 options=result.get("controls")
 if not result.get("ok") or not isinstance(options,dict):
  raise RuntimeError("camera_controls_unavailable")
 return options

def read_regular(file):
 if file.is_symlink() or not file.is_file():
  raise RuntimeError("missing_or_symlinked_source_"+file.name)
 raw=file.read_bytes()
 if len(raw)>1000000:raise RuntimeError("unexpected_source_size")
 return raw,file.stat()

def updated_source(path,raw):
 old=raw.decode("utf-8")
 if path==PROXY:
  if "s9_native_camera_controls.py" not in str(path) or "VALUES={" not in old:
   raise RuntimeError("camera_proxy_shape_changed")
  patched=old
  if '"night_mode":re.compile(' not in patched:
   if patched.count(APP_ANCHOR)!=1:raise RuntimeError("camera_proxy_night_anchor_changed")
   patched=patched.replace(APP_ANCHOR,APP_ADD,1)
  if PROXY_STATUS_NEW not in patched:
   if patched.count(PROXY_STATUS_OLD)!=1:
    raise RuntimeError("night_sensor_state_relay_shape_changed")
   patched=patched.replace(PROXY_STATUS_OLD,PROXY_STATUS_NEW,1)
 elif path==LAN:
  if "SECURITY_NATIVE_CAMERA2_RELAY_V18" not in old:
   raise RuntimeError("authenticated_LAN_relay_v18_missing")
  if LAN_NEW in old:return raw
  if old.count(LAN_OLD)!=1:raise RuntimeError("authenticated_LAN_allowlist_changed")
  patched=old.replace(LAN_OLD,LAN_NEW,1)
 else:raise RuntimeError("unrecognized_target")
 if len(patched)-len(old)>260:raise RuntimeError("unexpected_patch_growth")
 compile(patched,str(path),"exec")
 return patched.encode("utf-8")

def replace(path,payload,metadata):
 fd,tmp=tempfile.mkstemp(prefix=".s9-night-v19-",dir=str(path.parent))
 try:
  with os.fdopen(fd,"wb") as out:
   out.write(payload);out.flush();os.fsync(out.fileno())
  os.chmod(tmp,stat.S_IMODE(metadata.st_mode))
  try:os.chown(tmp,metadata.st_uid,metadata.st_gid)
  except PermissionError:pass
  os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)

def verify_archive(initial):
 d=request(8795,"/new/api/saved")
 if d.get("archive_mode")!="S9-microSD-only":
  raise RuntimeError("microSD_archive_mode_changed")
 now=d.get("events")
 if not isinstance(now,list) or len(now)<initial:
  raise RuntimeError("archived_clip_count_regressed")
 return len(now)

def wait_control(port,path):
 for n in range(12):
  try:
   opts=controls(port,path)
   night=opts.get("night_mode")
   status=request(port,path)
   if isinstance(night,dict) and night.get("value") in ("auto","on","off") and (
       set(night.get("available",[]))=={"auto","on","off"}) and (
       isinstance(status.get("night_active"),bool)):
    return opts
  except Exception:
   pass
  time.sleep(1)
 raise RuntimeError("night_control_not_visible_"+str(port))

def main():
 native=request(18808,"/status")
 if not (native.get("ok") is True and native.get("mode")=="watching"
    and native.get("native_4k_enabled") is True
    and native.get("night_mode") in ("auto","on","off")
    and isinstance(native.get("night_active"),bool)):
  raise RuntimeError("new_native_camera_night_mode_not_ready_no_changes")
 if "night_mode" not in controls(18808,"/controls"):
  raise RuntimeError("native_night_control_absent_no_changes")
 before=request(8795,"/new/api/saved")
 if before.get("archive_mode")!="S9-microSD-only" or not isinstance(before.get("events"),list):
  raise RuntimeError("microSD_archive_unavailable")
 n=len(before["events"])
 originals={}
 newdata={}
 for target in (PROXY,LAN):
  originals[target]=read_regular(target)
  newdata[target]=updated_source(target,originals[target][0])
 if service("is-active",PROXY_UNIT)!="active" or service("is-active",LAN_UNIT)!="active":
  raise RuntimeError("existing_relay_service_unhealthy")
 BACKUP.mkdir(parents=True,exist_ok=True)
 os.chmod(BACKUP,0o700)
 stamp=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 saved={}
 for target,(raw,_) in originals.items():
  archive=BACKUP/(stamp+"-"+target.name)
  if archive.exists():raise RuntimeError("backup_destination_exists")
  archive.write_bytes(raw)
  os.chmod(archive,0o600)
  if digest(archive.read_bytes())!=digest(raw):
   raise RuntimeError("source_backup_checksum_failed")
  saved[target]=archive
 changed=[]
 try:
  if newdata[PROXY]!=originals[PROXY][0]:
   if PROXY.read_bytes()!=originals[PROXY][0]:
    raise RuntimeError("camera_proxy_concurrent_edit")
   replace(PROXY,newdata[PROXY],originals[PROXY][1])
   changed.append(PROXY)
   service("restart",PROXY_UNIT)
  wait_control(8795,"/new/camera-controls")
  if newdata[LAN]!=originals[LAN][0]:
   if LAN.read_bytes()!=originals[LAN][0]:
    raise RuntimeError("LAN_relay_concurrent_edit")
   replace(LAN,newdata[LAN],originals[LAN][1])
   changed.append(LAN)
   service("restart",LAN_UNIT)
  options=wait_control(8794,"/new/camera-controls")
  after=request(18808,"/status")
  if not after.get("ok") or not after.get("native_4k_enabled"):
   raise RuntimeError("camera_health_changed")
  clips=verify_archive(n)
  # Read sensor evidence only. No changes to exposure are sent by this relay.
  exposure=after.get("sensor_exposure_ms")
  luminance=after.get("night_luminance")
  night_selected=options["night_mode"]["value"]
  native_controls=controls(18808,"/controls")
  effective=native_controls.get("night_effective_ev")
  if not isinstance(after.get("night_active"),bool):
   raise RuntimeError("night_exposure_active_state_missing")
  if after.get("night_mode")!=night_selected:
   raise RuntimeError("relay_night_mode_mismatch")
  if (after.get("night_active") and isinstance(effective,(int,float))
      and effective<=0 and native_controls.get("night_ev_supported") is True):
   raise RuntimeError("night_exposure_sensor_bias_unapplied")
  for unit in (PROXY_UNIT,LAN_UNIT):
   if service("is-active",unit)!="active":
    raise RuntimeError("relay_not_active")
  print("S9_NIGHT_CONTROLS_V19_VERIFIED "+json.dumps({
   "night_control_value":options["night_mode"]["value"],
   "allowed":options["night_mode"]["available"],
   "native_mode":after.get("mode"),"night_active":after.get("night_active"),
   "secured_relay_night_active":request(8794,"/new/camera-controls").get("night_active"),
   "night_luminance":luminance,"night_effective_ev":effective,
   "night_ev_supported":native_controls.get("night_ev_supported"),
   "sensor_exposure_ms":exposure,"sensor_iso":after.get("sensor_iso"),
   "sensor_result_fps":after.get("sensor_result_fps"),
   "night_auto_switches":after.get("night_auto_switches"),
   "sd_archive_clips":clips,"no_camera_commands_sent":True,
   "backups":{p.name:str(saved[p]) for p in saved},
   "changed":[p.name for p in changed]},sort_keys=True),flush=True)
 except BaseException:
  for target in reversed(changed):
   try:replace(target,originals[target][0],originals[target][1])
   except Exception:print("S9_NIGHT_SOURCE_ROLLBACK_FAILED_"+target.name,flush=True)
  for unit in (PROXY_UNIT,LAN_UNIT):
   try:service("restart",unit)
   except Exception:print("S9_NIGHT_RELAY_ROLLBACK_RESTART_FAILED_"+unit,flush=True)
  print("S9_NIGHT_CONTROLS_V19_ROLLBACK_ATTEMPTED",flush=True)
  raise

if __name__=="__main__":
 main()
