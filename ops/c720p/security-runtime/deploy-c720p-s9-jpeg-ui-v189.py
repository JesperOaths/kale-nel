#!/usr/bin/env python3
"""Activate only S9+ migrated-JPEG *display* in C720P legacy pages.

No original MP4/JPEG, manifest, saved-event, Save/Delete route, recorder,
camera APK, identity registry, credential, or capture setting is touched.
Before any write, refuse file SHA drift and unverified static bridge bytes.
Install in an atomic four-file transaction with private rollback copies.
The legacy generator watchdog is upgraded to preserve the new tag after
an older in-memory template regenerates index.html.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import urllib.request

ROOT=Path("/opt/homeassistant/config/www/frontyard-security-new")
HUB=Path("/home/jespern/c720p-home-hub")
PLAYER=ROOT/"clips.html"
INDEX=ROOT/"index.html"
GENERATOR=Path("/home/jespern/c720p-security-camera-new/c720p-frontyard-security-new.py")
GUARD=HUB/"bin/c720p_legacy_s9_index_bridge_guard_v1.py"
BRIDGE=ROOT/"c720p-migrated-snapshot-display-v182.js"
VIDEO="<script defer src='c720p-migrated-index-playback-v1.js'></script>"
PHOTO="<script defer src='c720p-migrated-snapshot-display-v182.js'></script>"
PREVIOUS={
 PLAYER:"fd5ef30d166a630abd3ca084983cc9f4f1dec5b5fff905201d09d9fb158973e3",
 INDEX:"35c146ecb513c483256c2e30dee635a1c96996474f4b247f0830208d790e0485",
 GENERATOR:"d4c792584aeee3d79e2cfa6881f9237fd484963feaa2142b019b25cb4936a08d",
 GUARD:"f8eccd9d48e13a9d388c22a8dd3d9ea748ef6e113de832256217ae7c30b96712",
}
BRIDGE_SHA="339d98d5aa704a648720463e72b03b216af07cfa9c7aae01f952d95e408456d6"
LOCK=HUB/"state/.c720p-jpeg-ui-v189.lock"
BACKUP=HUB/"backups/c720p-s9-jpeg-ui-v189"
def sha(b):return hashlib.sha256(b).hexdigest()
def read(p,maximum=1500000):
 if p.is_symlink() or not p.is_file() or not 0<p.stat().st_size<=maximum:
  raise RuntimeError("unsafe_or_missing_live_artifact")
 return p.read_bytes()
def camera():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=10) as r:
  if r.status!=200:raise RuntimeError("camera_status_unavailable")
  b=r.read(65537)
 if len(b)>65536:raise RuntimeError("camera_status_unbounded")
 s=json.loads(b)
 if (s.get("ok") is not True or s.get("mode")!="watching"
    or s.get("native_4k_enabled") is not True or
    s.get("continuous_4k_ready") is not True or
    s.get("continuous_4k_dropped_output_frames")!=0 or
    s.get("continuous_4k_error") or
    type(s.get("temperature_c")) not in (int,float) or
    not 0<s["temperature_c"]<=39.5 or
    type(s.get("continuous_4k_buffered_ms")) is not int or
    s["continuous_4k_buffered_ms"]<6500):
  raise RuntimeError("native_camera_capture_not_safe")
 return s
def patch_guard(old):
 text=old.decode("utf8")
 # Keep watchdog's existing authenticated MP4 bridge, SHA protection,
 # atomic no-lost-updates and backup rules unchanged.
 original="""MARKER="c720p-migrated-index-playback-v1.js"
ANCHOR="<title>Camera Security</title>"
"""
 addition="""MARKER="c720p-migrated-index-playback-v1.js"
JPEG_SCRIPT="<script defer src='c720p-migrated-snapshot-display-v182.js'></script>"
JPEG_MARKER="c720p-migrated-snapshot-display-v182.js"
JPEG_BRIDGE=INDEX.parent/"c720p-migrated-snapshot-display-v182.js"
EXPECTED_JPEG_SHA256="339d98d5aa704a648720463e72b03b216af07cfa9c7aae01f952d95e408456d6"
ANCHOR="<title>Camera Security</title>"
"""
 if text.count(original)!=1:raise RuntimeError("unknown_guard_constant_shape")
 text=text.replace(original,addition)
 old_code="""    if MARKER in html:
        if html.count(SCRIPT)!=1:raise ValueError("untrusted_existing_bridge")
        return None
    if html.count(ANCHOR)!=1 or "saveClip(" not in html or "clips/" not in html:
        raise ValueError("unexpected_camera_index_template")
    return html.replace(ANCHOR,ANCHOR+SCRIPT,1).encode("utf8")
