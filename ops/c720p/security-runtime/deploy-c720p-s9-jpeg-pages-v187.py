#!/usr/bin/env python3
"""Transactional additive S9 JPEG thumbnail script for legacy C720P pages.

Keep the Video bridge and all Save/Delete state. Install no changes to MP4s,
JPGs, Camera2, Home Assistant, the recorder service or human review decisions.
Default is preflight. --apply changes only legacy HTML/generator/watchdog code.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import urllib.request

WEB=Path("/opt/homeassistant/config/www/frontyard-security-new")
HOME=Path("/home/jespern/c720p-home-hub")
GEN=Path("/home/jespern/c720p-security-camera-new/c720p-frontyard-security-new.py")
INDEX=WEB/"index.html"
CLIPS=WEB/"clips.html"
GUARD=HOME/"bin/c720p_legacy_s9_index_bridge_guard_v1.py"
VIDEO=WEB/"c720p-migrated-index-playback-v1.js"
JPEG=WEB/"c720p-migrated-snapshot-display-v182.js"
LOCK=HOME/"state/.c720p-legacy-s9-index-bridge.lock"
BACKUPS=HOME/"backups/c720p-s9-jpeg-pages-v187"
BASE={
 "generator":"d4c792584aeee3d79e2cfa6881f9237fd484963feaa2142b019b25cb4936a08d",
 "clips":"fd5ef30d166a630abd3ca084983cc9f4f1dec5b5fff905201d09d9fb158973e3",
 "guard":"f8eccd9d48e13a9d388c22a8dd3d9ea748ef6e113de832256217ae7c30b96712",
 "video":"8246223af7abb26aece0ac6cbf8b84bd698a2600c790e33ad0d7be22a9414ae2",
}
JPEG_BLOB="c88704a77b7c764fe514ff18487457b4c89d808b"
TITLE="<title>Camera Security</title>"
VIDEO_TAG="<script defer src='c720p-migrated-index-playback-v1.js'></script>"
JPEG_TAG="<script defer src='c720p-migrated-snapshot-display-v182.js'></script>"
CLIPS_TAG="<script defer src='/local/frontyard-security-new/c720p-migrated-snapshot-display-v182.js'></script>"
MAX_SOURCE=350_000
MAX_CLIPS=250_000
MAX_INDEX=1_048_576

class Refused(Exception):pass

def require(ok,code):
 if not ok:raise Refused(code)

def sha(raw):return hashlib.sha256(raw).hexdigest()
def blob(raw):return hashlib.sha1(("blob "+str(len(raw))+"\0").encode()+raw).hexdigest()
def checked(path,limit):
 require(not path.is_symlink() and path.is_file(),"missing_or_symlinked_target")
 st=path.stat()
 require(st.st_nlink==1 and 0<st.st_size<=limit,"untrusted_target_metadata")
 return path.read_bytes()

def add_tag(raw,original,tag,must):
 s=raw.decode("utf8")
 require(s.count(original)==1 and must in s,"original_page_contract_changed")
 require(tag not in s,"already_contains_snapshot_bridge")
 new=s.replace(original,original+tag,1)
 return new.encode()

def patched_guard(raw):
 s=raw.decode("utf8")
 addition=(
  "SNAPSHOT_SCRIPT=\"<script defer src='c720p-migrated-snapshot-display-v182.js'></script>\"\n"
  "SNAPSHOT_BRIDGE=INDEX.parent/\"c720p-migrated-snapshot-display-v182.js\"\n"
  "EXPECTED_SNAPSHOT_GIT_BLOB=\""+JPEG_BLOB+"\"\n"
 )
 anchor="EXPECTED_BRIDGE_SHA256=\""+BASE["video"]+"\"\n"
 require(s.count(anchor)==1 and s.count("def new_html(old):")==1
   and s.count("\ndef snapshot():")==1,"guard_source_contract_changed")
 s=s.replace(anchor,anchor+addition,1)
 before=s.index("def new_html(old):")
 after=s.index("\ndef snapshot():")
 block="""def new_html(old):
    if len(old)<MIN_HTML or len(old)>MAX_HTML:raise ValueError("unbounded_index")
    source=old.decode("utf8")
    html=source
    if MARKER in html:
        if html.count(SCRIPT)!=1:raise ValueError("untrusted_existing_bridge")
    else:
        if html.count(ANCHOR)!=1 or "saveClip(" not in html or "clips/" not in html:
            raise ValueError("unexpected_camera_index_template")
        html=html.replace(ANCHOR,ANCHOR+SCRIPT,1)
    if "c720p-migrated-snapshot-display-v182.js" in html:
        if html.count(SNAPSHOT_SCRIPT)!=1:raise ValueError("untrusted_existing_snapshot_bridge")
    else:
        if html.count(ANCHOR)!=1 or "saveClip(" not in html:
            raise ValueError("unexpected_camera_thumbnail_index")
        html=html.replace(ANCHOR,ANCHOR+SNAPSHOT_SCRIPT,1)
    return None if html==source else html.encode("utf8")
