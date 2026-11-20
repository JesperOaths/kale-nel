#!/usr/bin/env python3
"""R758: provenance-only, fail-closed reference/holdout capture-day audit.

Uses only metadata already held by the camera archive catalog, the
independent source SHA verification ledger, and S9-research crop batch
manifests. No photo/video, embeddings, recognition scores, names,
person identities or People-folder labels are read or output.

Output is aggregate counts only. A source-disjoint split can still
contain an evaluation leak if gallery and holdout use the same capture
date, as the existing S9 research split does.

This is a research gate; it NEVER activates People-folder filing.
"""
from __future__ import annotations
import argparse
import collections
import datetime as dt
import json
from pathlib import Path
import re
import subprocess
import time
from zoneinfo import ZoneInfo

import s9_reid_manifest_integrity_v749 as metadata

PHONE = "192.168.178.250:5555"
STATE = Path("/home/jespern/c720p-home-hub/state")
CATALOG = STATE / "s9-standalone-archive-catalog-v1.json"
SUMMARY = STATE / "s9-standalone-archive-summary-v1.json"
LEDGER = STATE / "s9-original-hash-ledger-v1.json"
RESEARCH = "/data/local/tmp/s9-osnet-qualcomm-reid-shadow"
CLIP = re.compile(r"motion_[0-9]{13}[.]mp4\Z")
BATCH = re.compile(r"batch-[a-f0-9]{12}[.]json\Z")
AMSTERDAM = ZoneInfo("Europe/Amsterdam")
UTC = dt.timezone.utc
MAX_CATALOG_AGE_SEC = 3600
MAX_LEDGER_SOURCE_AGE_SEC = 14 * 86400
MAX_RESEARCH_LEDGER_AGE_SEC = 90 * 86400

def need(ok,reason):
    if not ok:
        raise ValueError(reason)

def load_json(path, now=None, max_age=None):
    need(path.is_file() and not path.is_symlink() and
         100 < path.stat().st_size < 10_000_000,
         "missing_or_untrusted_research_source_metadata")
    if max_age is not None:
        t=time.time() if now is None else now
        need(-120 <= t-path.stat().st_mtime <= max_age,
             "current_source_catalog_not_recent")
    return json.loads(path.read_bytes())

def source_day(name, timezone):
    need(type(name) is str and CLIP.fullmatch(name) is not None,
         "invalid_verified_original_basename")
    ms=int(name[7:20])
    moment=dt.datetime.fromtimestamp(ms/1000, timezone)
    need(2020 <= moment.year <= 2100,"invalid_source_capture_timestamp")
    return moment.date().isoformat()

def validate_catalog(catalog, summary, ledger, all_crop_rows, now=None):
    """Exact SHA joins; refuse missing/version-mismatched ledger entries."""
    now=time.time() if now is None else now
    need(catalog.get("schema_version")=="s9_native_archive_catalog_v1" and
         type(catalog.get("records")) is dict and
         1<=len(catalog["records"])<=4096,
         "untrusted_current_catalog")
    need(summary.get("catalog_snapshot_id")==catalog.get("snapshot_id") and
         summary.get("camera_4k_healthy_before_and_after") is True and
         summary.get("video_bytes_transferred_to_hub") is False,
         "catalog_summary_not_current_camera_verified")
    need(ledger.get("schema_version")=="s9-original-hash-ledger-v1" and
         type(ledger.get("checks")) is dict,
         "original_checksum_ledger_untrusted")
    entries={}
    for name,rec in catalog["records"].items():
        if not CLIP.fullmatch(name):continue
        require_sha=rec.get("manifest",{}).get("sha256")
        if not metadata.sha_valid(require_sha):continue
        need(require_sha not in entries,"duplicate_original_SHA_in_catalog")
        entries[require_sha]=(name,rec)
    by_source={}
    for row in all_crop_rows:
        source=row["source_sha256"]
        if source in by_source:
            need(by_source[source]["version"]==row["source_version"],
                 "same_source_has_conflicting_crop_manifest_versions")
            continue
        need(source in entries,"research_source_not_present_in_current_catalog")
        name,rec=entries[source]
        data=rec.get("manifest",{})
        need(rec.get("version")==row["source_version"] and
             metadata.sha_valid(rec["version"]),
             "research_source_version_not_current")
        need(data.get("name")==name and data.get("sha256")==source and
             data.get("bytes")==rec.get("bytes") and
             data.get("width")==3840 and data.get("height")==2160,
             "current_original_manifest_geometry_or_SHA_mismatch")
        proof=ledger["checks"].get(name,{})
        age=now-proof.get("checked_epoch",-1e20) if type(proof.get("checked_epoch")) in (float,int) else float("inf")
        need(proof.get("original_sha256_matches") is True and
             proof.get("catalog_version")==rec["version"] and
             -120 <= age <= MAX_RESEARCH_LEDGER_AGE_SEC,
             "source_SHA_ledger_missing_stale_or_wrong_version")
        by_source[source]={
            "version":rec["version"],
            "capture_day_local":source_day(name,AMSTERDAM),
            "capture_day_utc":source_day(name,UTC),
            "ledger_verified_age_seconds":age,
            "ledger_sha_recheck_within_14_days":age <= MAX_LEDGER_SOURCE_AGE_SEC}
    return by_source