"""
 new_code="""    if MARKER in html and html.count(SCRIPT)!=1:
        raise ValueError("untrusted_existing_bridge")
    if JPEG_MARKER in html and html.count(JPEG_SCRIPT)!=1:
        raise ValueError("untrusted_existing_snapshot_bridge")
    if html.count(ANCHOR)!=1 or "saveClip(" not in html or "clips/" not in html:
        raise ValueError("unexpected_camera_index_template")
    revised=html if MARKER in html else html.replace(ANCHOR,ANCHOR+SCRIPT,1)
    if JPEG_MARKER not in revised:
        revised=revised.replace(SCRIPT,SCRIPT+JPEG_SCRIPT,1)
    return None if revised==html else revised.encode("utf8")
"""
 if text.count(old_code)!=1:raise RuntimeError("unknown_guard_function_shape")
 text=text.replace(old_code,new_code)
 existing_check="""        data,st=snapshot()
        if data is None:
            print("C720P_LEGACY_INDEX_BRIDGE_DEFERRED regenerating")
"""
 protected_check="""        if (JPEG_BRIDGE.is_symlink() or not JPEG_BRIDGE.is_file() or
            digest(JPEG_BRIDGE.read_bytes())!=EXPECTED_JPEG_SHA256):
            print("C720P_LEGACY_INDEX_BRIDGE_DEFERRED signed_jpeg_script_drift")
            return "deferred"
        data,st=snapshot()
        if data is None:
            print("C720P_LEGACY_INDEX_BRIDGE_DEFERRED regenerating")
