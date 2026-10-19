#!/usr/bin/env python3
"""Authenticated archive-proxy read-only surface for S9+ appearance scores.

S9+ owns model inference, private 512-D vectors and all pairwise scoring.
Hub only maps scoped SHA keys to already-viewable S9 recordings and serves
top-5 *appearance* comparisons. Never biometric identity probabilities,
automatic person assignments, underlying images, or raw vector payloads.
"""
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import parse_qs,urlsplit

STATE=Path("/home/jespern/c720p-home-hub/state/s9-multivector-crop-map-v1.json")
ROUTE="/new/api/appearance-multivector"
PHONE="192.168.178.250:5555"
PHONE_SCORES="/data/local/tmp/s9_worker/rankings-v1.json"
SHA=re.compile(r"[a-f0-9]{64}\Z")
CLIP=re.compile(r"[A-Za-z0-9][A-Za-z0-9_. ()-]{0,230}[.]mp4\Z")
VISUAL_SHA="ee5717ad7a90cf0c915afa1fb6a5399b966562c5d42aa6f4a0c6c84a5349e47d"


def mapping():
    if STATE.is_symlink() or not STATE.is_file() or STATE.stat().st_size>110000:
        raise ValueError("unavailable_private_v40_provenance_map")
    doc=json.loads(STATE.read_text())
    if (doc.get("schema")!="s9_v40_multivector_map_v1"
        or doc.get("visual_model_sha256")!=VISUAL_SHA):
        raise ValueError("unverified_source_qualified_mapping")
    rows=doc.get("rows")
    if not isinstance(rows,list) or not 2<=len(rows)<=200:
        raise ValueError("invalid_real_crop_index")
    clips={};keys={}
    for x in rows:
        if not isinstance(x,dict) or x.get("source")!="s9_sd":
            raise ValueError("unexpected_evidence_source")
        key=x.get("key");clip=x.get("clip")
        if not isinstance(key,str) or not SHA.fullmatch(key):
            raise ValueError("invalid_source_key")
        if not isinstance(clip,str) or not CLIP.fullmatch(clip) or ".." in clip:
            raise ValueError("invalid_clip_name")
        if key in keys:raise ValueError("duplicate_source_key")
        keys[key]=clip
        clips.setdefault(clip,[]).append(key)
    return clips,keys


def phone_rankings():
    r=subprocess.run(["adb","-s",PHONE,"exec-out","cat",PHONE_SCORES],
                     capture_output=True,timeout=13)
    if r.returncode or len(r.stdout)>700000:
        raise ValueError("phone_similarity_index_unavailable")
    doc=json.loads(r.stdout)
    if (doc.get("schema")!="s9_appearance_rankings_v1"
        or doc.get("identity_probabilities") is not False
        or doc.get("automatically_assigned_people")!=0):
        raise ValueError("untrusted_phone_appearance_rankings")
    rows=doc.get("rankings")
    if not isinstance(rows,list) or not 2<=len(rows)<=200:
        raise ValueError("invalid_phone_ranking_count")
    return rows


def report(clip):
    clips,keys=mapping()
    if clip not in clips:return 404,{"ok":False,"error":"no_verified_person_crop"}
    rankings=phone_rankings()
    records={}
    for row in rankings:
        key=row.get("reference_key")
        if key not in keys:raise ValueError("phone_rankings_have_unknown_reference")
        hits=row.get("similar_appearance_only")
        if not isinstance(hits,list) or len(hits)>5:
            raise ValueError("unsafe_phone_candidate_list")
        records[key]=hits
    if len(records)!=len(keys):
        raise ValueError("incomplete_phone_ranked_corpus")
    results={}
    for ref in clips[clip]:
        for hit in records[ref]:
            key=hit.get("candidate_key")
            if key not in keys:raise ValueError("unknown_candidate_source")
            candidate=keys[key]
            if candidate==clip:continue
            if (hit.get("verified_same_person") is not False
                or hit.get("human_review_required") is not True
                or hit.get("method") not in
                  ("visual_75_color_25","structural_70_visual_30")):
                raise ValueError("unsupported_identity_claim")
            score=hit.get("appearance_similarity_percent")
            if type(score) not in (int,float) or not 0<=score<=100:
                raise ValueError("invalid_similarity_percentage")
            old=results.get(candidate)
            if old is None or score>old["similarity_percent"]:
                results[candidate]={
                    "clip_name":candidate,"source":"s9_sd",
                    "similarity_percent":round(float(score),2),
                    "similarity":round(float(score)/100,4),
                    "method":hit["method"],
                    "appearance_only":True,
                    "verified_same_person":False,
                    "human_review_required":True,
                    "auto_assignment":False,
                }
    ordered=sorted(results.values(),key=lambda x:(-x["similarity_percent"],x["clip_name"]))[:5]
    return 200,{
        "ok":True,
        "status":"ready_real_osnet_color",
        "source":"S9+ offline worker",
        "reference_source":"s9_sd",
        "reference_clip":clip,
        "metric":"conditional_real_512d_osnet_plus_hsv",
        "model_sha256":VISUAL_SHA,
        "appearance_only":True,
        "verified_same_person":False,
        "identity_probability":False,
        "automatic_person_assignments":0,
        "human_review_required":True,
        "coverage":{"real_person_crops":len(keys),"qualified_recordings":len(clips)},
        "results":ordered,
    }


def install(H):
    original=H.go
    def go(self):
        url=urlsplit(self.path)
        if url.path!=ROUTE:return original(self)
        q=parse_qs(url.query,keep_blank_values=True)
        if set(q)!={"clip"} or len(q["clip"])!=1:
            return self.js(400,{"ok":False,"error":"one_clip_required"})
        clip=q["clip"][0]
        if not CLIP.fullmatch(clip) or ".." in clip:
            return self.js(400,{"ok":False,"error":"invalid_clip"})
        try:
            code,payload=report(clip)
            return self.js(code,payload)
        except (OSError,ValueError,TypeError,subprocess.TimeoutExpired):
            return self.js(503,{"ok":False,"error":"multivector_index_not_ready"})
    H.go=go
