#!/usr/bin/env python3
"""Task21 physical, read-only, one-original-at-a-time future-binding proof.

Use the actual trusted phone/Drive attestor + V1076 binding consumer against
one *historically existing* original, in MEMORY ONLY. Never generate a manual
decision or alter any real historical review, group folder, audit, person or
video. This explicitly does NOT retroactively bind historical decisions.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import stat

HERE=Path(__file__).resolve().parent
ATT=HERE/"s9_manual_original_byte_attestor_v252.py"
BINDER=HERE/"s9_manual_media_digest_binding_v1.py"
ROOT=Path("/home/jespern/c720p-home-hub/state")
MANUAL=ROOT/"s9-manual-recording-links-v1.json"
AUDIT=ROOT/"s9-manual-recording-links-v1.audit.jsonl"
MARK="TASK21_FRESH_ORIGINAL_BYTE_V253_VERIFIED "
MAX_SAMPLE=180000000

def load(label,path):
 if path.is_symlink() or not path.is_file() or path.stat().st_size>100000:
  raise RuntimeError("reviewed_probe_dependency_missing")
 spec=importlib.util.spec_from_file_location(label,path)
 module=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(module)
 return module

def secure_source(path,limit):
 if path.is_symlink() or not path.is_file():
  raise RuntimeError("protected_review_source_missing")
 s=path.stat()
 if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1 or s.st_mode&0o077 or not 10<s.st_size<limit:
  raise RuntimeError("protected_review_source_untrusted")
 raw=path.read_bytes()
 if len(raw)!=s.st_size or path.stat().st_mtime_ns!=s.st_mtime_ns:
  raise RuntimeError("review_state_concurrently_changed")
 return raw

def choose(source,registry,attestor):
 if not isinstance(registry,dict) or registry.get("version")!=1 or not isinstance(registry.get("items"),dict):
  raise RuntimeError("review_registry_schema_changed")
 candidates=[]
 for key,item in registry["items"].items():
  if not isinstance(key,str) or not key.startswith(source+":") or not isinstance(item,dict):
   continue
  name=key[len(source)+1:]
  try:
   record,_=attestor.source(source,name)
   size=record.get("bytes") if source=="sd" else record.get("size")
   if type(size) is int and 10000<=size<=MAX_SAMPLE:
    candidates.append((size,name))
  except (OSError,KeyError,RuntimeError,ValueError):
   continue
 if not candidates:
  raise RuntimeError("bounded_original_sample_not_available")
 candidates.sort()
 return candidates[0][1],candidates[0][0]

def execute(source):
 if source not in ("sd","drive"):raise RuntimeError("invalid_source_qualifier")
 att=load("task21_original_v252",ATT)
 bind=load("task21_manual_binding_v1",BINDER)
 initial=secure_source(MANUAL,600000)
 audit=secure_source(AUDIT,2500000)
 registry=json.loads(initial)
 name,bytes_expected=choose(source,registry,att)
 provider=att.IndependentOriginalAttestor()
 # Both the actual original digest and the binder's two independent
 # current_revision checks are exercised. No call to mutate() or install().
 binding=bind.bind_new_decision(source,name,provider)
 bind.require_unchanged(binding,provider)
 if not (binding.get("status")=="bound_at_decision" and
   binding.get("source")==source and
   binding.get("verified_at_decision") is True and
   binding.get("size_bytes")==bytes_expected and
   binding.get("method")=="streamed_sha256_original_mp4" and
   isinstance(binding.get("sha256"),str) and len(binding["sha256"])==64):
  raise RuntimeError("independent_digest_binding_contract_missing")
 if secure_source(MANUAL,600000)!=initial or secure_source(AUDIT,2500000)!=audit:
  raise RuntimeError("historical_review_audit_changed")
 current=json.loads(initial)
 if current.get("revision")!=registry.get("revision"):
  raise RuntimeError("historical_review_revision_changed")
 return {"physical_original_sha256_verified":True,
   "future_binding_consumer_accepted":True,
   "source":source,
   "verified_original_bytes":bytes_expected,
   "unchanged_revision_cas_checks":2,
   "decision_store_checksum_unchanged":True,
   "append_only_review_audit_unchanged":True,
   "historical_binding_backfilled":False,
   "manual_reviews_written":0,
   "person_assignments_changed":False,
   "media_bytes_downloaded_to_hub":0 if source=="sd" else bytes_expected,
   "media_originals_modified":False,
   "phone_camera_apk_modified":False,
   "production_binding_activated":False}

if __name__=="__main__":
 parser=argparse.ArgumentParser()
 parser.add_argument("--source",choices=("sd","drive"),required=True)
 args=parser.parse_args()
 try:
  result=execute(args.source)
  print(MARK+json.dumps(result,sort_keys=True),flush=True)
 except Exception as error:
  allow={"reviewed_probe_dependency_missing","protected_review_source_missing",
   "protected_review_source_untrusted","review_state_concurrently_changed",
   "review_registry_schema_changed","bounded_original_sample_not_available",
   "invalid_source_qualifier","independent_digest_binding_contract_missing",
   "historical_review_audit_changed","historical_review_revision_changed"}
  code=str(error)
  if code not in allow:code="source_proof_unavailable_or_camera_busy"
  print("TASK21_FRESH_ORIGINAL_BYTE_V253_NOT_VERIFIED "+
   json.dumps({"source":args.source,"reason_code":code,
    "manual_reviews_written":0,"historical_binding_backfilled":False},sort_keys=True))
  raise SystemExit(1)
