#!/usr/bin/env python3
"""Read-only physical preflight for C720P legacy S9 JPEG bridge installation.

Inspect live HTML, generator and index-restoration code plus SHA-proven S9
JPEG access. No camera, Save/Delete, index, photo, review or service writes.
Produces fixed flags + code digests only; NEVER logs private image identities.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path
import stat
import subprocess
import urllib.request

WWW=Path("/opt/homeassistant/config/www/frontyard-security-new")
SOURCE=Path("/home/jespern/c720p-security-camera-new/c720p-frontyard-security-new.py")
GUARD=Path("/home/jespern/c720p-home-hub/bin/c720p_legacy_s9_index_bridge_guard_v1.py")
INDEX=WWW/"index.html"
CLIPS=WWW/"clips.html"
VIDEO=WWW/"c720p-migrated-index-playback-v1.js"
IMAGE=WWW/"c720p-migrated-snapshot-display-v182.js"
PROOF=Path("/home/jespern/c720p-home-hub/state/c720p-s9-snapshots-v162.json")
MP4=Path("/home/jespern/c720p-home-hub/state/c720p-s9-imported-v2.json")
VID_TAG="<script defer src='c720p-migrated-index-playback-v1.js'></script>"
JPG_TAG="<script defer src='c720p-migrated-snapshot-display-v182.js'></script>"
VID_SHA="8246223af7abb26aece0ac6cbf8b84bd698a2600c790e33ad0d7be22a9414ae2"
MARK="C720P_JPEG_LEGACY_PREFLIGHT_V183_VERIFIED "
UNITS=("c720p-legacy-s9-index-bridge-guard-v1.path",
       "c720p-legacy-s9-index-bridge-guard-v1.timer")
JPG_NAME=re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,139}[.]jpg\Z")

def read(path,maximum,private=False):
 if path.is_symlink() or not path.is_file():raise RuntimeError("required_source_missing")
 st=path.stat()
 if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1 or not 50<st.st_size<=maximum:
  raise RuntimeError("required_source_untrusted")
 if private and stat.S_IMODE(st.st_mode)&0o077:
  raise RuntimeError("private_manifest_permission_drift")
 raw=path.read_bytes()
 if len(raw)!=st.st_size or path.stat().st_mtime_ns!=st.st_mtime_ns:
  raise RuntimeError("source_changed_during_read")
 return raw

def digest(raw):return hashlib.sha256(raw).hexdigest()

def gitblob(raw):
 return hashlib.sha1(b"blob "+str(len(raw)).encode()+b"\0"+raw).hexdigest()

def healthy():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=9) as r:
  if r.status!=200:raise RuntimeError("s9_capture_http_unavailable")
  d=json.loads(r.read(65537))
 if (d.get("ok") is not True or d.get("mode")!="watching"
     or d.get("native_4k_enabled") is not True
     or d.get("continuous_4k_ready") is not True
     or d.get("continuous_4k_dropped_output_frames")!=0
     or d.get("continuous_4k_error")
     or type(d.get("temperature_c")) not in (int,float)
     or not 0<d["temperature_c"]<38.0):
  raise RuntimeError("s9_capture_not_healthy")
 return d["temperature_c"]

def active_unit(unit):
 p=subprocess.run(["systemctl","--user","is-active",unit],capture_output=True,
                  text=True,timeout=10)
 return p.returncode==0 and p.stdout.strip()=="active"

def verify_jpeg():
 snap=json.loads(read(PROOF,2_000_000,private=True))
 mp4=json.loads(read(MP4,2_000_000,private=True))
 if (snap.get("schema_version")!="c720p_s9_snapshots_v162"
    or mp4.get("schema_version")!="c720p_s9_verified_import_v2"
    or not isinstance(snap.get("records"),dict)
    or not isinstance(mp4.get("records"),dict)
    or len(snap["records"])!=6 or len(mp4["records"])!=6
    or sum(row["bytes"] for row in snap["records"].values())!=1_956_743):
  raise RuntimeError("snapshot_migration_manifest_drift")
 name=sorted(snap["records"])[0]
 item=snap["records"][name]
 if not JPG_NAME.fullmatch(name) or ".." in name:
  raise RuntimeError("snapshot_name_untrusted")
 if (not isinstance(item.get("sha256"),str) or
     not re.fullmatch(r"[0-9a-f]{64}",item["sha256"]) or
     not 1000<=item.get("bytes",0)<=5_000_000):
  raise RuntimeError("snapshot_sha_or_size_untrusted")
 for port in (8795,8794):
  url="http://127.0.0.1:"+str(port)+"/new/saved/c720p-migrated/snap/"+name
  with urllib.request.urlopen(url,timeout=28) as r:
   b=r.read(item["bytes"]+1)
   if (r.status!=200 or r.headers.get_content_type()!="image/jpeg"
       or r.headers.get("Content-Length")!=str(item["bytes"])
       or "no-store" not in r.headers.get("Cache-Control","")
       or len(b)!=item["bytes"] or
       hashlib.sha256(b).hexdigest()!=item["sha256"]):
    raise RuntimeError("snapshot_8795_8794_sha_proof_missing")
 return True

def inspect():
 before=healthy()
 if not all(active_unit(x) for x in UNITS):
  raise RuntimeError("index_regeneration_guard_inactive")
 source=read(SOURCE,500_000).decode()
 guard=read(GUARD,100_000).decode()
 index=read(INDEX,1024*1024).decode()
 clips=read(CLIPS,1024*1024).decode()
 video=read(VIDEO,30_000)
 if digest(video)!=VID_SHA or "C720PSecureRelay" not in video.decode():
  raise RuntimeError("original_video_bridge_drift")
 if (source.count("def write_html(events):")!=1
     or source.count(VID_TAG)!=1
     or index.count(VID_TAG)!=1
     or "saveClip(" not in index or "clips/" not in index):
  raise RuntimeError("legacy_index_source_or_controls_changed")
 if (index.count(JPG_TAG)!=0 or source.count(JPG_TAG)!=0
     or clips.count(JPG_TAG)!=0):
  raise RuntimeError("jpeg_script_already_injected_refuse_double_install")
 if (clips.count("</body>")!=1 or
     "C720P_MIGRATED_S9_LEGACY_PLAYER_V1" not in clips):
  raise RuntimeError("legacy_player_shape_changed")
 if ("EXPECTED_BRIDGE_SHA256" not in guard or "os.replace(tmp,INDEX)" not in guard
     or "def new_html(old):" not in guard):
  raise RuntimeError("unknown_regeneration_guard")
 if IMAGE.exists():
  raise RuntimeError("snapshot_display_target_collision")
 verify_jpeg()
 after=healthy()
 return {"camera_ready_before_after":True,"camera_dropped_frames_after":0,
  "camera_temperature_after_c":after,
  "private_snapshot_sha_readback_on_two_ports":True,
  "original_video_bridge_unchanged":True,
  "index_watcher_path_timer_active":True,
  "generator_keeps_video_bridge":True,"index_save_controls_retained":True,
  "clips_player_local_fallback_retained":True,
  "jpeg_bridge_not_yet_live":True,
  "guard_git_blob":gitblob(guard.encode()),
  "generator_sha256":digest(source.encode()),
  "clips_sha256":digest(clips.encode()),
  "index_sha256":digest(index.encode()),
  "no_media_or_person_changes":True,
  "no_service_restarts":True,
  "retirement_authorized":False}

if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--run",action="store_true")
 args=p.parse_args()
 if not args.run:
  print("C720P_JPEG_LEGACY_V183_PREVIEW "+json.dumps({
   "only_reads":True,"no_frontend_write":True,
   "all_originals_required":True},sort_keys=True))
 else:
  try:print(MARK+json.dumps(inspect(),sort_keys=True),flush=True)
  except Exception:
   print("C720P_JPEG_LEGACY_V183_NOT_VERIFIED "+json.dumps({
    "failed":True,"retirement_authorized":False},sort_keys=True),flush=True)
   raise SystemExit(1)
