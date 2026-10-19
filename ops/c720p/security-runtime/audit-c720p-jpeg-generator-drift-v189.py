#!/usr/bin/env python3
"""Inspect, never modify, source drift before legacy JPEG thumbnail injection.

C720P footage / person reviews / event rows untouched; report source hashes,
known public HTML markers and counts only, never recorder source or filenames.
"""
import argparse
import hashlib
import json
from pathlib import Path
import stat
import subprocess
import urllib.request

HOME=Path("/home/jespern/c720p-home-hub")
WEB=Path("/opt/homeassistant/config/www/frontyard-security-new")
FILES={
 "generator":Path("/home/jespern/c720p-security-camera-new/c720p-frontyard-security-new.py"),
 "watchdog":HOME/"bin/c720p_legacy_s9_index_bridge_guard_v1.py",
 "index":WEB/"index.html",
 "clips":WEB/"clips.html",
 "video_js":WEB/"c720p-migrated-index-playback-v1.js",
 "jpeg_js":WEB/"c720p-migrated-snapshot-display-v182.js"
}
EXPECTED={
 "generator":"d4c792584aeee3d79e2cfa6881f9237fd484963feaa2142b019b25cb4936a08d",
 "watchdog":"f8eccd9d48e13a9d388c22a8dd3d9ea748ef6e113de832256217ae7c30b96712",
 "clips":"fd5ef30d166a630abd3ca084983cc9f4f1dec5b5fff905201d09d9fb158973e3",
 "video_js":"8246223af7abb26aece0ac6cbf8b84bd698a2600c790e33ad0d7be22a9414ae2"
}
VIDEO_TAG="<script defer src='c720p-migrated-index-playback-v1.js'></script>"
JPEG_TAG="<script defer src='c720p-migrated-snapshot-display-v182.js'></script>"
CLIPS_TAG="<script defer src='/local/frontyard-security-new/c720p-migrated-snapshot-display-v182.js'></script>"
CAMERA="http://127.0.0.1:18808/status"
MARK="C720P_JPEG_SOURCE_DRIFT_V189_DIAGNOSED "

def read(path):
 if path.is_symlink() or not path.is_file():raise RuntimeError("unsafe_file")
 st=path.stat()
 if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1 or not 100<st.st_size<1048576:
  raise RuntimeError("unsafe_file")
 blob=path.read_bytes()
 if len(blob)!=st.st_size or path.stat().st_mtime_ns!=st.st_mtime_ns:
  raise RuntimeError("unstable_file")
 return blob

def units():
 return all(subprocess.run(["systemctl","--user","is-active",unit],
   timeout=8,check=False,capture_output=True,text=True).stdout.strip()=="active"
   for unit in ("c720p-legacy-s9-index-bridge-guard-v1.path",
                "c720p-legacy-s9-index-bridge-guard-v1.timer"))

def camera():
 with urllib.request.urlopen(CAMERA,timeout=10) as r:
  if r.status!=200:raise RuntimeError("unhealthy_camera")
  data=json.loads(r.read(65537))
 if (data.get("ok") is not True or data.get("mode")!="watching"
     or data.get("continuous_4k_ready") is not True
     or data.get("continuous_4k_dropped_output_frames")!=0
     or data.get("continuous_4k_error")
     or type(data.get("temperature_c")) not in (int,float)
     or not 0<data["temperature_c"]<39):
  raise RuntimeError("unhealthy_camera")
 return data["temperature_c"]

def classify(raw):
 text={key:value.decode("utf8") for key,value in raw.items()}
 hashes={key:hashlib.sha256(blob).hexdigest() for key,blob in raw.items()}
 matches={key:hashes[key]==expected for key,expected in EXPECTED.items()}
 script={
  "generator_video":text["generator"].count(VIDEO_TAG),
  "generator_jpeg":text["generator"].count(JPEG_TAG),
  "index_video":text["index"].count(VIDEO_TAG),
  "index_jpeg":text["index"].count(JPEG_TAG),
  "clips_jpeg":text["clips"].count(CLIPS_TAG),
  "watchdog_jpeg_constant":text["watchdog"].count("EXPECTED_SNAPSHOT_GIT_BLOB="),
  "watchdog_video_hash_constant":text["watchdog"].count("EXPECTED_BRIDGE_SHA256="),
 }
 if any(n>1 for n in script.values()):
  state="duplicate_bridge_markers"
 elif all(script[k]==1 for k in ("generator_jpeg","index_jpeg",
                                  "clips_jpeg","watchdog_jpeg_constant")):
  state="already_fully_integrated"
 elif any(script[k] for k in ("generator_jpeg","index_jpeg",
                              "clips_jpeg","watchdog_jpeg_constant")):
  state="partial_or_concurrent_integration"
 elif not matches["generator"] and all(matches[k] for k in
      ("watchdog","clips","video_js")) and script["index_video"]==1:
  state="generator_only_drift"
 elif all(matches.values()) and script["index_video"]==1:
  state="v187_pristine_ready"
 else:state="multiple_sources_changed"
 features={
  "generator_write_html_present":text["generator"].count("def write_html(events):")==1,
  "generator_save_route_present":"if parsed.path == '/save':" in text["generator"],
  "generator_delete_route_present":"if parsed.path == '/delete':" in text["generator"],
  "generator_video_bridge_once":script["generator_video"]==1,
  "index_video_bridge_once":script["index_video"]==1,
  "clips_has_original_save_function":"saveClip(" in text["clips"] or "Save" in text["clips"],
  "index_save_function_present":"saveClip(" in text["index"],
  "legacy_camera_clip_paths_present":"clips/" in text["index"],
  "watchdog_replacement_atomic":"os.replace(tmp,INDEX)" in text["watchdog"],
  "watchdog_guard_supports_video":"EXPECTED_BRIDGE_SHA256" in text["watchdog"],
  "jpeg_client_dynamic_images":"MutationObserver" in text["jpeg_js"],
  "jpeg_client_signed_relay":"C720PSecureRelay" in text["jpeg_js"],
 }
 return {
  "source_state":state,
  "source_hashes_sha256":hashes,
  "matches_previous_approved_hash":matches,
  "bridge_marker_counts":script,
  "retained_function_checks":features,
  "physical_apply_allowed_by_this_audit":False,
  "media_or_review_modified":False,
  "local_originals_retained":True,
 }

def run():
 before=camera()
 blobs={key:read(path) for key,path in FILES.items()}
 if not units():raise RuntimeError("watchdog_units_inactive")
 result=classify(blobs)
 after=camera()
 result["camera_ready_before_after"]=True
 result["camera_temperature_after_c"]=after
 result["camera_zero_drops_after"]=True
 result["watchdog_path_timer_active"]=True
 print(MARK+json.dumps(result,sort_keys=True),flush=True)

if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--run",action="store_true")
 args=p.parse_args()
 if args.run:
  try:run()
  except Exception:
   print("C720P_JPEG_SOURCE_DRIFT_V189_UNVERIFIED "+json.dumps({
    "failed":True,"originals_retained":True},sort_keys=True))
   raise SystemExit(1)
 else:
  print("C720P_JPEG_SOURCE_DRIFT_V189_PREVIEW "+json.dumps({
   "read_only":True,"media_or_review_modified":False},sort_keys=True))
