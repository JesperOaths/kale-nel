#!/usr/bin/env python3
"""Read-only authoritative manual review digest coverage on C720P.

Original linked decisions retain authority; no original digest is inferred
from SD sidecar sha256 or Drive archive md5. Never print source filenames,
people folders, file IDs, checksum values, timestamps, URLs or credentials.
"""
import argparse
import hashlib
import json
import stat
from pathlib import Path

STATE=Path("/home/jespern/c720p-home-hub/state")
MANUAL=STATE/"s9-manual-recording-links-v1.json"
AUDIT=STATE/"s9-manual-recording-links-v1.audit.jsonl"
SD=STATE/"s9-standalone-archive-catalog-v1.json"
DRIVE=STATE/"drive-security-archive.json"
MARK="SECURITY_MANUAL_DIGEST_INVENTORY_TASK21 "

def read(path,max_bytes):
 if path.is_symlink() or not path.is_file():
  raise RuntimeError("private_source_missing")
 before=path.stat()
 if (not stat.S_ISREG(before.st_mode) or before.st_size>max_bytes
     or before.st_size<3 or before.st_mode&0o077):
  raise RuntimeError("private_source_untrusted")
 raw=path.read_bytes()
 after=path.stat()
 if (len(raw)!=before.st_size or before.st_mtime_ns!=after.st_mtime_ns or
     before.st_ino!=after.st_ino):
  raise RuntimeError("private_source_changed_during_read")
 return raw

def count(manual,sd,drive):
 if (manual.get("version")!=1 or type(manual.get("revision")) is not int
     or not isinstance(manual.get("items"),dict)):
  raise RuntimeError("manual_review_registry_invalid")
 if not isinstance(sd.get("records"),dict) or not isinstance(drive.get("items"),list):
  raise RuntimeError("source_catalog_unavailable")
 sd_items=sd["records"];drive_items={}
 for row in drive["items"]:
  if not isinstance(row,dict):continue
  name=row.get("remote_name")
  if isinstance(name,str):
   drive_items.setdefault(name,[]).append(row)
 counts={"sd":0,"drive":0,"historically_unbound":0,
         "source_claimed_sha_only":0,"drive_indexed_md5_only":0,
         "bound_at_decision":0,"bound_without_current_record":0,
         "revision_mismatch_with_catalog":0,"source_unavailable":0,
         "completed_reviews_preserved":0,"group_assignments_preserved":0}
 for key,entry in manual["items"].items():
  if not isinstance(key,str) or not isinstance(entry,dict):
   raise RuntimeError("manual_entry_malformed")
  source,sep,name=key.partition(":")
  if sep!=":" or source not in ("sd","drive") or not name:
   raise RuntimeError("manual_source_key_malformed")
  counts[source]+=1
  if entry.get("review_status") in ("assigned","skipped","rejected"):
   counts["completed_reviews_preserved"]+=1
  if isinstance(entry.get("folders"),list) and len(entry["folders"])>1:
   counts["group_assignments_preserved"]+=1
  rec=sd_items.get(name) if source=="sd" else None
  matches=[x for x in drive_items.get(name,[]) if x.get("state")=="verified"]
  if source=="sd" and isinstance(rec,dict):
   manifest=rec.get("manifest")
   if isinstance(manifest,dict) and isinstance(manifest.get("sha256"),str):
    counts["source_claimed_sha_only"]+=1
  elif source=="drive" and matches:
   if any(isinstance(x.get("md5"),str) for x in matches):
    counts["drive_indexed_md5_only"]+=1
  else:
   counts["source_unavailable"]+=1
  binding=entry.get("media_binding")
  if not isinstance(binding,dict) or binding.get("status")!="bound_at_decision":
   counts["historically_unbound"]+=1
   continue
  counts["bound_at_decision"]+=1
  if source=="sd" and not isinstance(rec,dict) or source=="drive" and not matches:
   counts["bound_without_current_record"]+=1
  # A Drive MD5 alone cannot prove immutable Drive object *revision*.
  if source=="sd" and isinstance(rec,dict):
   manifest=rec.get("manifest")
   if isinstance(manifest,dict) and manifest.get("sha256")!=binding.get("sha256"):
    counts["revision_mismatch_with_catalog"]+=1
 return {"schema_version":"manual_digest_inventory_task21_v1",
   "manual_revision":manual["revision"],
   "manual_decision_count":len(manual["items"]),
   "counts":counts,
   "historic_unbound_is_still_authoritative":True,
   "historical_digest_backfilled":False,
   "original_bytes_hashed_in_this_audit":0,
   "drive_md5_not_sha256_review_proof":True,
   "sd_sidecar_sha_not_byte_reverified":True,
   "reviews_or_media_changed":False}

def inventory():
 original=read(MANUAL,600000)
 journal=read(AUDIT,2500000) if AUDIT.exists() else b""
 sd_raw=read(SD,5000000);drive_raw=read(DRIVE,6000000)
 result=count(json.loads(original),json.loads(sd_raw),json.loads(drive_raw))
 result["audit_log_line_count"]=len(journal.splitlines())
 if read(MANUAL,600000)!=original or (
     AUDIT.exists() and read(AUDIT,2500000)!=journal):
  raise RuntimeError("concurrent_manual_writer_changed_state")
 return result

if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--run",action="store_true")
 opts=p.parse_args()
 if not opts.run:
  print("SECURITY_MANUAL_DIGEST_INVENTORY_PREVIEW "+json.dumps({
   "read_only":True,"historical_writes":False},sort_keys=True))
 else:
  try:
   print(MARK+json.dumps(inventory(),sort_keys=True),flush=True)
  except Exception as error:
   # Never log private paths, filenames, person IDs or raw exception strings.
   known={"private_source_missing","private_source_untrusted",
    "private_source_changed_during_read","manual_review_registry_invalid",
    "source_catalog_unavailable","manual_entry_malformed",
    "manual_source_key_malformed","concurrent_manual_writer_changed_state"}
   reason=str(error)
   if reason not in known:reason="unclassified_no_private_detail"
   print("SECURITY_MANUAL_DIGEST_INVENTORY_NOT_VERIFIED "+json.dumps({
    "reason_code":reason,"historical_writes":False,
    "original_bytes_read":0},sort_keys=True),flush=True)
   raise SystemExit(1)