"""
 s=s[:before]+block+s[after:]
 anchor2="        data,st=snapshot()"
 new2=(
  "        if (SNAPSHOT_BRIDGE.is_symlink() or not SNAPSHOT_BRIDGE.is_file()\n"
  "            or hashlib.sha1((\"blob \"+str(SNAPSHOT_BRIDGE.stat().st_size)+\"\\0\").encode()\n"
  "            +SNAPSHOT_BRIDGE.read_bytes()).hexdigest()!=EXPECTED_SNAPSHOT_GIT_BLOB):\n"
  "            print(\"C720P_LEGACY_INDEX_BRIDGE_DEFERRED snapshot_source_drift\");return \"deferred\"\n"
 )
 require(s.count(anchor2)==2,"guard_apply_hook_changed")
 s=s.replace(anchor2,new2+anchor2,1)
 compile(s,str(GUARD),"exec")
 return s.encode()

def prepare():
 require(not LOCK.is_symlink() and LOCK.parent.is_dir(),"unsafe_index_guard_lock")
 before={
  GEN:checked(GEN,MAX_SOURCE),
  INDEX:checked(INDEX,MAX_INDEX),
  CLIPS:checked(CLIPS,MAX_CLIPS),
  GUARD:checked(GUARD,20_000),
  VIDEO:checked(VIDEO,10_000),
  JPEG:checked(JPEG,12_000),
 }
 for label,p in (("generator",GEN),("clips",CLIPS),("guard",GUARD),("video",VIDEO)):
  require(sha(before[p])==BASE[label],"pinned_"+label+"_source_drift")
 require(blob(before[JPEG])==JPEG_BLOB and b"MutationObserver" in before[JPEG],
         "snapshot_jpeg_bridge_unverified")
 idx=before[INDEX].decode()
 require(idx.count(VIDEO_TAG)==1 and idx.count(JPEG_TAG)==0 and
  idx.count(TITLE)==1 and "saveClip(" in idx and "clips/" in idx,
  "index_baseline_untrusted")
 changes={
  GEN:add_tag(before[GEN],VIDEO_TAG,JPEG_TAG,"def write_html(events):"),
  INDEX:add_tag(before[INDEX],VIDEO_TAG,JPEG_TAG,"saveClip("),
  CLIPS:add_tag(before[CLIPS],"</head>",CLIPS_TAG,"C720PSecureRelay"),
  GUARD:patched_guard(before[GUARD])
 }
 compile(changes[GEN],str(GEN),"exec")
 compile(changes[GUARD],str(GUARD),"exec")
 require(all(changes[p]!=before[p] for p in changes),"no_page_changes")
 return before,changes

def camera_ok():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=9) as r:
  d=json.loads(r.read(90_000))
 t=d.get("temperature_c")
 require(d.get("ok") is True and d.get("mode")=="watching"
  and d.get("continuous_4k_ready") is True
  and d.get("continuous_4k_dropped_output_frames")==0
  and type(t) in (float,int) and 0<t<37,"camera_not_safe_for_page_update")
 return t

def atom(path,raw,mode):
 fd,tmp=tempfile.mkstemp(prefix=".s9-jpeg-pages-v187-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as f:
   f.write(raw);f.flush();os.fsync(f.fileno())
  os.chmod(tmp,mode)
  os.replace(tmp,path)
  require(path.read_bytes()==raw,"source_commit_readback_failed")
 finally:
  if os.path.exists(tmp):os.unlink(tmp)

def backup(path,raw,folder):
 target=folder/path.name
 require(not target.exists() and not target.is_symlink(),"backup_collision")
 fd=os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,"wb") as f:
  f.write(raw);f.flush();os.fsync(f.fileno())
 require(target.read_bytes()==raw,"backup_integrity_failed")

def apply():
 # An unexpected symlink must not redirect a writable lock or private backup.
 require(not LOCK.is_symlink() and LOCK.parent.is_dir(),
         "unsafe_index_guard_lock")
 with LOCK.open("a+") as lk:
  try:fcntl.flock(lk,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise Refused("legacy_index_guard_busy")
  before,changes=prepare()
  temperature=camera_ok()
  require(os.statvfs(str(WEB)).f_bavail*os.statvfs(str(WEB)).f_frsize>650*1024*1024,
          "hub_disk_low")
  require(not BACKUPS.is_symlink()
          and (not BACKUPS.exists() or BACKUPS.is_dir()),
          "unsafe_private_backup_directory")
  BACKUPS.mkdir(parents=True,exist_ok=True,mode=0o700)
  require(not BACKUPS.is_symlink() and BACKUPS.is_dir(),
          "unsafe_private_backup_directory")
  os.chmod(BACKUPS,0o700)
  folder=Path(tempfile.mkdtemp(prefix="snapshot-v187-",dir=BACKUPS))
  os.chmod(folder,0o700)
  for path in changes:backup(path,before[path],folder)
  installed=[]
  modes={p:stat.S_IMODE(p.stat().st_mode) for p in changes}
  try:
   # First patch the future generator and persistent guard, then index and
   # Camera Clips. No service restart: only versioned text assets change.
   for target in (GEN,GUARD,INDEX,CLIPS):
    require(checked(target,MAX_SOURCE if target==GEN else
       MAX_INDEX if target==INDEX else MAX_CLIPS if target==CLIPS else 20_000)
       ==before[target],"page_changed_during_staging")
    installed.append(target)
    atom(target,changes[target],modes[target])
   require(camera_ok()<37,"camera_health_after_page_update")
   for target in changes:
    require(checked(target,MAX_SOURCE if target==GEN else
       MAX_INDEX if target==INDEX else MAX_CLIPS if target==CLIPS else 20_000)
       ==changes[target],"page_changed_after_staging")
   return {"state":"installed_verified","snapshot_bridge_in_generator":True,
    "snapshot_bridge_in_watchdog":True,"snapshot_bridge_in_index":True,
    "snapshot_bridge_in_clips":True,"video_bridge_preserved":True,
    "camera_temperature_before_c":temperature,
    "camera2_restarted":False,"legacy_recorder_restarted":False,
    "originals_deleted":False,"save_delete_modified":False,
    "reviews_modified":False}
  except BaseException:
   for path in reversed(installed):
    if path.exists() and path.read_bytes()==changes[path]:
     atom(path,before[path],modes[path])
   raise

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--apply",action="store_true")
 args=ap.parse_args()
 if args.apply:res=apply()
 else:
  before,changes=prepare()
  res={"state":"preflight","source_pins_verified":True,
       "pages_and_watchdog_compile":True,
       "script_already_served":True,
       "no_media_changes":True,"install_requires_apply":True}
 print("C720P_S9_JPEG_PAGES_V187 "+json.dumps(res,sort_keys=True))

if __name__=="__main__":
 try:main()
 except Refused as error:
  print("C720P_S9_JPEG_PAGES_V187 "+json.dumps({
   "state":"deferred","reason":str(error),"media_modified":False},sort_keys=True))
  raise SystemExit(2)
 except Exception:
  print("C720P_S9_JPEG_PAGES_V187 "+json.dumps({
   "state":"failed","reason":"restricted_safety_or_rollback_failure",
   "media_modified":False},sort_keys=True))
  raise SystemExit(1)
