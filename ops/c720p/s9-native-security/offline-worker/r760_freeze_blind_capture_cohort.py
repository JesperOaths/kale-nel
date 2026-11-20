#!/usr/bin/env python3
"""R760: immutable anonymous historical-exploration / future-trial cutoff.

No person identity, image, video, biometric vector or People-folder data are
processed. This is NOT an independent person-labelled cohort. It prevents
using old development recordings as if they had been prospectively collected.

Only one intentional file write: a 0600 exclusive-create JSON research
manifest under the private C720P research directory. Never touches phone,
camera, People folders, original source archives, or scheduled tasks.
"""
from __future__ import annotations
import argparse,collections,datetime as dt,hashlib,json,os,re,sys,time
from pathlib import Path
from zoneinfo import ZoneInfo

import r758_capture_day_leakage_audit as audit

DEST=Path("/home/jespern/c720p-home-hub/staging/recognition-r744-ain-small-model-assets-20261120/r760_anonymous_cohort_freeze.json")
ZONE=ZoneInfo("Europe/Amsterdam")
SCHEMA="s9_r760_anonymous_capture_cohort_cutoff_v1"

def need(ok,msg):
    if not ok:raise ValueError(msg)

def canonical(data):
    return json.dumps(data,sort_keys=True,separators=(",",":"),ensure_ascii=True).encode("utf-8")

def source_day(name):
    return dt.datetime.fromtimestamp(int(name[7:20])/1000,ZONE).date().isoformat()

def inspect(catalog,ledger,rows,cutoff_ms):
    need(type(cutoff_ms) is int and cutoff_ms>0,"invalid_cutoff")
    need(isinstance(catalog,dict) and
         catalog.get("schema_version")=="s9_native_archive_catalog_v1",
         "untrusted_original_catalog")
    records=catalog.get("records")
    need(type(records) is dict and 0<len(records)<=4096,
         "untrusted_original_catalog_shape")
    checks=ledger.get("checks")
    need(type(checks) is dict,"untrusted_source_ledger")
    need(isinstance(rows,list) and rows,"research_crop_manifest_unavailable")
    ref_sources={x["source_sha256"] for x in rows if x["role"]=="reference"}
    research_sources={x["source_sha256"] for x in rows}
    indexed={}
    for name,rec in records.items():
        need(audit.CLIP.fullmatch(name) is not None,
             "nonmotion_original_in_catalog")
        sha=rec.get("manifest",{}).get("sha256")
        need(audit.metadata.sha_valid(sha) and
             audit.metadata.sha_valid(rec.get("version")) and
             sha not in indexed, "catalog_version_or_SHA_invalid_or_duplicate")
        timestamp=int(name[7:20])
        need(timestamp<=cutoff_ms,"future_original_seen_before_cohort_cutoff")
        indexed[sha]={"name":name,"date":source_day(name),
                      "timestamp":timestamp,"version":rec["version"],
                      "size":rec.get("bytes")}
    need(ref_sources <= set(indexed) and research_sources <= set(indexed),
         "reference_sources_absent_in_current_catalog")
    reference_days={indexed[s]["date"] for s in ref_sources}
    candidate=[]
    accepted_ledger=0;stale_ledger=0
    counts=collections.Counter()
    for sha,entry in indexed.items():
        if entry["date"] in reference_days:continue
        if sha in research_sources:continue
        if not (type(entry["size"]) is int and
                1000000<=entry["size"]<=300000000):
            counts["file_size_or_manifest_guard_fail"]+=1;continue
        name=entry["name"]
        proof=checks.get(name,{})
        if proof.get("original_sha256_matches") is not True or (
             proof.get("catalog_version")!=entry["version"]):
            counts["source_ledger_version_unverified"]+=1
            continue
        age_seconds=(cutoff_ms/1000)-proof.get("checked_epoch",-1e20)
        if type(age_seconds) not in (int,float) or age_seconds< -120:
            counts["source_ledger_time_invalid"]+=1;continue
        if age_seconds<=14*86400:accepted_ledger+=1
        else:stale_ledger+=1
        candidate.append(sha)
    candidate=sorted(candidate)
    days=collections.Counter(indexed[s]["date"] for s in candidate)
    require_all={s:{"sha256":s,"version":indexed[s]["version"]}
                 for s in sorted(indexed)}
    commitment=hashlib.sha256(canonical(require_all)).hexdigest()
    # Source SHA list is retained in this private research file only.
    # No labels or matching pairs are stored here.
    return {
        "schema":SCHEMA,
        "purpose":"ANONYMOUS_ARCHIVAL_EXPLORATION_ONLY_NOT_PERSON_ACCURACY",
        "catalog_snapshot_id":catalog.get("snapshot_id"),
        "catalog_source_version_commitment_sha256":commitment,
        "cutoff_epoch_ms":cutoff_ms,
        "cutoff_utc":dt.datetime.fromtimestamp(cutoff_ms/1000,dt.timezone.utc).isoformat(),
        "prospective_independent_recordings_observed_at_cutoff":0,
        "prospective_admission_requirement":"recording_epoch_strictly_after_cutoff_plus_verified_new_original_source_sha_plus_independent_no_prior_model_exposure_plus_person_truth",
        "archive_original_recordings":len(indexed),
        "reference_original_source_count":len(ref_sources),
        "reference_capture_days_local":len(reference_days),
        "all_prior_research_original_sources_excluded":len(research_sources),
        "historical_exploratory_candidates":len(candidate),
        "historical_exploratory_candidate_capture_days_local":len(days),
        "historical_exploratory_candidates_with_recent_ledger_check":accepted_ledger,
        "historical_exploratory_candidates_with_old_ledger_check":stale_ledger,
        "excluded_reason_counts":dict(sorted(counts.items())),
        "historical_exploratory_source_sha256_private":candidate,
        "historical_exploratory_capture_date_aggregate":dict(sorted(days.items())),
        "known_person_ground_truth_independently_validated":False,
        "unknown_person_ground_truth_independently_validated":False,
        "outfit_episodes_independently_disjoint":False,
        "historical_samples_are_prospective":False,
        "any_person_crop_PTS_approved":False,
        "eligible_for_reid_identity_accuracy_claim":False,
        "automatic_people_folder_filing_authorized":False,
        "person_labels_read":0,
        "embedding_scores_computed":0,
        "video_frames_decoded":0,
    }

