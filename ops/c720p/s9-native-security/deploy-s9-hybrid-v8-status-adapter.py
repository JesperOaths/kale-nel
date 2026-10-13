#!/usr/bin/env python3
"""Guardedly make HA read-only garden status aware of S9+ hybrid detector v8.

One tiny backend module replacement; never touches 4K originals, phone app,
media proxy authentication, Home Assistant dashboards, or camera controls.
"""
import datetime as dt,hashlib,importlib.util,json,os
from pathlib import Path
import py_compile,stat,subprocess,tempfile,time,urllib.request

TARGET=Path("/home/jespern/c720p-home-hub/bin/s9_phone_garden_status.py")
BACK=Path("/home/jespern/c720p-home-hub/backups/s9-person-v8-status-adapter")
SHA="570837a0d2151a66eaa4e6309490b20d4278893e"
URL="https://raw.githubusercontent.com/JesperOaths/kale-nel/"+SHA+"/ops/c720p/s9-person-ml-v1/s9_phone_garden_status.py"
VERSION="person_multiscale_threeframe_static_v8"

def read(url,limit=20000):
 with urllib.request.urlopen(url,timeout=17) as r:raw=r.read(limit+1)
 if len(raw)>limit:raise RuntimeError("unexpected_response_size")
 return raw
def status():
 return json.loads(read("http://127.0.0.1:8794/new/api/live-person-watch",20000))
def archives():
 return tuple(len(json.loads(read("http://127.0.0.1:8794/new/api/"+p,1300000)).get("events",[]))
     for p in ("saved","drive-saved"))
def sha(raw):return hashlib.sha256(raw).hexdigest()
def atomic(path,body,st):
 fd,p=tempfile.mkstemp(prefix=".s9-person-v8-telemetry-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as f:f.write(body);f.flush();os.fsync(f.fileno())
  os.chmod(p,stat.S_IMODE(st.st_mode))
  try:os.chown(p,st.st_uid,st.st_gid)
  except PermissionError:pass
  os.replace(p,path)
 finally:
  if os.path.exists(p):os.unlink(p)
def restart():
 result=subprocess.run(["systemctl","--user","restart","c720p-drive-security-archive.service"],
  capture_output=True,text=True,timeout=42)
 if result.returncode:raise RuntimeError("archive_upstream_restart_failed:"+result.stderr[-250:])
def healthy(before):
 last=None
 for _ in range(35):
  try:
   r=status()
   if (r.get("ok") is not True or r.get("detector_version")!=VERSION or
       r.get("detector_multiscale_version")!="garden_overlapping_person_tiles_v8" or
       r.get("detector_inference_passes")!=3 or r.get("person_periodic_checks",0)<1 or
       r.get("person_inference_backend")!="gpu"):
    raise RuntimeError("v8_phone_status_not_authorized_or_unavailable")
   now=archives()
   if now[0]<before[0] or now[1]<before[1]:raise RuntimeError("archive_catalog_regressed")
   return r,now
  except Exception as e:last=e;time.sleep(.35)
 raise RuntimeError("status_adapter_validation_failed:"+str(last))
def main():
 if not TARGET.is_file() or TARGET.is_symlink():raise RuntimeError("old_module_not_found")
 old=TARGET.read_bytes();source=old.decode("utf-8")
 if "person_spatial_motion_corroborated_v7" not in source or "KNOWN_DETECTORS" not in source:
  raise RuntimeError("unexpected_existing_status_adapter")
 existing=archives()
 reference=read(URL,16000)
 if len(reference)<4000 or VERSION.encode() not in reference or b"person_periodic_checks" not in reference:
  raise RuntimeError("pinned_status_adapter_missing_features")
 # Preserve the entire live adapter and any site-specific fixes: insert only
 # the new version literal plus the small v8 telemetry field group.
 oldMarker='    "person_spatial_motion_corroborated_v7",'
 newMarker=oldMarker+'\\n    "person_multiscale_threeframe_static_v8",'
 oldFields='      "detector_version":phone.get("motion_detector"),'
 if source.count(oldMarker)!=1 or source.count(oldFields)!=1:
  raise RuntimeError("production_status_adapter_contract_changed")
 contract=reference.decode("utf-8")
 fieldBegin=contract.find('      "detector_multiscale_version":')
 fieldEnd=contract.find('      "roi_mask_version":',fieldBegin)
 if fieldBegin<0 or fieldEnd<0:raise RuntimeError("reference_v8_fields_missing")
 insert=contract[fieldBegin:fieldEnd]
 patched=source.replace(oldMarker,newMarker.replace('\\n','\\n'),1)
 patched=patched.replace(oldFields,oldFields+'\\n'+insert.rstrip('\\n'),1)
 new=patched.encode("utf-8")
 with tempfile.TemporaryDirectory(prefix="s9-person-v8-status-preflight-") as td:
  f=Path(td)/"s9_phone_garden_status.py";f.write_bytes(new)
  py_compile.compile(str(f),doraise=True)
  spec=importlib.util.spec_from_file_location("staged_s9_v8_status",f)
  mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
  # Reject unavailable sensor versions, accept the exact live S9 v8.
  with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=10) as r:phone=json.load(r)
  a=mod.from_phone(phone)
  if a.get("ok") is not True or a.get("detector_version")!=VERSION:
   raise RuntimeError("staged_adapter_refuses_live_phone")
 BACK.mkdir(parents=True,exist_ok=True);os.chmod(BACK,0o700)
 folder=BACK/dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 folder.mkdir(mode=0o700)
 backup=folder/TARGET.name;backup.write_bytes(old);os.chmod(backup,0o600)
 if sha(backup.read_bytes())!=sha(old):raise RuntimeError("old_module_backup_failed")
 st=TARGET.stat()
 if sha(TARGET.read_bytes())!=sha(old):raise RuntimeError("concurrent_file_change")
 try:
  atomic(TARGET,new,st)
  restart()
  report,counts=healthy(existing)
  print("S9_HYBRID_V8_HA_STATUS_RESTORED",json.dumps({
   "hub_status_ok":report["ok"],"detector":report["detector_version"],
   "tile_passes":report["detector_inference_passes"],
   "periodic_checks":report.get("person_periodic_checks"),
   "gpu_inference_ms":report.get("person_gpu_inference_ms"),
   "archive_counts":counts,"backup":str(backup),"camera_unmodified":True},sort_keys=True),flush=True)
 except BaseException:
  atomic(TARGET,old,st)
  try:restart()
  except Exception:pass
  print("S9_HYBRID_V8_HA_STATUS_ROLLED_BACK",flush=True)
  raise
if __name__=="__main__":main()
