#!/usr/bin/env python3
"""Non-mutating proof of installed dual S9 media bridge index-restoration logic.

Never runs watcher.apply(), writes index, invokes Save/Delete, restarts recorder
or Camera2, or reads clips/JPEG bytes. Exercises ONLY new_html() on synthetic
HTML after verifying installed watchdog's previously measured exact SHA256.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import subprocess
import urllib.request

HOME=Path("/home/jespern/c720p-home-hub")
WEB=Path("/opt/homeassistant/config/www/frontyard-security-new")
WATCHER=HOME/"bin/c720p_legacy_s9_index_bridge_guard_v1.py"
INDEX=WEB/"index.html"
GENERATOR=Path("/home/jespern/c720p-security-camera-new/c720p-frontyard-security-new.py")
CLIPS=WEB/"clips.html"
JPEG=WEB/"c720p-migrated-snapshot-display-v182.js"
VIDEO=WEB/"c720p-migrated-index-playback-v1.js"
EXPECTED_WATCHER_SHA="2571b0a94c489fa342d6c11c8c28e98c6750a8c898b1b1aa0c4ee542d3caae01"
EXPECTED_JPEG_BLOB="c88704a77b7c764fe514ff18487457b4c89d808b"
EXPECTED_VIDEO_SHA="8246223af7abb26aece0ac6cbf8b84bd698a2600c790e33ad0d7be22a9414ae2"
V="<script defer src='c720p-migrated-index-playback-v1.js'></script>"
J="<script defer src='c720p-migrated-snapshot-display-v182.js'></script>"
C="<script defer src='/local/frontyard-security-new/c720p-migrated-snapshot-display-v182.js'></script>"
MARK="C720P_JPEG_INDEX_REGEN_V191_VERIFIED "

def read(path,max_len):
 if path.is_symlink() or not path.is_file():
  raise RuntimeError("source_absent_or_symlink")
 st=path.stat()
 if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1 or not 100<st.st_size<=max_len:
  raise RuntimeError("source_metadata_invalid")
 raw=path.read_bytes()
 if len(raw)!=st.st_size or path.stat().st_mtime_ns!=st.st_mtime_ns:
  raise RuntimeError("source_changed_during_probe")
 return raw

def capture():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=9) as r:
  if r.status!=200:raise RuntimeError("native_camera_unhealthy")
  b=r.read(65537)
 if len(b)>65536:raise RuntimeError("native_camera_unhealthy")
 d=json.loads(b)
 if (d.get("ok") is not True or d.get("mode")!="watching"
     or d.get("continuous_4k_ready") is not True
     or d.get("continuous_4k_dropped_output_frames")!=0
     or d.get("continuous_4k_error")
     or type(d.get("temperature_c")) not in (int,float)
     or not 0<d["temperature_c"]<39):
  raise RuntimeError("native_camera_unhealthy")
 return d["temperature_c"]

def units():
 for unit in ("c720p-legacy-s9-index-bridge-guard-v1.path",
              "c720p-legacy-s9-index-bridge-guard-v1.timer"):
  p=subprocess.run(["systemctl","--user","is-active",unit],
    capture_output=True,text=True,timeout=8,check=False)
  if p.returncode!=0 or p.stdout.strip()!="active":
   raise RuntimeError("index_regeneration_watcher_inactive")
 return True

def exercise(module):
 title=module.ANCHOR
 old=(title+"<script>function saveClip(n){return n}</script>"
      "<video src='clips/example.mp4' controls></video>"
      "<section>"+"native camera event "*42+"</section>").encode()
 original=old
 fully=module.new_html(old)
 if not isinstance(fully,bytes):raise RuntimeError("watchdog_both_bridges_not_restored")
 html=fully.decode()
 if (html.count(V)!=1 or html.count(J)!=1
     or "function saveClip(n)" not in html
     or "src='clips/example.mp4'" not in html
     or module.new_html(fully) is not None):
  raise RuntimeError("watchdog_dual_script_or_idempotence_invalid")
 video_only=old.decode().replace(title,title+V,1).encode()
 inserted=module.new_html(video_only)
 if (not isinstance(inserted,bytes) or inserted.count(V.encode())!=1
    or inserted.count(J.encode())!=1):
  raise RuntimeError("watchdog_jpeg_restore_after_old_source_invalid")
 jpeg_only=old.decode().replace(title,title+J,1).encode()
 other=module.new_html(jpeg_only)
 if (not isinstance(other,bytes) or other.count(V.encode())!=1
    or other.count(J.encode())!=1):
  raise RuntimeError("watchdog_video_restore_after_old_source_invalid")
 try:module.new_html(fully+J.encode())
 except ValueError:duplicate_refused=True
 else:duplicate_refused=False
 if not duplicate_refused:raise RuntimeError("watchdog_duplicate_fails_open")
 return {"both_missing_restored":True,"jpeg_only_restored":True,
  "video_only_restored":True,"idempotent_with_both_present":True,
  "duplicate_script_refused":True,
  "existing_video_path_preserved":True,"old_save_control_preserved":True}

def run():
 temperature=capture()
 units()
 watch=read(WATCHER,25000)
 index=read(INDEX,1048576).decode()
 source=read(GENERATOR,500000).decode()
 clips=read(CLIPS,500000).decode()
 jpeg=read(JPEG,30000);video=read(VIDEO,30000)
 if hashlib.sha256(watch).hexdigest()!=EXPECTED_WATCHER_SHA:
  raise RuntimeError("watchdog_sha_drift")
 if hashlib.sha256(video).hexdigest()!=EXPECTED_VIDEO_SHA:
  raise RuntimeError("video_playback_source_sha_drift")
 jpeg_blob=hashlib.sha1(b"blob "+str(len(jpeg)).encode()+b"\0"+jpeg).hexdigest()
 if jpeg_blob!=EXPECTED_JPEG_BLOB:raise RuntimeError("snapshot_client_blob_drift")
 if (index.count(V)!=1 or index.count(J)!=1 or source.count(V)!=1
     or source.count(J)!=1 or clips.count(C)!=1 or "saveClip(" not in index):
  raise RuntimeError("real_html_generator_script_parity_invalid")
 spec=importlib.util.spec_from_file_location("verified_legacy_jpeg_watcher_v191",WATCHER)
 module=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(module)
 tested=exercise(module)
 if capture()>39:raise RuntimeError("native_camera_unhealthy")
 print(MARK+json.dumps({
  **tested,"live_legacy_html_script_parity":True,
  "watcher_and_timer_active":True,"watched_python_source_sha_pinned":True,
  "originals_retained":True,"no_index_regenerated":True,
  "no_media_or_review_changes":True,
  "native_4k_zero_drops":True,"temperature_after_c":capture()},sort_keys=True),flush=True)

if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--run",action="store_true")
 opts=p.parse_args()
 if opts.run:
  try:run()
  except Exception:
   print("C720P_JPEG_INDEX_REGEN_V191_NOT_VERIFIED "+json.dumps({
    "source_integrity_not_proven":True,"originals_retained":True},sort_keys=True))
   raise SystemExit(1)
 else:
  print("C720P_JPEG_INDEX_REGEN_V191_PREVIEW "+
    json.dumps({"read_only":True,"synthetic_html_only":True},sort_keys=True))
