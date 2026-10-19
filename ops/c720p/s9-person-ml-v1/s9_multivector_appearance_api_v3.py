#!/usr/bin/env python3
"""Independent authenticated read-only S9+ V3 appearance comparisons.

Source-qualified crop SHA / model SHA / uniform HSV32 index validation.
Private 512D vectors never leave the phone. This only returns provisional
appearance search results, never identities, face assertions or filing.
The default V1/V2 handlers and manual review interfaces stay unchanged.
"""
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
from urllib.parse import parse_qs,urlsplit

STATE=Path("/home/jespern/c720p-home-hub/state")
ACTIVE=STATE/"s9-multivector-v3-active.json"
ROUTE="/new/api/appearance-multivector-v3"
PHONE="192.168.178.250:5555"
PHONE_ROOT="/data/local/tmp/s9_worker"
VISUAL_SHA="ee5717ad7a90cf0c915afa1fb6a5399b966562c5d42aa6f4a0c6c84a5349e47d"
HEXDIGEST=re.compile(r"[a-f0-9]{64}\Z")
ID=re.compile(r"[a-f0-9]{16}\Z")
CLIP=re.compile(r"motion_[0-9]{13}[.]mp4\Z")
SCHEMA="s9_uniform_upper_torso_hsv32_v2"
METHOD="visual_75_color_25"

def checksum(data):return hashlib.sha256(data).hexdigest()

def json_local(path,size_limit):
    if path.is_symlink() or not path.is_file():
        raise ValueError("missing_readonly_v3_evidence")
    size=path.stat().st_size
    if not 20<size<=size_limit:
        raise ValueError("invalid_v3_source_size")
    content=path.read_bytes()
    if len(content)!=size:
        raise ValueError("v3_source_changed_during_read")
    return content,json.loads(content)

def active_snapshot():
    _,doc=json_local(ACTIVE,4096)
    corpus=doc.get("corpus_id")
    if (doc.get("schema")!="s9_appearance_v3_active_v1"
        or not isinstance(corpus,str) or not ID.fullmatch(corpus)
        or type(doc.get("verified_crops")) is not int
        or not 58<=doc["verified_crops"]<=400
        or doc.get("automatic_person_assignments")!=0
        or doc.get("human_review_required") is not True
        or any(not isinstance(doc.get(k),str)
               or not HEXDIGEST.fullmatch(doc[k])
               for k in ("map_sha256","rankings_sha256"))):
        raise ValueError("untrusted_v3_active_snapshot")
    return doc

def verified_map(pointer):
    path=STATE/("s9-multivector-crop-map-v3-"+pointer["corpus_id"]+".json")
    data,doc=json_local(path,600000)
    if checksum(data)!=pointer["map_sha256"]:
        raise ValueError("v3_source_map_sha_mismatch")
    rows=doc.get("rows")
    if (doc.get("schema")!="s9_multivector_source_map_v3"
        or doc.get("corpus_id")!=pointer["corpus_id"]
        or doc.get("visual_model_sha256")!=VISUAL_SHA
        or doc.get("color_histogram_schema")!=SCHEMA
        or doc.get("people_assigned_automatically")!=0
        or not isinstance(rows,list)
        or len(rows)!=pointer["verified_crops"]):
        raise ValueError("untrusted_v3_source_map")
    clips={};keys={};v40=approved=0
    for item in rows:
        if not isinstance(item,dict) or item.get("source")!="s9_sd":
            raise ValueError("unknown_v3_archive_source")
        clip=item.get("clip");key=item.get("key")
        cohort=item.get("cohort")
        if (not isinstance(clip,str) or not CLIP.fullmatch(clip)
            or not isinstance(key,str) or not HEXDIGEST.fullmatch(key)
            or cohort not in ("v40","approved_new","archive_unassigned")
            or any(not isinstance(item.get(k),str)
                   or not HEXDIGEST.fullmatch(item[k])
                   for k in ("crop_sha256","visual_sidecar_sha256",
                             "hsv_sidecar_sha256"))):
            raise ValueError("invalid_v3_crop_provenance")
        if key in keys:raise ValueError("duplicate_v3_crop_key")
        if cohort=="v40":v40+=1
        if cohort=="approved_new":approved+=1
        keys[key]=clip
        clips.setdefault(clip,[]).append(key)
    if v40!=51 or approved<6:
        raise ValueError("baseline_v40_or_approved_crops_missing")
    return clips,keys