def audit_rows(rows,catalog,summary,ledger,now=None):
    need(type(rows) is list and len(rows)>0,
         "research_plan_missing")
    by_source=validate_catalog(catalog,summary,ledger,rows,now)
    refs={r["source_sha256"] for r in rows if r["role"]=="reference"}
    hold={r["source_sha256"] for r in rows if r["role"]=="heldout"}
    need(refs and hold,"missing_reference_or_holdout_roles")
    overlap=refs & hold
    def dayset(keys,field):
        return {by_source[k][field] for k in keys}
    shared_local=(dayset(refs,"capture_day_local") &
                  dayset(hold,"capture_day_local"))
    shared_utc=(dayset(refs,"capture_day_utc") &
                dayset(hold,"capture_day_utc"))
    source_leak=len(overlap)
    current_checked=sum(bool(x["ledger_sha_recheck_within_14_days"])
                        for x in by_source.values())
    bad_hold_sources=sum(by_source[s]["capture_day_local"] in shared_local for s in hold)
    good_hold_sources=len(hold)-bad_hold_sources
    bad_hold_rows=sum(r["role"]=="heldout" and
                      by_source[r["source_sha256"]]["capture_day_local"] in shared_local
                      for r in rows)
    total_hold_rows=sum(r["role"]=="heldout" for r in rows)
    unique_good_crops={
        r["crop_sha256"] for r in rows if r["role"]=="heldout" and
        by_source[r["source_sha256"]]["capture_day_local"] not in shared_local}
    return {
        "schema":"s9_r758_sha_verified_capture_day_split_audit_v1",
        "result":("SOURCE_AND_DAY_DISJOINT_METADATA_ONLY"
                  if not overlap and not shared_local and not shared_utc
                  else "FAIL_CAPTURE_DAY_OR_SOURCE_DISJOINTNESS"),
        "current_catalog_originals":len(catalog["records"]),
        "current_research_plan_rows":len(rows),
        "distinct_research_sources":len(by_source),
        "source_versions_verified_against_original_catalog_and_ledger":len(by_source),
        "source_SHA_ledger_rechecks_within_14_days":current_checked,
        "source_SHA_ledger_rechecks_older_than_14_days":len(by_source)-current_checked,
        "all_source_SHA_rechecks_current":current_checked==len(by_source),
        "reference_distinct_sources":len(refs),
        "holdout_distinct_sources":len(hold),
        "reference_holdout_source_sha_overlap":source_leak,
        "reference_capture_days_local":len(dayset(refs,"capture_day_local")),
        "holdout_capture_days_local":len(dayset(hold,"capture_day_local")),
        "shared_capture_days_local":len(shared_local),
        "shared_capture_days_utc":len(shared_utc),
        "holdout_sources_on_shared_days":bad_hold_sources,
        "holdout_sources_on_exclusive_days":good_hold_sources,
        "holdout_rows_on_shared_days":bad_hold_rows,
        "holdout_rows_on_exclusive_days":total_hold_rows-bad_hold_rows,
        "distinct_holdout_crops_on_exclusive_days":len(unique_good_crops),
        "holdout_exclusive_capture_day_count":
            len(dayset({s for s in hold if by_source[s]["capture_day_local"] not in shared_local},
                       "capture_day_local")),
        "source_capture_day_inferred_from_original_filename_epoch":True,
        "original_file_sha_still_reverified_for_each_historical_crop":False,
        "model_identity_release_evidence_qualified":False,
        "historical_crop_PTS_independently_attested":False,
        "outfit_episodes_independently_disjoint":False,
        "independent_known_unknown_person_truth_evaluated":False,
        "automated_identity_filing_authorized":False,
        "biometric_embeddings_loaded":0,
        "person_identity_labels_read":0,
        "photos_decoded":0,
        "video_bytes_transferred_to_hub":0
    }

