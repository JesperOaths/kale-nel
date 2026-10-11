#!/usr/bin/env python3
"""Reclaim only Chromium's regenerable headless HTTP/GPU caches.

Never remove Chrome profiles, cookies, credentials, recordings, thumbnails,
source, benchmarks, models, backups, APKs or Home Assistant state.
"""
import collections
import json
import os
from pathlib import Path
import shutil

HOME=Path("/home/jespern")
BASE=HOME/".cache/chromium-headless"
BUILD=HOME/"c720p-home-hub/build/s9-detector-benchmark"
SUBPATHS=[
 "Cache",
 "Code Cache",
 "GPUCache",
 "ShaderCache",
 "GrShaderCache",
 "DawnCache",
 "Default/Cache",
 "Default/Code Cache",
 "Default/GPUCache",
 "Default/ShaderCache",
 "Default/GrShaderCache",
 "Default/DawnCache",
 "Default/Service Worker/CacheStorage"
]
def occupied():
 try:
  for d in Path("/proc").iterdir():
   if not d.name.isdigit():continue
   try:
    raw=(d/"cmdline").read_bytes()[:8192].decode("utf-8","replace")
   except (OSError,PermissionError):continue
   cmd=raw.replace("\0"," ").lower()
   if ("chromium" in cmd or "chrome" in cmd) and "chromium-headless" in cmd:
    return True
 except Exception:return True
 return False
def bytes_under(root):
 total=0
 try:
  for d,dirs,files in os.walk(root,followlinks=False):
   dirs[:]=[x for x in dirs if not (Path(d)/x).is_symlink()]
   for n in files:
    try:
     p=Path(d)/n
     if not p.is_symlink():total+=p.stat().st_size
    except OSError:pass
 except Exception:return 0
 return total
def benchmark_inspect():
 if not BUILD.is_dir() or BUILD.is_symlink():return {}
 files=collections.Counter();bytes_count=collections.Counter()
 for d,dirs,names in os.walk(BUILD,followlinks=False):
  dirs[:]=[x for x in dirs if not (Path(d)/x).is_symlink()]
  for name in names:
   p=Path(d)/name
   if p.is_symlink():continue
   ext=p.suffix.lower()[:20] or "[no_extension]"
   try:
    size=p.stat().st_size
    files[ext]+=1;bytes_count[ext]+=size
   except OSError:continue
 return {"files_by_extension":dict(files.most_common(12)),
   "mb_by_extension":{key:round(n/(1024**2),1) for key,n in bytes_count.most_common(12)}}
def run():
 result={"target":"Chromium headless regenerable caches only",
 "operation":"safe_cache_cleanup","backup_deleted":False,"video_deleted":False,
 "detector_build_deleted":False,"headless_profile_deleted":False,
 "benchmark_only_inspected":benchmark_inspect(),"items":[]}
 before=shutil.disk_usage("/").free
 result["free_mb_before"]=round(before/(1024**2),1)
 if not BASE.is_dir() or BASE.is_symlink() or BASE.resolve()!=BASE:
  result["status"]="not_applicable_or_profile_symlink"
 elif occupied():
  result["status"]="skipped_profile_in_use"
 else:
  candidates=[]
  # Headless Chromium creates a fresh scoped_dirXXXXXX profile per diagnostic.
  # Only its HTTP/GPU caches are disposable. Do NOT remove scoped profiles,
  # cookies, storage, Service Worker registrations or session files.
  scoped=[]
  for profile in BASE.iterdir():
   if profile.is_symlink() or not profile.is_dir():continue
   if not __import__("re").fullmatch(r"scoped_dir[A-Za-z0-9]{6,16}",profile.name):continue
   if profile.resolve()!=profile:continue
   for suffix in ("Default/Cache","Default/Code Cache","Default/GPUCache",
                  "Default/Service Worker/CacheStorage"):
    scoped.append(profile.name+"/"+suffix)
  for suffix in SUBPATHS+scoped:
   target=BASE/suffix
   if not target.is_dir() or target.is_symlink():continue
   if target.resolve()!=target:continue
   if not target.resolve().is_relative_to(BASE.resolve()):continue
   size=bytes_under(target)
   if size>260*1024*1024:
    result["items"].append({"cache":suffix,"status":"too_large_skipped"})
    continue
   candidates.append((suffix,target,size))
  if sum(x[2] for x in candidates)>280*1024*1024:
   result["status"]="unexpected_cache_volume_skipped"
  else:
   for suffix,target,size in candidates:
    try:
     shutil.rmtree(target)
     result["items"].append({"cache":suffix,"status":"removed","size_mb":round(size/(1024**2),1)})
    except OSError as e:
     result["items"].append({"cache":suffix,"status":"failed","error":type(e).__name__})
   result["status"]="finished"
 after=shutil.disk_usage("/").free
 result["free_mb_after"]=round(after/(1024**2),1)
 result["reclaimed_mb"]=round((after-before)/(1024**2),1)
 print("SECURITY_REGENERABLE_CACHE_CLEANUP_V1 "+json.dumps(result,separators=(",",":"),sort_keys=True),flush=True)
if __name__=="__main__":run()
