#!/usr/bin/env python3
"""Guarded reclaim of ONLY dormant headless Chromium regenerable caches.

The already-tested V1 cleaner handles allowlists, symlink refusal, active
browser refusal and size bounds. This wrapper requires a healthy S9+ 4K
camera before/after and refuses any unexpected preview/cleanup contract.
Never touches recordings, identity reviews, auth state, browser profiles,
models, packages, Docker, systemd, or privileged host services.
"""
import contextlib
import importlib.util
from io import StringIO
import json
import os
from pathlib import Path
import shutil
import urllib.request

ROOT=Path(__file__).resolve().parent
HELPER=ROOT/"reclaim-regenerable-chromium-cache.py"
MARK="C720P_HEADLESS_CACHE_V169_VERIFIED "
MAX_ELIGIBLE_MIB=280.0
MAX_ITEM_MIB=260.0
MIN_FREE_MIB=420.0

def camera():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=9) as r:
  if r.status!=200:raise RuntimeError("capture_http_not_ready")
  raw=r.read(65537)
 if len(raw)>65536:raise RuntimeError("capture_status_too_long")
 doc=json.loads(raw)
 if (doc.get("ok") is not True or doc.get("mode")!="watching"
  or doc.get("native_4k_enabled") is not True
  or doc.get("continuous_4k_ready") is not True
  or doc.get("continuous_4k_dropped_output_frames")!=0
  or doc.get("continuous_4k_error")
  or type(doc.get("temperature_c")) not in (int,float)
  or not 0<doc["temperature_c"]<38.0):
  raise RuntimeError("capture_busy_or_hot")
 return doc

def load_helper():
 if HELPER.is_symlink() or not HELPER.is_file():
  raise RuntimeError("helper_missing")
 spec=importlib.util.spec_from_file_location("c720p_headless_cache_v169",HELPER)
 obj=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(obj)
 return obj

def run_helper(helper,apply=False):
 buffer=StringIO()
 with contextlib.redirect_stdout(buffer):
  helper.run(apply=apply)
 payload=buffer.getvalue()
 header="SECURITY_REGENERABLE_CACHE_CLEANUP_V1 "
 if payload.count(header)!=1 or len(payload)>25000:
  raise RuntimeError("untrusted_cache_cleanup_output")
 try:data=json.loads(payload.split(header,1)[1])
 except ValueError:raise RuntimeError("unparseable_cache_cleanup_output") from None
 if not isinstance(data,dict):raise RuntimeError("untrusted_cache_cleanup_summary")
 return data

def validate(data,apply=False):
 if (data.get("video_deleted") is not False
  or data.get("backup_deleted") is not False
  or data.get("headless_profile_deleted") is not False
  or data.get("detector_build_deleted") is not False
  or data.get("apply_requested") is not apply
  or not isinstance(data.get("items"),list)
  or len(data["items"])>100):
  raise RuntimeError("cache_safety_contract_missing")
 allowed={"removed","failed","skipped_profile_now_in_use","changed_target_skipped"} if apply else {
  "eligible_not_deleted","too_large_skipped"}
 items=data["items"]
 if any(not isinstance(e,dict) or e.get("status") not in allowed for e in items):
  raise RuntimeError("cache_item_outside_allowlist")
 eligible=[e for e in items if e.get("status") in ("eligible_not_deleted","removed")]
 total=0.0
 for row in eligible:
  val=row.get("size_mb")
  if type(val) not in (int,float) or not 0<=val<=MAX_ITEM_MIB:
   raise RuntimeError("cache_item_size_untrusted")
  total+=val
 if total>MAX_ELIGIBLE_MIB+0.05:
  raise RuntimeError("cache_total_size_untrusted")
 if apply and data.get("status") not in ("finished","skipped_profile_in_use"):
  raise RuntimeError("unexpected_cache_cleanup_status")
 if not apply and data.get("status") not in (
  "dry_run_only","skipped_profile_in_use",
  "not_applicable_or_profile_symlink","unexpected_cache_volume_skipped"):
  raise RuntimeError("unexpected_cache_preview_status")
 return len(eligible),round(total,1)

def execute():
 before=camera()
 if shutil.disk_usage("/").free/(1024**2)<MIN_FREE_MIB:
  raise RuntimeError("root_too_full_for_guarded_cache_scan")
 if os.getloadavg()[0]>4.0:
  raise RuntimeError("hub_too_busy_for_maintenance")
 helper=load_helper()
 preview=run_helper(helper,False)
 eligible_count,eligible_mib=validate(preview,False)
 result={"read_only_preflight":True,"safe_cache_candidates":eligible_count,
         "eligible_cache_mib":eligible_mib,"media_deleted":False,
         "review_changes":False,"camera_apk_changes":False,
         "originals_retained":True,"cache_reclaim_performed":False}
 if preview["status"]=="dry_run_only" and eligible_count:
  # The existing helper again tests active browser, paths and total size
  # immediately before each permitted cache-only removal.
  applied=run_helper(helper,True)
  removed_count,removed_mib=validate(applied,True)
  result.update(cache_reclaim_performed=True,
      removed_cache_items=sum(e["status"]=="removed" for e in applied["items"]),
      failed_cache_items=sum(e["status"]=="failed" for e in applied["items"]),
      reclaimed_mib=max(0.0,float(applied.get("reclaimed_mb") or 0.0)))
 else:
  result.update(cache_deferred_reason=preview["status"])
 after=camera()
 result.update(camera_ready_after=True,camera_dropped_output_frames_after=0,
               camera_temperature_after_c=after["temperature_c"])
 print(MARK+json.dumps(result,sort_keys=True),flush=True)

if __name__=="__main__":
 try:execute()
 except Exception:
  print("C720P_HEADLESS_CACHE_V169_NOT_VERIFIED "+json.dumps({
   "failure":True,"originals_must_be_retained":True},sort_keys=True),flush=True)
  raise SystemExit(1)