def phone_rows():
    listing=subprocess.run(["adb","-s",PHONE,"shell","ls","-1",RESEARCH],
                           capture_output=True,text=True,check=True,timeout=10)
    names=sorted(x.strip() for x in listing.stdout.splitlines()
                 if x.startswith("batch-") and x.endswith(".json"))
    need(len(names)>0 and len(names)<=200 and
         all(BATCH.fullmatch(x) for x in names),
         "untrusted_research_batch_filenames")
    rows_by_index={}
    plan=None
    for name in names:
        packet=metadata.phone_json(RESEARCH+"/"+name)
        plan_hash,start,end,payload=metadata.extract_batch(packet)
        if plan is None:plan=plan_hash
        need(plan==plan_hash,"mixed_research_plan_hashes")
        for n,x in enumerate(payload):
            pos=start+n
            if pos in rows_by_index:
                need(rows_by_index[pos]==x,
                     "research_manifest_replay_differs_at_same_row")
            else:
                rows_by_index[pos]=x
    need(sorted(rows_by_index)==list(range(max(rows_by_index)+1)),
         "research_manifest_ranges_noncontiguous")
    return [rows_by_index[k] for k in sorted(rows_by_index)]

def audit_phone():
    now=time.time()
    catalog=load_json(CATALOG,now,MAX_CATALOG_AGE_SEC)
    summary=load_json(SUMMARY,now,MAX_CATALOG_AGE_SEC)
    ledger=load_json(LEDGER)
    rows=phone_rows()
    print(json.dumps(audit_rows(rows,catalog,summary,ledger,now),sort_keys=True,indent=2))

