#!/usr/bin/env python3
"""Source-only V235 comparison of two independently obtained hash reports.

This module NEVER opens a recording, ADB connection, network service,
Android KeyStore, human-review database, or a production enrollment state.
Two matching self-described reports do NOT establish a trusted independent
witness; they only produce the *candidate* canonical digest for owner review.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re

SCHEMA="s9_migrated_source_inventory_v235"
RESULT_SCHEMA="s9_migrated_provenance_comparison_v235"
ORIGINAL_ROLE="c720p-original-hash"
COPIED_ROLE="s9-copied-microsd-hash"
EXPECTED_COUNT=6
EXPECTED_BYTES=214181934
MAX_INPUT=16384
SHA=re.compile(r"[a-f0-9]{64}\Z")
NAME=re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,139}\.mp4\Z")
REPORT_FIELDS={"schema","role","items"}
ROW_FIELDS={"name","sha256","bytes","hash_complete"}

class UnverifiedProvenance(ValueError):
    pass

def _no_duplicate_keys(pairs):
    result={}
    for key,value in pairs:
        if key in result:
            raise UnverifiedProvenance("duplicate_json_key")
        result[key]=value
    return result

def _reject_constant(value):
    raise UnverifiedProvenance("nonfinite_numeric_token")

def _read_report(path, expected_role):
    p=Path(path)
    if p.is_symlink() or not p.is_file():
        raise UnverifiedProvenance("report_must_be_regular_file")
    if p.stat().st_size<150 or p.stat().st_size>MAX_INPUT:
        raise UnverifiedProvenance("report_size_out_of_bounds")
    raw=p.read_bytes()
    if len(raw)>MAX_INPUT:
        raise UnverifiedProvenance("report_size_changed")
    try:
        doc=json.loads(raw.decode("utf-8"),object_pairs_hook=_no_duplicate_keys,
                       parse_constant=_reject_constant)
    except (UnicodeError, json.JSONDecodeError) as e:
        raise UnverifiedProvenance("invalid_report_encoding_or_json") from e
    if type(doc) is not dict or set(doc)!=REPORT_FIELDS or doc.get("schema")!=SCHEMA:
        raise UnverifiedProvenance("unrecognized_report_schema")
    if doc["role"]!=expected_role:
        raise UnverifiedProvenance("inventory_role_not_independently_identified")
    rows=doc.get("items")
    if type(rows) is not list or len(rows)!=EXPECTED_COUNT:
        raise UnverifiedProvenance("exactly_six_rows_required")
    contents={}
    total=0
    for item in rows:
        if type(item) is not dict or set(item)!=ROW_FIELDS:
            raise UnverifiedProvenance("unexpected_or_missing_source_field")
        name=item.get("name")
        sha=item.get("sha256")
        size=item.get("bytes")
        if type(name) is not str or not NAME.fullmatch(name) or ".." in name:
            raise UnverifiedProvenance("invalid_source_name")
        if type(sha) is not str or not SHA.fullmatch(sha):
            raise UnverifiedProvenance("invalid_source_sha256")
        if type(size) is not int or size<10000 or size>900*1024*1024:
            raise UnverifiedProvenance("invalid_source_bytes")
        if item.get("hash_complete") is not True:
            raise UnverifiedProvenance("unverified_source_hashing")
        if name in contents:
            raise UnverifiedProvenance("duplicate_source_name")
        total+=size
        contents[name]=(sha,size)
    if total!=EXPECTED_BYTES:
        raise UnverifiedProvenance("six_original_source_total_mismatch")
    return contents,hashlib.sha256(raw).hexdigest()

def candidate_comparison(c720p_report,s9_report):
    c720p,c720p_report_sha=_read_report(c720p_report,ORIGINAL_ROLE)
    s9,s9_report_sha=_read_report(s9_report,COPIED_ROLE)
    if c720p!=s9:
        raise UnverifiedProvenance("independent_inventory_bytes_or_digest_mismatch")
    names=sorted(c720p)
    body="S9-MIGRATED-MANIFEST-V216|1|6\n"
    for name in names:
        sha,size=c720p[name]
        body+="FILE|"+name+"|"+sha+"|"+str(size)+"|1\n"
    canonical=hashlib.sha256(body.encode("ascii")).hexdigest()
    return {
        "schema":RESULT_SCHEMA,
        "comparison":"MATCHING_REPORTED_HASHES_NOT_INDEPENDENT_ATTESTATION",
        "source_count":EXPECTED_COUNT,
        "source_bytes":EXPECTED_BYTES,
        "manifest_generation":1,
        "candidate_manifest_preimage_sha256":canonical,
        "c720p_report_sha256":c720p_report_sha,
        "s9_report_sha256":s9_report_sha,
        "independently_authenticated":False,
        "human_owner_approved":False,
        "keystore_enrolled":False,
        "allows_signed_actions":False,
        "allows_media_retirement":False,
        "required_next_action":"An authenticated owner/delegate must compare independent physical readback receipts and explicitly approve the exact candidate digest and dedicated APK signing identity outside any untrusted request."
    }

def main():
    parser=argparse.ArgumentParser(description="Compare separately obtained original/copy hash reports; NEVER approve or enroll")
    parser.add_argument("--c720p-original-inventory",required=True,type=Path)
    parser.add_argument("--s9-copied-inventory",required=True,type=Path)
    args=parser.parse_args()
    try:
        result=candidate_comparison(args.c720p_original_inventory,args.s9_copied_inventory)
    except UnverifiedProvenance as e:
        parser.exit(3,"UNVERIFIED_SOURCE_COMPARISON "+str(e)+"\n")
    print(json.dumps(result,sort_keys=True,separators=(",",":"),allow_nan=False))

if __name__=="__main__":
    main()
