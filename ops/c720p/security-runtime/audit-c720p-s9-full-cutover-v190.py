#!/usr/bin/env python3
"""Read-only cross-check of C720P MP4, JPEG and Save/Delete migration readiness.

Never approves local deletion. Uses current verified phone-side manifest metadata
and bounded SHA reads of local JPEGs ONLY (not 4K MP4s). This cannot prove the
phone is reachable now, durable remote Save/Delete, or safe offline fallback.
Camera health and the existing protected originals take priority.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import stat
import urllib.request

HERE=Path(__file__).resolve().parent
RETIRE=HERE/"audit-c720p-s9-retirement-v156.py"
SHADOW=HERE/"s9_migrated_save_delete_contract_v181.py"
ROOT=Path("/opt/homeassistant/config/www/frontyard-security-new")
EVENTS=ROOT/"events.json"
SNAPS=ROOT/"snaps"
JPG_REPORT=Path("/home/jespern/c720p-home-hub/state/c720p-s9-snapshots-v162.json")
MP4_REPORT=Path("/home/jespern/c720p-home-hub/state/c720p-s9-imported-v2.json")
JPG_ROOT="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/C720PMigratedSnapshots"
JPEG=re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,139}[.]jpg\Z")
MP4=re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,139}[.]mp4\Z")
SHA=re.compile(r"[a-f0-9]{64}\Z")
SCHEMA="c720p_s9_snapshots_v162"
MARK="C720P_S9_DUAL_MEDIA_CUTOVER_V190 "
MAX_JPEG=5_000_000
MAX_DOC=2_000_000
MAX_EVENTS=10_000

class Refusal(Exception):
 pass
def need(ok,why):
 if not ok:raise Refusal(why)

def import_module(path,alias):
 need(path.is_file() and not path.is_symlink(),"required_source_missing")
 spec=importlib.util.spec_from_file_location(alias,str(path))
 module=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(module)
 return module

def private_json(path,max_bytes=MAX_DOC):
 need(path.is_file() and not path.is_symlink(),"private_proof_absent")
 st=path.stat()
 need(0<st.st_size<=max_bytes
      and stat.S_IMODE(st.st_mode)&0o077==0,
      "private_proof_untrusted")
 try:return json.loads(path.read_bytes())
 except (ValueError,UnicodeDecodeError):
  raise Refusal("private_proof_invalid_json") from None

def events_catalog(path=EVENTS):
 need(path.is_file() and not path.is_symlink() and 0<path.stat().st_size<=MAX_DOC,
      "local_event_catalog_untrusted")
 try:d=json.loads(path.read_bytes())
 except (ValueError,UnicodeDecodeError):
  raise Refusal("local_event_catalog_invalid") from None
 if isinstance(d,dict):
  d=next((d[x] for x in ("events","items","clips")
       if isinstance(d.get(x),list)),None)
 need(isinstance(d,list) and len(d)<=MAX_EVENTS,"local_event_catalog_unknown_schema")
 return d

def snapshot_coverage(mp4,*,report=JPG_REPORT,events=EVENTS,folder=SNAPS):
 """Manifest SHA/size and local snapshot parity; no phone or MP4 data read."""
 doc=private_json(report)
 need(isinstance(doc,dict) and doc.get("schema_version")==SCHEMA
      and isinstance(doc.get("records"),dict),"snapshot_proof_schema_invalid")
 records=doc["records"]
 need(1<=len(records)<=5000,"snapshot_proof_count_untrusted")
 need(not folder.is_symlink() and folder.is_dir(),"local_snapshot_folder_untrusted")
 catalog=events_catalog(events)
 used_mp4=set();by_clip={}
 for item in catalog:
  if not isinstance(item,dict):continue
  clip=item.get("clip");snap=item.get("snapshot")
  if not isinstance(clip,str) or not isinstance(snap,str):continue
  parts=Path(clip).parts;sparts=Path(snap).parts
  if not (len(parts)==2 and parts[0]=="clips"
     and MP4.fullmatch(parts[1]) and ".." not in clip
     and parts[1] in mp4):continue
  need(len(sparts)==2 and sparts[0]=="snaps"
       and JPEG.fullmatch(sparts[1]) and ".." not in snap,
       "legacy_event_snapshot_path_untrusted")
  need(parts[1] not in used_mp4,"duplicate_legacy_clip_snapshot_reference")
  used_mp4.add(parts[1]);by_clip[parts[1]]=sparts[1]
 need(len(by_clip)==len(mp4) and len(records)==len(mp4),
      "snapshot_to_video_coverage_incomplete")
 used_jpg=set()
 total=0
 for name,row in records.items():
  need(isinstance(name,str) and JPEG.fullmatch(name) and ".." not in name
       and isinstance(row,dict),"snapshot_proof_entry_untrusted")
  clip=row.get("clip")
  need(isinstance(clip,str) and MP4.fullmatch(clip) and ".." not in clip
       and clip in mp4 and by_clip.get(clip)==name
       and name not in used_jpg,"snapshot_clip_reference_drift")
  used_jpg.add(name)
  need(row.get("sd_path")==JPG_ROOT+"/"+name
       and row.get("clip_sha256")==mp4[clip]["sha256"]
       and isinstance(row.get("sha256"),str) and SHA.fullmatch(row["sha256"])
       and type(row.get("bytes")) is int
       and 1000<=row["bytes"]<=MAX_JPEG,"snapshot_proof_integrity_metadata_invalid")
  jpg=folder/name
  need(jpg.is_file() and not jpg.is_symlink()
       and jpg.parent.resolve()==folder.resolve(),"local_snapshot_not_regular")
  st=jpg.stat()
  need(st.st_size==row["bytes"],"local_snapshot_size_drift")
  # Bounded local JPEG only; never open or stream a full-resolution MP4.
  raw=jpg.read_bytes()
  need(len(raw)==st.st_size and raw.startswith(b"\xff\xd8\xff")
       and raw.endswith(b"\xff\xd9")
       and hashlib.sha256(raw).hexdigest()==row["sha256"],
       "local_snapshot_checksum_drift")
  total+=len(raw)
 return {"manifest_snapshots":len(records),"manifest_snapshot_bytes":total,
         "local_snapshot_sha_matches":len(records),
         "video_snapshot_bijection_verified":True,
         "live_phone_rehash_performed":False}

def camera_guard():
 try:
  with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=9) as r:
   need(r.status==200,"camera_status_unavailable")
   raw=r.read(65537)
  need(len(raw)<=65536,"camera_status_too_large")
  data=json.loads(raw)
 except (OSError,ValueError,TypeError):
  raise Refusal("camera_status_unavailable") from None
 need(data.get("ok") is True and data.get("mode")=="watching"
      and data.get("native_4k_enabled") is True
      and data.get("continuous_4k_ready") is True
      and data.get("continuous_4k_dropped_output_frames")==0
      and not data.get("continuous_4k_error")
      and type(data.get("temperature_c")) in (int,float)
      and 0<data["temperature_c"]<=37.5
      and type(data.get("continuous_4k_buffered_ms")) is int
      and data["continuous_4k_buffered_ms"]>=6500,
      "camera_capture_health_admission_failed")
 return {"capture_dropped_frames":0,"camera_temp_c":data["temperature_c"]}

def audit():
 before=camera_guard()
 mp4audit=import_module(RETIRE,"s9_mp4_retirement_v156")
 shadow=import_module(SHADOW,"s9_shadow_save_delete_v181")
 mp4=mp4audit.manifest_rows()
 local=mp4audit.local_inventory()
 need(len(mp4)==len(local),"video_source_inventory_mismatch")
 need(all(local.get(name)==row["bytes"] and row["indexed"] for name,row in mp4.items()),
      "video_size_or_index_drift")
 image=snapshot_coverage(mp4)
 source=mp4audit.SOURCE
 mp4audit.safe_file(source,size_limit=500000)
 actions=mp4audit.legacy_actions(source.read_text())
 source_sha=hashlib.sha256(source.read_bytes()).hexdigest()
 indexed=mp4audit.INDEX
 js=mp4audit.SCRIPT
 mp4audit.safe_file(indexed,size_limit=500000)
 mp4audit.safe_file(js,size_limit=100000)
 bridge=(actions["source_generator_bridge"]
    and mp4audit.WEB_INDEX_BRIDGE in indexed.read_text()
    and mp4audit.JS_MARKER in js.read_text())
 guards=all(mp4audit.unit_active(n) for n in (
      "c720p-legacy-s9-index-bridge-guard-v1.path",
      "c720p-legacy-s9-index-bridge-guard-v1.timer"))
 legacy=mp4audit.assess(mp4,local,actions,generator_sha=source_sha,
                        bridges=bridge,guard=guards,camera=True)
 events=events_catalog()
 shadow_summary=shadow.safe_aggregate(events,mp4)
 after=camera_guard()
 # Each independent proof is required for eventual cutover. No proof in this
 # job establishes phone-outage Save/Delete or permits any local file deletion.
 reasons=set(legacy["blockers"])
 reasons.update(("remote_save_delete_receipt_not_implemented",
                 "phone_offline_fallback_not_verified",
                 "fresh_s9_phone_rehash_not_this_audit"))
 return {"state":"blocked","eligible_for_local_removal":False,
    "retain_all_local_originals":True,"read_only":True,
    "camera_apk_modified":False,"recordings_modified":False,
    "snapshots_modified":False,"reviews_modified":False,
    "files_deleted":0,"camera_ready_before_after":True,
    "camera_temperature_before_c":before["camera_temp_c"],
    "camera_temperature_after_c":after["camera_temp_c"],
    "capture_dropped_frames_after":after["capture_dropped_frames"],
    "mp4_count":len(mp4),"mp4_bytes":sum(x["bytes"] for x in mp4.values()),
    "local_mp4_size_matches":len(mp4),
    "snapshots":image,"saved_state":shadow_summary,
    "index_bridge_present":bridge,"generation_guard_present":guards,
    "legacy_save_uses_local_index":actions["save_writes_local_index"],
    "legacy_delete_unlinks_local_files":actions["delete_unlinks_local_files"],
    "blockers":sorted(reasons)}

def main():
 try:report=audit()
 except Exception as error:
  reason=str(error) if isinstance(error,Refusal) else "failed_closed_no_private_details"
  known={"private_proof_absent","private_proof_untrusted","private_proof_invalid_json",
         "local_event_catalog_untrusted","local_event_catalog_invalid",
         "local_event_catalog_unknown_schema","snapshot_proof_schema_invalid",
         "snapshot_proof_count_untrusted","local_snapshot_folder_untrusted",
         "legacy_event_snapshot_path_untrusted",
         "duplicate_legacy_clip_snapshot_reference",
         "snapshot_to_video_coverage_incomplete","snapshot_proof_entry_untrusted",
         "snapshot_clip_reference_drift","snapshot_proof_integrity_metadata_invalid",
         "local_snapshot_not_regular","local_snapshot_size_drift",
         "local_snapshot_checksum_drift","camera_status_unavailable",
         "camera_status_too_large","camera_capture_health_admission_failed",
         "required_source_missing","video_source_inventory_mismatch",
         "video_size_or_index_drift"}
  report={"state":"unverified","reason":reason if reason in known
          else "failed_closed_no_private_details",
          "eligible_for_local_removal":False,
          "retain_all_local_originals":True,"read_only":True,
          "files_deleted":0,"recordings_modified":False,
          "reviews_modified":False}
 print(MARK+json.dumps(report,sort_keys=True,separators=(",",":")),flush=True)
 if report["state"]!="blocked":raise SystemExit(1)

if __name__=="__main__":main()