def self_test():
    ha="a"*64;hb="b"*64;hc="c"*64;hd="d"*64
    t=dt.datetime(2026,11,18,11,0,0,tzinfo=UTC).timestamp()
    n1="motion_"+str(int(t*1000))+".mp4"
    n2="motion_"+str(int((t+3600)*1000))+".mp4"
    n3="motion_"+str(int((t+86400)*1000))+".mp4"
    def entry(name,sha):
        return {"version":sha,"bytes":40000000,
                "manifest":{"name":name,"sha256":sha,"bytes":40000000,
                            "width":3840,"height":2160}}
    records={n1:entry(n1,ha),n2:entry(n2,hb),n3:entry(n3,hc)}
    catalog={"schema_version":"s9_native_archive_catalog_v1",
             "snapshot_id":hd,"records":records}
    summary={"catalog_snapshot_id":hd,"camera_4k_healthy_before_and_after":True,
             "video_bytes_transferred_to_hub":False}
    now=t+90000
    ledger={"schema_version":"s9-original-hash-ledger-v1",
            "checks":{n:{"original_sha256_matches":True,
                          "catalog_version":rec["version"],
                          "checked_epoch":now-180}
                      for n,rec in records.items()}}
    def row(role,source):
        return {"role":role,"source_sha256":source,
                "source_version":source,"crop_sha256":hd}
    shared=audit_rows([row("reference",ha),row("heldout",hb)],
                      catalog,summary,ledger,now)
    need(shared["result"]=="FAIL_CAPTURE_DAY_OR_SOURCE_DISJOINTNESS" and
         shared["shared_capture_days_local"]==1 and
         shared["holdout_rows_on_shared_days"]==1 and
         shared["reference_holdout_source_sha_overlap"]==0,
         "same_day_synthetic_leakage_not_rejected")
    clean=audit_rows([row("reference",ha),row("heldout",hc)],
                     catalog,summary,ledger,now)
    need(clean["result"]=="SOURCE_AND_DAY_DISJOINT_METADATA_ONLY",
         "disjoint_synthetic_days_not_recognized")
    faults=0
    for original,reason in (
        ({"checks":{}}, "source_SHA_ledger_missing_stale_or_wrong_version"),
        ({"checks":{n:{"original_sha256_matches":False,
                      "catalog_version":rec["version"],
                      "checked_epoch":now-180} for n,rec in records.items()}},
         "source_SHA_ledger_missing_stale_or_wrong_version"),
        ({"checks":{n:{"original_sha256_matches":True,
                      "catalog_version":hd,
                      "checked_epoch":now-180} for n,rec in records.items()}},
         "source_SHA_ledger_missing_stale_or_wrong_version")):
        corrupt={**ledger,**original}
        try:
            audit_rows([row("reference",ha),row("heldout",hb)],
                       catalog,summary,corrupt,now)
            raise AssertionError("untrusted_ledger_passed")
        except ValueError as e:
            need(reason in str(e),"wrong_synthetic_refusal_reason")
        faults+=1
    for corrupted,reason in (
        ({**catalog,"schema_version":"incorrect"},"untrusted_current_catalog"),
        ({**catalog,"records":{n1:entry(n1,ha)}},
         "research_source_not_present_in_current_catalog"),
    ):
        try:
            audit_rows([row("reference",ha),row("heldout",hb)],
                       corrupted,summary,ledger,now)
            raise AssertionError("tampered_catalog_passed")
        except ValueError as e:
            need(reason in str(e),"wrong_synthetic_catalog_refusal")
        faults+=1
    stale_ledger={"schema_version":"s9-original-hash-ledger-v1",
                  "checks":{n:{"original_sha256_matches":True,
                               "catalog_version":rec["version"],
                               "checked_epoch":now-20*86400}
                           for n,rec in records.items()}}
    stale=audit_rows([row("reference",ha),row("heldout",hb)],
                     catalog,summary,stale_ledger,now)
    need(stale["all_source_SHA_rechecks_current"] is False and
         stale["source_SHA_ledger_rechecks_older_than_14_days"]==2 and
         stale["result"]=="FAIL_CAPTURE_DAY_OR_SOURCE_DISJOINTNESS",
         "stale_ledger_should_report_day_leak_without_fresh_claim")
    faults+=1
    try:
        audit_rows([row("reference",ha),row("heldout",ha)],
                   catalog,summary,ledger,now)
        # This is a measured fail status, not an exception.
        result=audit_rows([row("reference",ha),row("heldout",ha)],
                          catalog,summary,ledger,now)
        need(result["reference_holdout_source_sha_overlap"]==1 and
             result["result"]=="FAIL_CAPTURE_DAY_OR_SOURCE_DISJOINTNESS",
             "same_source_overlap_not_rejected")
    except ValueError as e:
        raise AssertionError("same_source_should_produce_failure_report") from e
    faults+=1
    print(json.dumps({
        "status":"R758_SOURCE_CAPTURE_DAY_AUDIT_SYNTHETIC_PASS",
        "adversarial_cases":faults+2,
        "source_day_overlap_flagged":True,
        "source_sha_overlap_flagged":True,
        "raw_vectors_compared":0,
        "people_folder_assignments_enabled":False
    },sort_keys=True))

def main():
    p=argparse.ArgumentParser()
    a=p.add_mutually_exclusive_group(required=True)
    a.add_argument("--self-test",action="store_true")
    a.add_argument("--audit",action="store_true")
    q=p.parse_args()
    if q.self_test:self_test()
    else:audit_phone()

if __name__=="__main__":
    main()
