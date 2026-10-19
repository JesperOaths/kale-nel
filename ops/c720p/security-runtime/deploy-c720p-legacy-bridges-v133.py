#!/usr/bin/env python3
"""One transaction for legacy C720P S9+ playback bridges, never for videos.

The source snapshots and original MP4s remain untouched. Unknown file
versions/permissions, capture health, unexpectedly changed concurrent HTML
or failed generated-index syntax refuse deployment and restore only known
files. No native Camera2, Home Assistant, or legacy recorder restart.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import urllib.request

HOME=Path("/home/jespern/c720p-home-hub")
BACKUPS=HOME/"backups/c720p-legacy-bridges-v133"
LOCK=HOME/"state/c720p-legacy-bridges-v133.lock"
PAGE=Path("/opt/homeassistant/config/www/frontyard-security-new/clips.html")
INDEX=Path("/opt/homeassistant/config/www/frontyard-security-new/index.html")
GENERATOR=Path("/home/jespern/c720p-security-camera-new/c720p-frontyard-security-new.py")
JS=INDEX.parent/"c720p-migrated-index-playback-v1.js"
EXPECTED_OLD={
 PAGE:"91d760a53b973cc4efd2c304ea52d39c281246bba9d5bc12027722f20f921a9b",
 INDEX:"da5f846114d9b56a8ad9b531fb18aec61a743610244192125fe79ef0d71f2d7f",
 GENERATOR:"f9e34bdb12b56678d7057a2e6f56aadac4f973b9d7d7ab90d630b94fe0cf3ad6",
}
SCRIPT_SHA={
 "player":"9918db0cc65eab03025229a149112f799a949a23",
 "index":"f44c3406cfd4093b8e59ba88e08d7ac01c0cbf55",
 "js":"aea571aca83e107532883e1ef183c6290ae194bd",
}
def sha(raw):return hashlib.sha256(raw).hexdigest()
def git_blob(raw):
 return hashlib.sha1(b"blob "+str(len(raw)).encode()+b"\0"+raw).hexdigest()
def read(path,maxsize=450000):
 if path.is_symlink() or not path.is_file() or not 0<path.stat().st_size<maxsize:
  raise RuntimeError("missing_unknown_or_symlink_live_target")
 return path.read_bytes()
def check_camera():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=11) as response:
  if response.status!=200:raise RuntimeError("camera_status_unavailable")
  raw=response.read(65537)
 if len(raw)>65536:raise RuntimeError("camera_status_unbounded")
 d=json.loads(raw)
 if (d.get("ok") is not True or d.get("mode")!="watching"
     or d.get("native_4k_enabled") is not True
     or d.get("continuous_4k_ready") is not True
     or d.get("continuous_4k_dropped_output_frames")!=0
     or d.get("continuous_4k_error")
     or type(d.get("temperature_c")) not in (float,int)
     or not 0<d["temperature_c"]<=39.5
     or type(d.get("continuous_4k_buffered_ms")) is not int
     or d["continuous_4k_buffered_ms"]<6500):
  raise RuntimeError("camera_busy_or_unhealthy")
 if os.statvfs(str(HOME)).f_bavail*os.statvfs(str(HOME)).f_frsize<750*1024*1024:
  raise RuntimeError("hub_disk_reserve_low")
 return d
def load(name,path):
 blob=read(path,200000)
 if git_blob(blob)!=SCRIPT_SHA[name]:
  raise RuntimeError("unrecognized_github_pinned_source_"+name)
 if name=="js":return blob
 spec=importlib.util.spec_from_file_location("c720p_legacy_v133_"+name,str(path))
 obj=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(obj)
 return obj
def atomic(path,data,mode=None):
 if path.is_symlink():raise RuntimeError("symlink_during_legacy_update")
 fd,tmp=tempfile.mkstemp(prefix=".legacy-bridge-v133-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as out:
   original_mode=(stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o644)
   os.fchmod(out.fileno(),original_mode if mode is None else mode)
   out.write(data);out.flush();os.fsync(out.fileno())
  os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def prepare(player,index,js,baseline):
 old_page,old_index,old_source=(baseline[p] for p in (PAGE,INDEX,GENERATOR))
 # Reuse EXACT committed, previously independently unit-tested parsers.
 new_page=player.patch(old_page.decode("utf8")).encode("utf8")
 new_source,new_index=index.preview(old_source,old_index,js)
 if new_page==old_page or new_source==old_source or new_index==old_index:
  raise RuntimeError("legacy_bridge_patch_was_noop")
 expected={"page":new_page,"generated_index":new_index,
           "generator":new_source,"js":js}
 if not all(b"C720PSecureRelay" in data for data in (new_page,js)):
  raise RuntimeError("authenticated_relay_not_required")
 if not all(b"save" in data.lower() for data in (new_page,new_index,new_source)):
  raise RuntimeError("legacy_save_controls_missing")
 return {PAGE:new_page,INDEX:new_index,GENERATOR:new_source,JS:js},expected
def main(player_path,index_path,js_path,apply):
 if LOCK.is_symlink():raise RuntimeError("unexpected_lock_symlink")
 LOCK.parent.mkdir(parents=True,exist_ok=True)
 with LOCK.open("a+") as handle:
  fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
  player=load("player",player_path)
  index=load("index",index_path)
  js=load("js",js_path)
  before=check_camera()
  baseline={p:read(p) for p in (PAGE,INDEX,GENERATOR)}
  if any(not re.fullmatch(r"[a-f0-9]{64}",h) for h in EXPECTED_OLD.values()):
   raise RuntimeError("invalid_pinned_live_baseline_sha256")
  if JS.exists() or JS.is_symlink():
   raise RuntimeError("legacy_s9_bridge_already_present_or_unknown")
  for path,blob in baseline.items():
   if sha(blob)!=EXPECTED_OLD[path]:
    raise RuntimeError("live_legacy_page_or_generator_changed")
  new,summary=prepare(player,index,js,baseline)
  # Validate current source snapshots a second time immediately before write.
  if not apply:
   print("C720P_LEGACY_BRIDGES_V133_PREFLIGHT "+json.dumps({
    "preflight_ok":True,"camera_ready":True,"expected_old_hashes_verified":3,
    "pinned_script_blobs_verified":3,"legacy_save_preserved":True,
    "videos_modified":False,"camera_apk_modified":False,"user_reviews_modified":False
    },sort_keys=True),flush=True)
   return
  backup=BACKUPS/dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
  backup.mkdir(parents=True,mode=0o700,exist_ok=False)
  for i,p in enumerate((PAGE,INDEX,GENERATOR)):
   destination=backup/("original-%d"%i)
   destination.write_bytes(baseline[p]);os.chmod(destination,0o600)
   if read(destination)!=baseline[p]:
    raise RuntimeError("unable_to_verify_private_backup")
  completed=[]
  try:
   for path,data in new.items():
    if path!=JS and read(path)!=baseline[path]:
     raise RuntimeError("live_page_changed_during_deployment")
    if path==JS and (path.exists() or path.is_symlink()):
     raise RuntimeError("another_legacy_bridge_was_installed")
    atomic(path,data)
    completed.append(path)
    if read(path)!=data:
     raise RuntimeError("legacy_bridge_atomic_readback_failed")
   after=check_camera()
   if not all(read(path)==data for path,data in new.items()):
    raise RuntimeError("legacy_page_rewritten_concurrently")
   print("C720P_LEGACY_BRIDGES_V133_VERIFIED "+json.dumps({
    "player_patch":True,"index_patch":True,
    "future_index_generator_patched":True,"js_bridge_staged":True,
    "legacy_save_preserved":True,"original_hashes_backed_up":3,
    "camera_temperature_c":after["temperature_c"],
    "needs_browser_authenticated_relay_test":True,
    "legacy_recorder_restarted":False,
    "source_generator_current_process_not_restarted":True,
    "safe_to_delete_c720p_mp4s":False,
    "videos_modified":False,"camera_apk_modified":False,
    "user_reviews_modified":False},sort_keys=True),flush=True)
  except BaseException:
   refused=[]
   for p in reversed(completed):
    if not p.exists() or read(p)!=new[p]:
     refused.append(p.name);continue
    if p==JS:p.unlink()
    else:atomic(p,baseline[p])
   print("C720P_LEGACY_BRIDGES_V133_ROLLBACK "+
    json.dumps({"restored_known_files":len(completed)-len(refused),
      "unsafe_concurrent_drift":len(refused)>0,
      "videos_modified":False,"camera_apk_modified":False}),flush=True)
   raise
if __name__=="__main__":
 ap=argparse.ArgumentParser()
 ap.add_argument("--player",type=Path,required=True)
 ap.add_argument("--index",type=Path,required=True)
 ap.add_argument("--js",type=Path,required=True)
 ap.add_argument("--apply",action="store_true")
 x=ap.parse_args()
 main(x.player,x.index,x.js,x.apply)
