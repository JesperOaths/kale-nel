#!/usr/bin/env python3
"""Safely compact Chromium HTTP and Service Worker CacheStorage only.

Preserve Cookies, IndexedDB, Session Storage, Local Storage, Service Worker
registrations, profile preferences, extension data and Spotify Widevine.
Stop and restore the user browser services before touching profile files.
"""
import argparse
import json
import os
import shutil
import subprocess
import time
import urllib.request
from pathlib import Path

HOME=Path("/home/jespern")
PROFILES=(
 ("kiosk",HOME/".config/c720p-kiosk-chromium","c720p-home-hub-kiosk.service"),
 ("spotify",HOME/".config/c720p-spotify-chromium","c720p-spotify-browser.service"),
)
ONLY_CACHES=(
 "Default/Service Worker/CacheStorage",
 "Default/Cache",
 "Default/Code Cache",
 "Default/GPUCache",
 "Default/ShaderCache",
 "Default/GrShaderCache",
 "Default/DawnCache",
 "GPUPersistentCache",
)
MAX_CACHE_BYTES=500*1024*1024
MAX_TOTAL_BYTES=750*1024*1024

def run(*args,timeout=30):
 try:
  p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
  return p.returncode,p.stdout.strip()[:280]
 except Exception:return 98,"unavailable"

def active(unit):
 code,out=run("systemctl","--user","is-active",unit)
 return code==0 and out=="active"

def browser_references(profile):
 needle=str(profile).encode()
 for proc in Path("/proc").iterdir():
  if not proc.name.isdecimal():continue
  try:
   args=(proc/"cmdline").read_bytes()
   if needle in args and (b"chromium" in args or b"chrome" in args):
    return True
  except OSError:pass
 return False

def bytes_under(root):
 total=0
 original=root.lstat()
 if original.st_dev!=Path("/").stat().st_dev:raise RuntimeError("other_filesystem")
 for parent,dirs,files in os.walk(root,followlinks=False):
  for name in list(dirs):
   p=Path(parent)/name
   st=p.lstat()
   if p.is_symlink():dirs.remove(name);continue
   if st.st_dev!=original.st_dev:raise RuntimeError("cross_device")
  for name in files:
   p=Path(parent)/name
   st=p.lstat()
   if st.st_dev!=original.st_dev:raise RuntimeError("cross_device")
   total+=st.st_blocks*512
   if total>MAX_CACHE_BYTES:raise RuntimeError("unexpected_cache_size")
 return total

def valid_cache(profile,path):
 if profile.is_symlink() or not profile.is_dir():return False
 if path.is_symlink() or not path.is_dir():return False
 if not path.is_relative_to(profile):return False
 if path.relative_to(profile).as_posix() not in ONLY_CACHES:return False
 for parent in (path, *path.parents):
  if parent==profile.parent:break
  if parent.is_symlink():return False
 return True

def phone_health():
 try:
  with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=8) as f:
   s=json.load(f)
  return bool(s.get("ok") is True and s.get("mode")=="watching"
   and s.get("continuous_4k_ready") is True
   and s.get("garden_person_gate_backend")=="gpu")
 except Exception:return False

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--apply",action="store_true")
 args=parser.parse_args()
 before=shutil.disk_usage("/").free
 report={"mode":"apply" if args.apply else "dry_run",
  "free_before_bytes":before,"recordings_deleted":False,
  "sessions_deleted":False,"profiles_deleted":False,
  "services":[],"deleted":[],"skipped":[]}
 if not phone_health():
  report["status"]="camera_health_preflight_failed"
  print("C720P_CHROMIUM_CACHE_GUARD "+json.dumps(report,sort_keys=True),flush=True)
  return
 total=0
 for name,profile,unit in PROFILES:
  targets=[]
  for suffix in ONLY_CACHES:
   p=profile/suffix
   if valid_cache(profile,p):
    try:targets.append((p,bytes_under(p)))
    except Exception as e:report["skipped"].append({"path":str(p),"reason":type(e).__name__})
  amount=sum(size for _,size in targets)
  rec={"service":name,"target_mib":round(amount/1048576,1),
     "was_active":active(unit),"stopped":False,"restored":False}
  report["services"].append(rec)
  if not targets:
   rec["status"]="no_regenerable_cache"
   continue
  if total+amount>MAX_TOTAL_BYTES:
   rec["status"]="total_limit"
   continue
  if not args.apply:
   rec["status"]="preview"
   total+=amount
   continue
  # Never take down a browser if its user bus is not reachable.
  code,_=run("systemctl","--user","show",unit,"--property=LoadState")
  if code!=0:
   rec["status"]="user_systemd_unavailable"
   continue
  try:
   if rec["was_active"]:
    code,_=run("systemctl","--user","stop",unit,timeout=40)
    if code!=0:
     rec["status"]="service_stop_failed"
     continue
    for _ in range(6):
     if not active(unit) and not browser_references(profile):break
     time.sleep(1)
   if active(unit) or browser_references(profile):
    rec["status"]="browser_still_using_profile"
    continue
   rec["stopped"]=True
   for p,size in targets:
    if not valid_cache(profile,p) or browser_references(profile) or active(unit):
     report["skipped"].append({"path":str(p),"reason":"profile_reactivated"})
     continue
    try:
     if bytes_under(p)>MAX_CACHE_BYTES:raise RuntimeError("size_limit")
     shutil.rmtree(p)
     report["deleted"].append({"path":str(p),"allocated_bytes":size})
     total+=size
    except Exception as exc:
     report["skipped"].append({"path":str(p),"reason":type(exc).__name__})
   rec["status"]="cleanup_attempted"
  finally:
   if rec["was_active"]:
    code,_=run("systemctl","--user","start",unit,timeout=55)
    rec["restored"]=code==0 and active(unit)
   else:rec["restored"]=not active(unit)
 report["cache_bytes_removed_estimate"]=total
 report["free_after_bytes"]=shutil.disk_usage("/").free
 report["net_freed_bytes"]=report["free_after_bytes"]-before
 report["camera_healthy_after"]=phone_health()
 # Report V27's disk readiness without changing camera APKs or touching
 # non-cache files. The guarded V27 builder still enforces its own floor.
 report["v27_ram_stage_disk_min_mib"]=210
 report["v27_ram_stage_disk_ready"]=report["free_after_bytes"]>=210*1024**2
 report["status"]="finished"
 print("C720P_CHROMIUM_CACHE_GUARD "+json.dumps(report,sort_keys=True),flush=True)

if __name__=="__main__":main()
