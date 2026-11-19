#!/usr/bin/env python3
"""R741 metadata-only sealed gallery plan for existing S9 Re-ID vectors.

This runs on the C720P controller and reads ONLY crop/source provenance metadata,
never pixel data and never similarity vectors. Actual retrieval runs on S9.
Frozen R407 owner-approved reference labels are the ONLY allowed identity seeds.
The independent holdout owner truth is deliberately not opened here.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT=Path("/home/jespern/c720p-home-hub")
APPROVED=ROOT/"staging/folder-recognition-execution-20261117/r407-Gemini-P0-real-source-disjoint-ablation-shadow/R407_OWNER_APPROVED_SOURCE_FEATURE_CACHE_RESTRICTED_600.json"
PIN_APPROVED="f892a3d7f867ae3ab78c0fc206c8f6feb180d3f7924e43ae613b495c7b32e264"
PIN_OWNER_REFERENCE_DIGEST="33f3734094cd731fbc77da4e902b004564558ff6f04073e954740ba658e19b97"
PHONE="192.168.178.250:5555"
REMOTE="/data/local/tmp/s9-osnet-qualcomm-reid-shadow"
MODEL="5249d33bb1cd53e53c9096db9d6acf555b698a7f4561a2b3eb81df4fcbfaac5c"

def require(v,reason):
    if not v:raise ValueError(reason)

def sha(path):
    h=hashlib.sha256()
    with open(path,"rb") as f:
        for part in iter(lambda:f.read(65536),b""):h.update(part)
    return h.hexdigest()

def phone_read(path):
    require(path.startswith(REMOTE+"/") and path.endswith(".json"),"Invalid read path")
    p=subprocess.run(["adb","-s",PHONE,"shell","cat",path],
                     capture_output=True,text=True,timeout=15,check=True)
    return json.loads(p.stdout)

def phone_list():
    p=subprocess.run(["adb","-s",PHONE,"shell","ls",REMOTE+"/batch-*.json"],
                     capture_output=True,text=True,timeout=15,check=True)
    paths=sorted(x.strip() for x in p.stdout.splitlines() if x.strip().endswith(".json"))
    require(len(paths)==18,"Source manifest count drift")
    return paths

def current_owner_digest():
    sys.path.insert(0,str(ROOT/"bin"))
    from recognition_v2_sources import read_inputs,labels,reference_digest
    refs,_=labels(read_inputs(ROOT))
    return reference_digest(refs)

def create(output):
    require(sha(APPROVED)==PIN_APPROVED,"Frozen verified-reference cache changed")
    require(current_owner_digest()==PIN_OWNER_REFERENCE_DIGEST,
            "Owner-approved gallery revision changed; refuse stale reference labels")
    approved=json.loads(APPROVED.read_text())["baseline"]
    require(len(approved)==40,"Unexpected frozen approved reference count")
    by_crop={}
    for r in approved:
        key=r["crop_sha"]
        require(key not in by_crop,"Duplicate approved crop reference")
        require(r.get("folder") and r.get("sha") and r.get("track") is not None,
                "Approved track identity provenance incomplete")
        by_crop[key]=r
    reference=[];query=[];seen={}
    for path in phone_list():
        o=phone_read(path)
        require(o.get("schema")=="S9_REAL_OSNET_SOURCE_SHA_ATTESTED_BATCH_V1",
                "Unknown S9 source batch schema")
        require(o.get("unknown_person_training_labels_present") is False,
                "Unknown person training labels present")
        for entry in o["crops"]:
            ck=entry["crop_sha256"]; sk=entry["source_sha256"]
            require(len(ck)==len(sk)==64 and entry.get("source_version"),
                    "Invalid source pin")
            require(ck not in seen or seen[ck]==(sk,entry["role"]),
                    "Conflicting duplicate crop")
            if ck in seen:continue
            seen[ck]=(sk,entry["role"])
            if entry["role"]=="reference":
                a=by_crop.get(ck)
                require(a is not None and a["sha"]==sk
                        and a["clip"] in entry["crop_name"]
                        and a.get("source_version")==entry["source_version"],
                        "Reference cannot be matched to exact owner-approved source and crop")
                if not entry.get("strict_upright_crop_quality"):continue
                if a.get("frame_timing_verified") is not True:continue
                reference.append({"crop_sha256":ck,"source_sha256":sk,
                                  "folder_id":a["folder"],"track_id":a["track"],
                                  "verified_exact_track_source":True})
            elif entry["role"]=="heldout":
                require(entry.get("strict_upright_crop_quality") is True,
                        "Heldout needs strict upright full-person crop")
                query.append({"crop_sha256":ck,"source_sha256":sk,
                              "track_id":entry["track_id"]})
            else:raise ValueError("Unknown image role")
    require(len(reference)>=25 and len(query)>=40,
            "Insufficient reference/heldout evidence")
    require(not ({r["source_sha256"] for r in reference}
                 &{q["source_sha256"] for q in query}),
            "Gallery contains heldout source")
    assert all("folder_id" not in q for q in query)
    manifest={
        "schema":"S9_R741_SEALED_BLIND_FULLPERSON_REID_METADATA_V1",
        "model_sha256":MODEL,"approved_reference_cache_SHA256":PIN_APPROVED,
        "owner_reference_revision_digest":PIN_OWNER_REFERENCE_DIGEST,
        "no_heldout_ground_truth_in_scoring":True,
        "known_unknown_rejection_validated":False,
        "source_frame_pts_independently_verified_on_phone":False,
        "automatic_folder_assignments":0,
        "references":sorted(reference,key=lambda x:x["crop_sha256"]),
        "queries":sorted(query,key=lambda x:x["crop_sha256"])
    }
    require(not output.exists() and not output.is_symlink(),
            "Refuse to overwrite an evaluation epoch")
    blob=(json.dumps(manifest,sort_keys=True,separators=(",",":"))+"\n").encode()
    output.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(prefix=".r741-",dir=output.parent)
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,"wb") as f:f.write(blob);f.flush();os.fsync(f.fileno())
        os.rename(tmp,output)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)
    print(json.dumps({"status":"R741_BLIND_MANIFEST_FROZEN",
                      "model_sha256":MODEL,"gallery_cache_sha256":PIN_APPROVED,
                      "manifest_sha256":sha(output),
                      "reference_crops":len(reference),
                      "approved_unique_reference_sources":len({r["source_sha256"] for r in reference}),
                      "query_crops":len(query),
                      "query_source_recordings":len({q["source_sha256"] for q in query}),
                      "truth_read":False,"auto_assignments":0},sort_keys=True))

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--output",required=True,type=Path)
    create(p.parse_args().output)
