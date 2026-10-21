#!/usr/bin/env python3
"""Task21: on-demand original BYTE integrity for one FUTURE-bound manual review.

This is an optional, privacy-preserving *single entry* diagnostic. It is not
installed, does not run on page polling, and does not mark old decisions
verified. The trusted server passes its existing independent SD/Drive original
attestor, never a browser-provided digest or media path. No writes anywhere.

A bound decision can be SHA-verifiable today without pretending a digest
computed today was present at the moment of historical review.
"""
import datetime as dt
import hmac
import importlib.util
from pathlib import Path
import re

BINDER=Path(__file__).with_name("s9_manual_media_digest_binding_v1.py")
HEX=re.compile(r"[0-9a-f]{64}\Z")
REVISIONS=re.compile(r"[A-Za-z0-9._:-]{1,180}\Z")
SOURCES={"sd","drive"}
STATES={"historically_unbound","source_unavailable","revision_mismatch",
        "digest_mismatch","bound_current_bytes","invalid_bound_metadata"}
class Refused(Exception):pass

def source_module():
 if BINDER.is_symlink() or not BINDER.is_file():
  raise Refused("trusted_original_binding_source_missing")
 spec=importlib.util.spec_from_file_location("task21_digest_v260",BINDER)
 m=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(m)
 return m

def status(key,entry,attestor,now=None):
 """Only the owner-facing status, without private names, SHA, or source IDs.

 Caller MUST select exactly one existing manual-store item; this helper must
 never be invoked across an entire page or all history on each poll. The
 attestor internally serializes work and enforces phone/hub thermal budgets.
 """
 if not isinstance(entry,dict):
  return "invalid_bound_metadata"
 binding=entry.get("media_binding")
 if binding is None:return "historically_unbound"
 if not isinstance(binding,dict) or binding.get("status")!="bound_at_decision":
  return "invalid_bound_metadata"
 if (not isinstance(key,str) or key.count(":")<1 or
     not isinstance(binding.get("source"),str) or
     binding["source"] not in SOURCES or
     not isinstance(binding.get("name"),str) or
     key!=binding["source"]+":"+binding["name"] or
     binding.get("schema_version")!="manual_original_digest_binding_v1" or
     binding.get("verified_at_decision") is not True or
     not isinstance(binding.get("sha256"),str) or
     not HEX.fullmatch(binding["sha256"]) or
     type(binding.get("size_bytes")) is not int or
     not 10000<=binding["size_bytes"]<=950000000 or
     not isinstance(binding.get("source_identity"),str) or
     not isinstance(binding.get("source_revision"),str) or
     not REVISIONS.fullmatch(binding["source_revision"]) or
     not callable(getattr(attestor,"current_revision",None)) or
     not callable(getattr(attestor,"verify_bytes",None))):
  return "invalid_bound_metadata" if (
     attestor is not None and
     callable(getattr(attestor,"current_revision",None)) and
     callable(getattr(attestor,"verify_bytes",None))) else "source_unavailable"
 try:
  before=attestor.current_revision(binding["source"],binding["name"])
  if not isinstance(before,dict) or set(before)!={"source_identity","source_revision"}:
   return "source_unavailable"
  if (before["source_identity"]!=binding["source_identity"] or
      before["source_revision"]!=binding["source_revision"]):
   return "revision_mismatch"
  proof=attestor.verify_bytes(binding["source"],binding["name"])
  # Reuse the SAME schema, source-verifier, freshness and trust requirements
  # as the canonical future-only V1076 decision binding. Never accept just
  # an arbitrary sha256 or sidecar hash offered by the browser.
  module=source_module()
  now=now or dt.datetime.now(dt.timezone.utc)
  checked=module._validated(proof,binding["source"],binding["name"],now)
  after=attestor.current_revision(binding["source"],binding["name"])
  if (not isinstance(after,dict) or set(after)!={"source_identity","source_revision"}):
   return "source_unavailable"
  if after!=before or (
      after["source_identity"]!=binding["source_identity"] or
      after["source_revision"]!=binding["source_revision"]):
   return "revision_mismatch"
  if (checked["source_identity"]!=binding["source_identity"] or
      checked["source_revision"]!=binding["source_revision"]):
   return "revision_mismatch"
  if (checked["size_bytes"]!=binding["size_bytes"] or
      not hmac.compare_digest(checked["sha256"],binding["sha256"])):
   return "digest_mismatch"
  return "bound_current_bytes"
 except Exception:
  # The original may disappear or its independently signed source worker
  # may fail mid-read. Never infer a healthy binding from an exception,
  # and never leak private worker exception strings to the browser.
  return "source_unavailable"

def public_result(key,entry,attestor,now=None):
 """Aggregate flags only. Historical assigned/return/group states are untouched."""
 s=status(key,entry,attestor,now)
 assert s in STATES
 return {"schema_version":"manual_original_byte_integrity_v260",
   "integrity_status":s,
   "historical_authority_preserved":True,
   "user_review_reopened":False,
   "decision_rewritten":False,
   "person_assignments_changed":False,
   "source_digests_returned":False,
   "media_removed":False,
   "automatic_polling_enabled":False}