"""
 if text.count(existing_check)!=1:raise RuntimeError("unknown_guard_snapshot_gate")
 text=text.replace(existing_check,protected_check)
 old_preview="""            "would_patch":bool(data and MARKER.encode() not in data
                         and new_html(data) is not None),"""
 new_preview="""            "would_patch":bool(data and new_html(data) is not None),"""
 if text.count(old_preview)!=1:raise RuntimeError("unknown_guard_preview_shape")
 text=text.replace(old_preview,new_preview)
 compile(text,str(GUARD),"exec")
 return text.encode("utf8")
def patch(old):
 p,g,i,guard=(old[k] for k in (PLAYER,GENERATOR,INDEX,GUARD))
 player=p.decode("utf8")
 generator=g.decode("utf8")
 index=i.decode("utf8")
 if (player.count("</head>")!=1 or "C720PSecureRelay" not in player or
     "C720P_MIGRATED_S9_LEGACY_PLAYER_V1" not in player):
  raise RuntimeError("unknown_legacy_player_structure")
 if (index.count(VIDEO)!=1 or generator.count(VIDEO)!=1 or
     index.count("<title>Camera Security</title>")!=1 or
     generator.count("<title>Camera Security</title>")!=1 or
     "def write_html(events):" not in generator or
     "saveClip(" not in index or "saveClip(" not in generator):
  raise RuntimeError("unknown_legacy_index_generator")
 if PHOTO in player or PHOTO in generator or PHOTO in index:
  raise RuntimeError("snapshot_display_already_installed_or_drifted")
 new_player=player.replace("</head>",PHOTO+"</head>",1)
 new_index=index.replace(VIDEO,VIDEO+PHOTO,1)
 new_generator=generator.replace(VIDEO,VIDEO+PHOTO,1)
 for before,after in ((player,new_player),(index,new_index),(generator,new_generator)):
  if after.replace(PHOTO,"")!=before:
   raise RuntimeError("unexpected_legacy_feature_mutation")
 compile(new_generator,str(GENERATOR),"exec")
 return {PLAYER:new_player.encode(),INDEX:new_index.encode(),
         GENERATOR:new_generator.encode(),GUARD:patch_guard(guard)}
def atomic(path,data):
 if path.is_symlink():raise RuntimeError("unsafe_write_target")
 mode=stat.S_IMODE(path.stat().st_mode)
 fd,tmp=tempfile.mkstemp(prefix=".jpeg-bridge-v189-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as out:
   os.fchmod(out.fileno(),mode)
   out.write(data);out.flush();os.fsync(out.fileno())
  os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def verify_served():
 # The linked snapshot bridge is already deployed and served; compare
 # unchanged exact bytes instead of altering any media on phone or hub.
 for name,marker in (("clips.html",b"c720p-migrated-snapshot-display-v182.js"),
                     ("index.html",b"c720p-migrated-snapshot-display-v182.js"),
                     ("c720p-migrated-snapshot-display-v182.js",b"C720P_MIGRATED_S9_SNAPSHOT_DISPLAY_V182")):
  url="http://127.0.0.1:8123/local/frontyard-security-new/"+name+"?v189=1"
  with urllib.request.urlopen(url,timeout=11) as r:
   if r.status!=200:raise RuntimeError("home_assistant_legacy_serve_failed")
   b=r.read(1600001)
  disk=read(ROOT/name)
  if len(b)>1600000 or b!=disk or marker not in b:
   raise RuntimeError("home_assistant_snapshot_bridge_byte_drift")
def main(apply):
 if LOCK.is_symlink():raise RuntimeError("unsafe_lock")
 LOCK.parent.mkdir(parents=True,exist_ok=True)
 with LOCK.open("a+") as handle:
  fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
  pre=camera()
  if sha(read(BRIDGE,20000))!=BRIDGE_SHA:
   raise RuntimeError("unexpected_staged_jpeg_bridge_sha")
  original={p:read(p) for p in PREVIOUS}
  if (any(not re.fullmatch(r"[a-f0-9]{64}",x) for x in PREVIOUS.values())
      or any(sha(original[p])!=PREVIOUS[p] for p in PREVIOUS)):
   raise RuntimeError("unknown_newer_live_legacy_source")
  updated=patch(original)
  if not apply:
   print("C720P_JPEG_UI_V189_PREFLIGHT "+json.dumps({
     "matched_legacy_pages":3,"matched_guard":True,
     "staged_js_sha_verified":True,"source_writes":False,
     "originals_deleted":False,"review_data_modified":False},sort_keys=True),flush=True)
   return
  backup=BACKUP/dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
  backup.mkdir(parents=True,exist_ok=False,mode=0o700)
  for n,(p,data) in enumerate(original.items()):
   target=backup/("file-"+str(n))
   target.write_bytes(data);os.chmod(target,0o600)
   if read(target)!=data:raise RuntimeError("backup_mismatch_before_write")
  installed=[]
  try:
   for p,updated_bytes in updated.items():
    if read(p)!=original[p]:raise RuntimeError("concurrent_page_change")
    atomic(p,updated_bytes);installed.append(p)
    if read(p)!=updated_bytes:raise RuntimeError("post_install_file_mismatch")
   verify_served()
   final=camera()
   print("C720P_JPEG_UI_V189_VERIFIED "+json.dumps({
      "legacy_clips_page_tag_installed":True,
      "generated_index_tag_installed":True,
      "future_index_generator_tag_installed":True,
      "index_watchdog_regeneration_supported":True,
      "all_served_files_identical":True,
      "source_sha_verified":True,"local_jpeg_fallback_preserved":True,
      "browser_decode_still_requires_check":True,
      "recording_service_restarted":False,
      "all_recordings_preserved":True,"all_snapshots_preserved":True,
      "save_delete_routes_modified":False,"manual_reviews_modified":False,
      "native_camera_apk_modified":False,"camera_temperature_c":final["temperature_c"]
   },sort_keys=True),flush=True)
  except BaseException:
   not_restored=[]
   for p in reversed(installed):
    try:
     if read(p)!=updated[p]:not_restored.append(p.name);continue
     atomic(p,original[p])
    except Exception:not_restored.append(p.name)
   print("C720P_JPEG_UI_V189_ROLLBACK "+json.dumps({
     "known_files_restored":len(installed)-len(not_restored),
     "unrestored_drift_count":len(not_restored),
     "media_deleted":False,"camera_apk_modified":False
   },sort_keys=True),flush=True)
   raise
if __name__=="__main__":
 ap=argparse.ArgumentParser();ap.add_argument("--apply",action="store_true")
 a=ap.parse_args()
 main(a.apply)