def phone_rankings(pointer,keys):
    corpus=pointer["corpus_id"]
    remote=PHONE_ROOT+"/rankings-v3-"+corpus+".json"
    output=subprocess.run(
        ["adb","-s",PHONE,"exec-out","cat",remote],
        capture_output=True,timeout=18)
    content=output.stdout
    if output.returncode!=0 or not 100<len(content)<=2100000:
        raise ValueError("v3_phone_rankings_unavailable")
    if checksum(content)!=pointer["rankings_sha256"]:
        raise ValueError("v3_phone_rankings_sha_mismatch")
    doc=json.loads(content)
    rows=doc.get("rankings")
    if (doc.get("schema")!="s9_appearance_rankings_v3"
        or doc.get("corpus_id")!=corpus
        or doc.get("count")!=len(keys)
        or doc.get("model_sha256")!=VISUAL_SHA
        or doc.get("color_histogram_schema")!=SCHEMA
        or doc.get("human_review_required") is not True
        or doc.get("automatically_assigned_people")!=0
        or doc.get("identity_probabilities") is not False
        or not isinstance(rows,list) or len(rows)!=len(keys)):
        raise ValueError("unverified_v3_phone_index")
    rankings={}
    for row in rows:
        if not isinstance(row,dict) or row.get("reference_key") not in keys:
            raise ValueError("foreign_v3_reference")
        ref=row["reference_key"]
        if ref in rankings:raise ValueError("duplicate_v3_reference")
        hits=row.get("similar_appearance_only")
        if not isinstance(hits,list) or len(hits)>5:
            raise ValueError("invalid_v3_candidate_count")
        checked=[]
        for hit in hits:
            if not isinstance(hit,dict):raise ValueError("invalid_v3_candidate")
            key=hit.get("candidate_key")
            score=hit.get("appearance_similarity_percent")
            if (key not in keys or key==ref
                or hit.get("method")!=METHOD
                or hit.get("verified_same_person") is not False
                or hit.get("human_review_required") is not True
                or type(score) not in (int,float) or not math.isfinite(score)
                or not 0<=score<=100):
                raise ValueError("unsupported_v3_identity_or_score")
            checked.append((key,round(float(score),2)))
        rankings[ref]=checked
    if set(rankings)!=set(keys):
        raise ValueError("incomplete_v3_reference_corpus")
    return rankings

def report(clip):
    pointer=active_snapshot()
    clips,keys=verified_map(pointer)
    if clip not in clips:
        return 404,{"ok":False,"error":"no_verified_v3_person_crop"}
    rankings=phone_rankings(pointer,keys)
    candidates={}
    for ref in clips[clip]:
        for key,score in rankings[ref]:
            other=keys[key]
            if other==clip:continue
            if other not in candidates or score>candidates[other]:
                candidates[other]=score
    best=sorted(candidates.items(),key=lambda x:(-x[1],x[0]))[:5]
    return 200,{
        "ok":True,"status":"ready_real_s9_v3",
        "ranking_schema":"s9_appearance_rankings_v3",
        "color_histogram_schema":SCHEMA,
        "corpus_id":pointer["corpus_id"],
        "source":"S9+ offline worker","reference_source":"s9_sd",
        "reference_clip":clip,"model_sha256":VISUAL_SHA,
        "metric":"osnet_75_uniform_torso_hsv32_25",
        "appearance_only":True,"verified_same_person":False,
        "identity_probability":False,"automatic_person_assignments":0,
        "human_review_required":True,
        "coverage":{"real_person_crops":len(keys),
                    "qualified_recordings":len(clips)},
        "results":[{"source":"s9_sd","clip_name":other,
                    "similarity_percent":score,
                    "similarity":round(score/100,4),
                    "method":METHOD,"appearance_only":True,
                    "verified_same_person":False,
                    "human_review_required":True,
                    "auto_assignment":False}
                   for other,score in best],
    }

def install(H):
    previous=H.go
    def go(self):
        url=urlsplit(self.path)
        if url.path!=ROUTE:return previous(self)
        query=parse_qs(url.query,keep_blank_values=True)
        if set(query)!={"clip"} or len(query["clip"])!=1:
            return self.js(400,{"ok":False,"error":"one_clip_required"})
        clip=query["clip"][0]
        if not CLIP.fullmatch(clip):
            return self.js(400,{"ok":False,"error":"invalid_clip"})
        try:
            code,payload=report(clip)
            return self.js(code,payload)
        except (OSError,ValueError,TypeError,KeyError,subprocess.TimeoutExpired):
            return self.js(503,{"ok":False,"error":"v3_appearance_index_not_ready"})
    H.go=go
