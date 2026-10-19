#!/usr/bin/env python3
"""Read-only audit of the *live* C720P legacy Save and index contracts.

Never invokes Save, regenerates production index, restarts recorder, changes
events or clips, or exposes names/URLs/persons. This is NOT a deletion permit.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import re
import subprocess
import urllib.request

CAMERA_SOURCE=Path("/home/jespern/c720p-security-camera-new/c720p-frontyard-security-new.py")
STATIC=Path("/opt/homeassistant/config/www/frontyard-security-new")
INDEX=STATIC/"index.html"
PLAYER=STATIC/"clips.html"
BRIDGE=STATIC/"c720p-migrated-index-playback-v1.js"
EVENTS=STATIC/"events.json"
SRC_MAX=500000
ASSET_MAX=500000
BRIDGE_SHA256="8246223af7abb26aece0ac6cbf8b84bd698a2600c790e33ad0d7be22a9414ae2"
UNITS=("c720p-legacy-s9-index-bridge-guard-v1.path",
       "c720p-legacy-s9-index-bridge-guard-v1.timer")
MARK="C720P_LEGACY_SAVE_RETIREMENT_V149_AUDITED "

def read(path,max_bytes=ASSET_MAX):
 if path.is_symlink() or not path.is_file():
  raise RuntimeError("missing_or_unsafe_runtime_asset")
 stat=path.stat()
 if not 100<=stat.st_size<=max_bytes or stat.st_nlink!=1:
  raise RuntimeError("untrusted_runtime_asset_length")
 out=path.read_bytes()
 if len(out)!=stat.st_size or path.stat().st_mtime_ns!=stat.st_mtime_ns:
  raise RuntimeError("runtime_asset_changed_during_read")
 return out

def unit_state():
 for name in UNITS:
  result=subprocess.run(["systemctl","--user","is-active",name],
                         capture_output=True,text=True,timeout=10)
  if result.returncode or result.stdout.strip()!="active":
   raise RuntimeError("index_restoration_unit_inactive")
 return True

def camera_state():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=10) as r:
  if r.status!=200:raise RuntimeError("camera_status_unavailable")
  blob=r.read(65537)
 if len(blob)>65536:raise RuntimeError("unbounded_camera_status")
 status=json.loads(blob)
 if (status.get("ok") is not True or status.get("mode")!="watching"
  or status.get("native_4k_enabled") is not True
  or status.get("continuous_4k_ready") is not True
  or status.get("continuous_4k_dropped_output_frames")!=0
  or status.get("continuous_4k_error")
  or type(status.get("temperature_c")) not in (float,int)
  or not 0<status["temperature_c"]<=39.5):
  raise RuntimeError("camera_busy_or_unhealthy")
 return {"capture_ready":True,"dropped_frames":0,
         "temperature_c":status["temperature_c"]}

def structural(source,index,player,bridge):
 try:tree=ast.parse(source)
 except SyntaxError:raise RuntimeError("generator_python_syntax_failure") from None
 functions={node.name:node for node in ast.walk(tree)
            if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef))}
 if not {"write_html","save_index"}.issubset(functions):
  raise RuntimeError("legacy_index_generator_functions_missing")
 generator=source.decode()
 html=index.decode()
 clips=player.decode()
 js=bridge.decode()
 if hashlib.sha256(bridge).hexdigest()!=BRIDGE_SHA256:
  raise RuntimeError("signed_bridge_content_drift")
 if ("c720p-migrated-index-playback-v1.js" not in generator or
     html.count("<script defer src='c720p-migrated-index-playback-v1.js'></script>")!=1):
  raise RuntimeError("index_generator_or_live_bridge_missing")
 if ("saveClip(" not in html or "clips/" not in html or
     "C720P_MIGRATED_S9_LEGACY_PLAYER_V1" not in clips):
  raise RuntimeError("legacy_save_or_player_missing")
 if ("C720PSecureRelay" not in js or
     "/new/api/c720p-migrated-clips" not in js or
     "/new/saved/c720p-migrated/clip/" not in js):
  raise RuntimeError("authenticated_migrated_bridge_invalid")
 # Counters below are structural, not claims that Save was executed.
 save_html=bool(re.search(r"\b(?:async\s+)?function\s+saveClip\s*\(",html))
 regenerate_calls=sum(1 for node in ast.walk(tree)
      if isinstance(node,ast.Call) and (
       isinstance(node.func,ast.Name) and node.func.id in ("write_html","save_index")
       or isinstance(node.func,ast.Attribute) and node.func.attr in ("write_html","save_index")))
 local_index_templates=("src='{e['clip']}'" in generator or
                        "src='clips/" in generator)
 # Keep relevant call sites as fixed category counts, never dump live source.
 operations=("rename","replace","move","unlink","remove","copy2","copyfile","write_text","write_bytes")
 call_counts={op:0 for op in operations}
 for n in ast.walk(tree):
  if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr in call_counts:
   call_counts[n.func.attr]+=1
 return {
  "python_generator_parsed":True,
  "write_html_declared":True,"save_index_declared":True,
  "current_index_script_exactly_once":True,
  "persistent_generator_script_present":True,
  "generated_index_source_references_local_clips":local_index_templates,
  "legacy_save_function_declared_in_index":save_html,
  "save_ui_controls_present":True,
  "index_regeneration_call_sites":regenerate_calls,
  "file_operation_categories_present":sorted(x for x,n in call_counts.items() if n),
  "legacy_clips_player_present":True,
  "signed_s9_playback_bridge_verified":True,
  "originals_safe_to_delete":False,
 }

def audit():
 unit_state()
 before=camera_state()
 source=read(CAMERA_SOURCE,SRC_MAX)
 index=read(INDEX)
 player=read(PLAYER)
 bridge=read(BRIDGE,20000)
 stats=structural(source,index,player,bridge)
 # Never read original media bytes, and do not disclose event/clip names.
 stats["events_catalog_present"]=EVENTS.is_file() and not EVENTS.is_symlink()
 stats["index_guard_path_and_timer_active"]=True
 stats["camera_ready_before"]=before["capture_ready"]
 after=camera_state()
 stats["camera_ready_after"]=after["capture_ready"]
 stats["camera_dropped_frames_after"]=after["dropped_frames"]
 stats["camera_temperature_after_c"]=after["temperature_c"]
 stats["no_save_actions_invoked"]=True
 stats["no_index_or_event_writes"]=True
 stats["no_recording_or_review_changes"]=True
 print(MARK+json.dumps(stats,sort_keys=True),flush=True)
 return stats

if __name__=="__main__":
 p=argparse.ArgumentParser()
 p.add_argument("--run",action="store_true")
 args=p.parse_args()
 if not args.run:
  print("C720P_LEGACY_SAVE_V149_READONLY "+
   json.dumps({"media_changes":False,"save_calls":0,
               "original_retention_required":True},sort_keys=True))
 else:
  try:audit()
  except Exception:
   # Never leak an exception from a runtime file or private browser state.
   print("C720P_LEGACY_SAVE_V149_NOT_VERIFIED "+
     json.dumps({"failed":True,"original_retention_required":True},sort_keys=True),
     flush=True)
   raise SystemExit(1)