def public(obj):
    return {k:v for k,v in obj.items()
            if k not in ("historical_exploratory_source_sha256_private",
                         "historical_exploratory_capture_date_aggregate",
                         "catalog_snapshot_id",
                         "catalog_source_version_commitment_sha256")}

def collect(cutoff):
    catalog=audit.load_json(audit.CATALOG)
    ledger=audit.load_json(audit.LEDGER)
    rows=audit.phone_rows()
    return inspect(catalog,ledger,rows,cutoff)

def create(obj,path):
    need(path==DEST and path.parent.is_dir() and
         not path.parent.is_symlink(),"not_research_destination")
    need(not path.exists() and not path.is_symlink(),"cohort_already_frozen_no_overwrite")
    raw=canonical(obj)
    need(len(raw)<300000,"research_freeze_too_large")
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        with os.fdopen(fd,"wb") as f:
            f.write(raw);f.flush();os.fsync(f.fileno())
    except BaseException:
        if path.exists():path.unlink()
        raise
    return hashlib.sha256(raw).hexdigest()

def verify():
    need(DEST.is_file() and not DEST.is_symlink() and
         DEST.stat().st_size<300000,"missing_or_corrupt_frozen_cohort")
    value=json.loads(DEST.read_bytes())
    need(value.get("schema")==SCHEMA and
         value.get("automatic_people_folder_filing_authorized") is False and
         value.get("historical_samples_are_prospective") is False and
         value.get("prospective_independent_recordings_observed_at_cutoff")==0,
         "frozen_cohort_wrong_contract")
    need(value.get("historical_exploratory_candidates")==len(value.get("historical_exploratory_source_sha256_private",[])),
         "frozen_cohort_count_inconsistent")
    need(len(set(value["historical_exploratory_source_sha256_private"]))==
         value["historical_exploratory_candidates"],
         "duplicate_freeze_source")
    return public(value)

def self_test():
    def entry(name,sha):
        return {"version":sha,"bytes":40000000,
                "manifest":{"name":name,"sha256":sha}}
    a,b,c,d="a"*64,"b"*64,"c"*64,"d"*64
    t=dt.datetime(2026,11,18,12,tzinfo=dt.timezone.utc).timestamp()
    n1="motion_"+str(int(t*1000))+".mp4"
    n2="motion_"+str(int((t+86400)*1000))+".mp4"
    n3="motion_"+str(int((t+86400+3600)*1000))+".mp4"
    cat={"schema_version":"s9_native_archive_catalog_v1","snapshot_id":d,
         "records":{n1:entry(n1,a),n2:entry(n2,b),n3:entry(n3,c)}}
    cutoff=int((t+3*86400)*1000)
    ledger={"checks":{n:{"original_sha256_matches":True,
                           "catalog_version":rec["version"],
                           "checked_epoch":cutoff/1000-300}
                      for n,rec in cat["records"].items()}}
    rows=[{"role":"reference","source_sha256":a},
          {"role":"heldout","source_sha256":b}]
    frozen=inspect(cat,ledger,rows,cutoff)
    need(frozen["historical_exploratory_candidates"]==1 and
         frozen["historical_exploratory_source_sha256_private"]==[c] and
         frozen["historical_samples_are_prospective"] is False,
         "prior_research_original_or_reference_day_leaked")
    modified=dict(cat,records=dict(cat["records"]))
    future="motion_"+str(int((t+5*86400)*1000))+".mp4"
    modified["records"][future]=entry(future,d)
    try:inspect(modified,ledger,rows,cutoff);raise AssertionError("future_leak")
    except ValueError as exc:need("future_original_seen" in str(exc),"wrong_future_refusal")
    try:inspect(cat,{"checks":{}},rows,cutoff)
    except ValueError:pass
    else:
        bad=inspect(cat,{"checks":{}},rows,cutoff)
        need(bad["historical_exploratory_candidates"]==0,
             "unverified_ledger_source_accepted")
    print(json.dumps({"result":"R760_SYNTHETIC_COHORT_FREEZE_PASS",
        "tests":3,"prospective_identity_claim":False,
        "automatic_person_filing":False},sort_keys=True))

def main():
    parser=argparse.ArgumentParser()
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--self-test",action="store_true")
    group.add_argument("--freeze",action="store_true")
    group.add_argument("--verify",action="store_true")
    args=parser.parse_args()
    if args.self_test:self_test()
    elif args.verify:print(json.dumps(verify(),sort_keys=True,indent=2))
    else:
        cutoff=int(time.time()*1000)
        result=collect(cutoff)
        checksum=create(result,DEST)
        output=public(result)
        output["private_manifest_sha256"]=checksum
        print(json.dumps(output,sort_keys=True,indent=2))

if __name__=="__main__":
    main()
