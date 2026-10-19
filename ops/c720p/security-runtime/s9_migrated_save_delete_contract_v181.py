#!/usr/bin/env python3
"""Pure C720P-to-S9 migrated Save/Delete transition contract, never a write endpoint.

The authenticated S9 browser Range playback does not establish remotely
durable Save/Delete. This module only models a future remote-first operation.
Nothing here unlinks clips, writes state, connects to S9, or approves removal.
"""
from dataclasses import dataclass
import hashlib
import hmac
import json
import re

NAME=re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,139}[.]mp4\Z")
SHA=re.compile(r"[0-9a-f]{64}\Z")
ROOT="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/C720PMigrated"

@dataclass(frozen=True)
class Decision:
    status: str
    reason: str
    proposed_event: dict|None=None
    may_remove_local_original: bool=False
    remote_mutation_executed: bool=False

def validated_record(name, records):
    if not isinstance(name,str) or not NAME.fullmatch(name) or ".." in name:
        raise ValueError("unsafe_recording_name")
    if not isinstance(records,dict) or len(records)>5000:
        raise ValueError("unsafe_verified_manifest")
    item=records.get(name)
    if not isinstance(item,dict):
        raise ValueError("recording_not_in_verified_s9_manifest")
    if (item.get("sd_path")!=ROOT+"/"+name
        or not isinstance(item.get("sha256"),str) or not SHA.fullmatch(item["sha256"])
        or type(item.get("bytes")) is not int
        or not 10000<=item["bytes"]<=900*1024**2
        or item.get("indexed") is not True):
        raise ValueError("recording_source_integrity_unverified")
    return item

def canonical_receipt(name,item,action,nonce,*,status,source,durable,
                      ledger_sequence,ledger_head_sha256):
    """V2: the signed data includes EVERY field relevant to a claim of commit.

    This HMAC verifies a *claim*, not the existence of a durable phone ledger.
    A future authenticated S9 service must fsync, prevent nonce replay and
    independently expose ledger consistency before enabling real actions.
    """
    if action not in ("save","delete"):raise ValueError("unknown_action")
    if not isinstance(name,str) or not NAME.fullmatch(name) or ".." in name:
        raise ValueError("unsafe_recording_name")
    if not isinstance(item,dict) or not isinstance(item.get("sha256"),str) or not SHA.fullmatch(item["sha256"]) or type(item.get("bytes")) is not int or not 10000<=item["bytes"]<=900*1024**2:
        raise ValueError("untrusted_source_proof")
    if not isinstance(nonce,str) or not re.fullmatch(r"[0-9a-f]{32}",nonce):
        raise ValueError("invalid_server_nonce")
    if status not in ("pending","s9_committed") or source!="s9_microsd" or type(durable) is not bool:
        raise ValueError("invalid_commit_claim")
    if type(ledger_sequence) is not int or not 1<=ledger_sequence<=2**63-1:
        raise ValueError("invalid_ledger_sequence")
    if not isinstance(ledger_head_sha256,str) or not SHA.fullmatch(ledger_head_sha256):
        raise ValueError("invalid_ledger_head")
    return json.dumps({"schema":"s9_c720p_migrated_action_v2",
      "action":action,"name":name,"sha256":item["sha256"],
      "bytes":item["bytes"],"nonce":nonce,
      "status":status,"source":source,"durable":durable,
      "ledger_sequence":ledger_sequence,
      "ledger_head_sha256":ledger_head_sha256},
      sort_keys=True,separators=(",",":")).encode()

def receipt_authorized(receipt,name,item,action,key):
    """Synthetic verification ONLY. Actual phone commit/authorization and
    anti-replay cannot be established from an HMAC alone; no write endpoint
    exists here and preview() never authorizes local original retirement.
    """
    if (not isinstance(receipt,dict) or type(key) is not bytes or len(key)<32
      or receipt.get("schema")!="s9_c720p_migrated_action_v2"
      or receipt.get("status")!="s9_committed"
      or receipt.get("source")!="s9_microsd"
      or receipt.get("action")!=action
      or receipt.get("durable") is not True
      or not isinstance(receipt.get("hmac_sha256"),str)
      or not SHA.fullmatch(receipt["hmac_sha256"])):
        return False
    try:body=canonical_receipt(name,item,action,receipt.get("nonce"),
      status=receipt.get("status"),source=receipt.get("source"),
      durable=receipt.get("durable"),
      ledger_sequence=receipt.get("ledger_sequence"),
      ledger_head_sha256=receipt.get("ledger_head_sha256"))
    except (ValueError,KeyError,TypeError):return False
    return hmac.compare_digest(hmac.new(key,body,hashlib.sha256).hexdigest(),
                               receipt["hmac_sha256"])

def preview(name,event,records,action,*,receipt=None,secret=None):
    if action not in ("save","delete"):raise ValueError("unknown_action")
    item=validated_record(name,records)
    if (not isinstance(event,dict)
      or event.get("clip") not in ("clips/"+name,name)
      or type(event.get("saved",False)) is not bool):
        raise ValueError("legacy_event_not_source_qualified")
    if not receipt_authorized(receipt,name,item,action,secret):
        return Decision("blocked","remote_durable_action_receipt_missing")
    clone=dict(event)
    if action=="save":
        clone["saved"]=True
        return Decision("shadow_only",
                        "S9_save_receipt_verified_local_retirement_still_blocked",clone)
    # A future *valid* remote delete receipt still cannot justify unlinking
    # the local fallback: generator, Save/Delete and review parity are distinct.
    clone["remote_deleted"]=True
    return Decision("shadow_only",
                    "S9_delete_receipt_verified_local_retirement_still_blocked",clone)

def safe_aggregate(events,records):
    if not isinstance(events,list) or len(events)>10000:
        raise ValueError("unsafe_local_event_catalog")
    verified=saved=invalid=0
    for ev in events:
        if not isinstance(ev,dict):invalid+=1;continue
        path=ev.get("clip")
        if not isinstance(path,str):continue
        name=path[6:] if path.startswith("clips/") else path
        try:validated_record(name,records)
        except ValueError:invalid+=1;continue
        if type(ev.get("saved",False)) is not bool:invalid+=1;continue
        verified+=1
        saved+=ev.get("saved") is True
    return {"verified_remote_entries_in_legacy_catalog":verified,
      "saved_local_flag_count":saved,"unmatched_or_unsafe_event_count":invalid,
      "S9_remote_save_receipts_verified":0,"S9_remote_delete_receipts_verified":0,
      "legacy_local_video_removal_permitted":False,
      "originals_modified":False,"manual_reviews_modified":False}
