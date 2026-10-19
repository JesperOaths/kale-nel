#!/usr/bin/env python3
"""Low-impact, bounded, read-only C720P root space attribution.

Uses statvfs and exact known directory roots; no filename enumeration, media
decoding, logs, credentials, deletion, pruning or service changes. Source and
final S9 Camera2 health must pass. Scope categories can overlap and MUST NOT
be summed as independent disk usage.
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import urllib.request

CAMERA="http://127.0.0.1:18808/status"
TARGETS={
 "docker_data":"/var/lib/docker",
 "system_logs":"/var/log",
 "apt_cache":"/var/cache/apt",
 "homeassistant_config":"/opt/homeassistant/config",
 "hub_state_and_code":"/home/jespern/c720p-home-hub",
 "user_caches":"/home/jespern/.cache",
 "user_local_data":"/home/jespern/.local/share",
 "system_tmp":"/tmp",
 "system_package_files":"/usr",
}
MARK="C720P_ROOT_SPACE_ATTRIBUTION_V162 "
MAX_SCAN_S=10
MAX_LOAD=5.0

def capture():
 with urllib.request.urlopen(CAMERA,timeout=9) as response:
  if response.status!=200:raise RuntimeError("camera_health_http_failed")
  raw=response.read(65537)
 if len(raw)>65536:raise RuntimeError("camera_health_unbounded")
 d=json.loads(raw)
 if (d.get("ok") is not True or d.get("mode")!="watching"
     or d.get("native_4k_enabled") is not True
     or d.get("continuous_4k_ready") is not True
     or d.get("continuous_4k_dropped_output_frames")!=0
     or d.get("continuous_4k_error")
     or type(d.get("temperature_c")) not in (int,float)
     or not 0<d["temperature_c"]<=38.7
     or type(d.get("continuous_4k_buffered_ms")) is not int
     or d["continuous_4k_buffered_ms"]<6500):
  raise RuntimeError("camera_capture_not_admitted_for_storage_scan")
 return d

def size(path):
 target=Path(path)
 if not target.exists():return {"status":"not_present"}
 if target.is_symlink() or not target.is_dir() or not target.is_absolute():
  return {"status":"unsafe_root_refused"}
 try:
  proc=subprocess.run(
   ["du","-sx","-B1","--",str(target)],capture_output=True,
   text=True,timeout=MAX_SCAN_S,check=False)
 except subprocess.TimeoutExpired:
  return {"status":"scan_timeout"}
 except (OSError,ValueError):
  return {"status":"scanner_unavailable"}
 if proc.returncode!=0:return {"status":"scanner_incomplete"}
 first=proc.stdout.splitlines()
 if len(first)!=1:return {"status":"scanner_format_untrusted"}
 match=re.fullmatch(r"([0-9]{1,15})\s+.+",first[0])
 if not match:return {"status":"scanner_format_untrusted"}
 byte_count=int(match.group(1))
 if byte_count>80*1024**3:return {"status":"unexpected_size_refused"}
 return {"status":"measured","mib":round(byte_count/(1024**2),1)}

def audit():
 before=capture()
 fs=shutil.disk_usage("/")
 report={
  "root_total_mib":round(fs.total/(1024**2),1),
  "root_used_mib":round(fs.used/(1024**2),1),
  "root_free_mib":round(fs.free/(1024**2),1),
  "capture_ready_before":True,
  "scans":{},"non_additive_categories":True,
  "read_only":True,"files_deleted":False,"recordings_modified":False,
  "reviews_modified":False,"clock_modified":False,
 }
 if os.getloadavg()[0]>MAX_LOAD:
  report["status"]="deferred_hub_load"
  return report
 for category,path in TARGETS.items():
  if os.getloadavg()[0]>MAX_LOAD:
   report["scans"][category]={"status":"deferred_hub_load"}
   continue
  report["scans"][category]=size(path)
 after=capture()
 report.update(status="complete",capture_ready_after=True,
               capture_dropped_frames_after=after["continuous_4k_dropped_output_frames"],
               camera_temperature_after_c=after["temperature_c"])
 return report

def main():
 try:
  result=audit()
 except Exception:
  # Exact exception text may contain private paths or network data.
  result={"status":"deferred_health_or_io","read_only":True,
          "files_deleted":False,"recordings_modified":False,
          "reviews_modified":False,"clock_modified":False}
 print(MARK+json.dumps(result,separators=(",",":"),sort_keys=True),flush=True)
 if result["status"]!="complete":raise SystemExit(1)

if __name__=="__main__":main()
