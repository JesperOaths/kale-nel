#!/usr/bin/env python3
"""Forward-only provenance for MANUAL recording decisions. Not an attestor.

A trusted producer must independently hash the ORIGINAL MP4 bytes immediately
before a new manual action, anchor its SD/Drive object revision and revalidate
that revision while the manual review store lock is held. The browser cannot
self-attest. Existing unbound decisions retain their historical authority.
This module never reads videos, changes reviews or creates source digests.
"""
import datetime as dt
import re
import hmac

HEX=re.compile(r"[0-9a-f]{64}\Z")
REVISION=re.compile(r"[A-Za-z0-9._:-]{1,180}\Z")
IDENTITY=re.compile(r"[A-Za-z0-9._:-]{1,240}\Z")
SOURCE={"sd","drive"}
MAX_AGE_SECONDS=120

class Refused(Exception):pass

def _iso(value):
 if not isinstance(value,str):raise Refused("missing_original_proof_timestamp")
 try:
  stamp=dt.datetime.fromisoformat(value.replace("Z","+00:00"))
 except (ValueError,OverflowError):raise Refused("invalid_original_proof_timestamp")
 if stamp.tzinfo is None:raise Refused("unanchored_original_proof_clock")
 return stamp.astimezone(dt.timezone.utc)

def _validated(proof,source,name,now):
 if not isinstance(proof,dict):
  raise Refused("independent_original_digest_proof_required")
 expected={"source","name","source_identity","source_revision",
           "sha256","size_bytes","verified_at_utc",
           "verified_original_bytes","method","verifier"}
 if set(proof)!=expected:raise Refused("untrusted_original_proof_fields")
 if proof["source"]!=source or proof["name"]!=name:
  raise Refused("original_source_qualified_identity_mismatch")
 if (source not in SOURCE or
     not isinstance(proof["source_identity"],str) or
     not IDENTITY.fullmatch(proof["source_identity"]) or
     not isinstance(proof["source_revision"],str) or
     not REVISION.fullmatch(proof["source_revision"])):
  raise Refused("source_revision_identity_untrusted")
 if (not isinstance(proof["sha256"],str) or
     not HEX.fullmatch(proof["sha256"]) or
     type(proof["size_bytes"]) is not int or
     not 10000<=proof["size_bytes"]<=950000000):
  raise Refused("original_sha256_or_size_invalid")
 if (proof["verified_original_bytes"] is not True or
     proof["method"]!="streamed_sha256_original_mp4" or
     proof["verifier"] not in ("phone-original-byte-auditor","drive-original-byte-auditor")):
  raise Refused("no_independent_original_byte_verification")
 if (source=="sd" and proof["verifier"]!="phone-original-byte-auditor") or (
     source=="drive" and proof["verifier"]!="drive-original-byte-auditor"):
  raise Refused("original_proof_source_wrong_worker")
 age=(now-_iso(proof["verified_at_utc"])).total_seconds()
 if not 0<=age<=MAX_AGE_SECONDS:
  raise Refused("original_proof_expired_or_future")
 return {"schema_version":"manual_original_digest_binding_v1",
  "status":"bound_at_decision","source":source,"name":name,
  "source_identity":proof["source_identity"],
  "source_revision":proof["source_revision"],
  "sha256":proof["sha256"],"size_bytes":proof["size_bytes"],
  "verified_at_utc":proof["verified_at_utc"],
  "method":"streamed_sha256_original_mp4",
  "verifier":proof["verifier"],"verified_at_decision":True}

def bind_new_decision(source,name,attestor,now=None):
 """Trusted server-side attestor interface: verify_bytes and current_revision.

 Verify original bytes, then cross-check immutable media UID/revision against
 a second fresh observation. No request JSON fields are accepted as proof.
 """
 if source not in SOURCE or not isinstance(name,str) or not name.endswith(".mp4"):
  raise Refused("unsafe_manual_source")
 if attestor is None or not callable(getattr(attestor,"verify_bytes",None)) or (
     not callable(getattr(attestor,"current_revision",None))):
  raise Refused("original_byte_attestor_not_installed")
 now=now or dt.datetime.now(dt.timezone.utc)
 if now.tzinfo is None:raise Refused("trusted_server_time_required")
 proof=attestor.verify_bytes(source,name)
 binding=_validated(proof,source,name,now.astimezone(dt.timezone.utc))
 current=attestor.current_revision(source,name)
 if not isinstance(current,dict) or set(current)!={"source_identity","source_revision"}:
  raise Refused("original_source_revision_unavailable")
 if (current["source_identity"]!=binding["source_identity"] or
     current["source_revision"]!=binding["source_revision"]):
  raise Refused("original_revision_changed_during_review")
 return binding

def require_unchanged(binding,attestor):
 """Call under the manual STORE lock again immediately before persistence."""
 if not isinstance(binding,dict) or binding.get("status")!="bound_at_decision":
  raise Refused("unbound_new_manual_action")
 if attestor is None or not callable(getattr(attestor,"current_revision",None)):
  raise Refused("original_source_revision_unavailable")
 current=attestor.current_revision(binding["source"],binding["name"])
 if (not isinstance(current,dict) or
     current.get("source_identity")!=binding["source_identity"] or
     current.get("source_revision")!=binding["source_revision"]):
  raise Refused("original_revision_changed_before_commit")

def display_status(entry,attestor=None):
 """Historical missing evidence is never rewritten, revoked or re-reviewed."""
 if not isinstance(entry,dict) or "media_binding" not in entry:
  return "historically_unbound"
 binding=entry["media_binding"]
 if not isinstance(binding,dict) or binding.get("status")!="bound_at_decision":
  return "historically_unbound"
 if attestor is None or not callable(getattr(attestor,"current_revision",None)):
  return "source_unavailable"
 try:current=attestor.current_revision(binding["source"],binding["name"])
 except (OSError,ValueError,Refused,RuntimeError):return "source_unavailable"
 if not isinstance(current,dict):return "source_unavailable"
 if current.get("source_identity") is None or current.get("source_revision") is None:
  return "source_unavailable"
 if (current["source_identity"]!=binding["source_identity"] or
     current["source_revision"]!=binding["source_revision"]):
  return "revision_mismatch"
 return "bound"

def public_diagnostics(items,attestor=None):
 if not isinstance(items,dict):raise Refused("manual_review_registry_unavailable")
 out={"bound":0,"historically_unbound":0,"source_unavailable":0,"revision_mismatch":0}
 for entry in items.values():
  out[display_status(entry,attestor)]+=1
 return {"schema_version":"manual_digest_status_v1",
  "counts":out,"historical_authority_preserved":True,
  "digest_backfill_performed":False,"reviews_reopened":False}
