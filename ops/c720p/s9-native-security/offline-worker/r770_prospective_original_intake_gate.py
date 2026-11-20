#!/usr/bin/env python3
"""R770 one-shot *anonymous* prospective original intake from live archive.

No identities, person images, video decoding, embedding vectors or folder
data are read. Detects only genuinely new post-freeze original files with
current native-4K source checksum evidence; it never claims that their
contents include known/unknown people. Refuses source-SHA reuse and any
unverified catalog version. No files changed and no new timer/daemon.
"""
from __future__ import annotations
import argparse,datetime as dt,json,os,time
import r758_capture_day_leakage_audit as sources
import r760_freeze_blind_capture_cohort as freeze

def need(condition,why):
    if not condition:raise ValueError(why)

def audit(catalog,ledger,cutoff,now):
    need(type(cutoff) is int and cutoff>0 and
         type(catalog) is dict and catalog.get("schema_version")==
             "s9_native_archive_catalog_v1" and
         type(ledger) is dict and ledger.get("schema_version")==
             "s9-original-hash-ledger-v1",
         "untrusted_current_original_provenance")
    recs=catalog.get("records")
    checks=ledger.get("checks")
    need(type(recs) is dict and type(checks) is dict and
         1<=len(recs)<=4096,"untrusted_original_source_table")
    historical_sha=set()
    new=[]
    duplicates=set()
    for name,entry in recs.items():
        need(type(name) is str and sources.CLIP.fullmatch(name),
             "nonoriginal_filename_in_catalog")
        timestamp=int(name[7:20])
        need(timestamp<=now*1000+120000,
             "future_dated_source_not_trusted")
        info=entry.get("manifest",{})
        original=info.get("sha256")
        need(sources.metadata.sha_valid(original) and
             info.get("name")==name and
             entry.get("bytes")==info.get("bytes") and
             entry.get("version") is not None,
             "incomplete_source_version_or_digest")
        if timestamp<=cutoff:
            historical_sha.add(original)
            continue
        proof=checks.get(name,{})
        if original in historical_sha:duplicates.add(original)
        source_ok=(proof.get("catalog_version")==entry.get("version") and
                   proof.get("original_sha256_matches") is True and
                   type(proof.get("checked_epoch")) in (int,float) and
                   0<=now-proof["checked_epoch"]<=14*86400 and
                   info.get("width")==3840 and
                   info.get("height")==2160 and
                   type(info.get("duration_ms")) is int and
                   info["duration_ms"]>=6000 and
                   type(entry.get("bytes")) is int and
                   10_000_000<=entry["bytes"]<=240_000_000)
        new.append({"source_sha":original,"verified":source_ok})
    need(not duplicates,"post_freeze_source_reuses_historical_sha")
    newsha=[x["source_sha"] for x in new]
    need(len(newsha)==len(set(newsha)),
         "duplicate_post_freeze_original_digests")
    qualified=sum(x["verified"] for x in new)
    return {
        "schema":"s9_r770_prospective_anonymous_original_admission_v1",
        "status":("NO_POST_FREEZE_ORIGINALS" if not new else
                  ("POST_FREEZE_ORIGINALS_SOURCE_VERIFIED_ONLY"
                   if qualified==len(new) else
                   "NEW_ORIGINALS_AWAIT_SOURCE_SHA_VERIFICATION")),
        "archive_original_count":len(recs),
        "historical_originals_not_prospective":len(recs)-len(new),
        "post_freeze_new_originals_seen":len(new),
        "post_freeze_new_originals_verified":qualified,
        "post_freeze_new_originals_not_yet_verified":len(new)-qualified,
        "independent_known_person_labels_count":0,
        "independent_unknown_person_labels_count":0,
        "source_frame_crop_pts_attested":False,
        "model_inference_concurrent_with_4k_event_proven":False,
        "eligible_independent_recognition_bags_count":0,
        "automatic_people_filing_authorized":False,
        "images_or_video_decoded":0,
        "identity_labels_or_biometric_vectors_read":0,
        "new_scheduled_tasks":0
    }

def synthetic():
    a,b="a"*64,"b"*64
    start=1795135935959
    old="motion_"+str(start-10000)+".mp4"
    new="motion_"+str(start+10000)+".mp4"
    def entry(name,sha):
        return {"version":sha,"bytes":40_000_000,
                "manifest":{"name":name,"sha256":sha,"bytes":40_000_000,
                            "width":3840,"height":2160,
                            "duration_ms":9500}}
    cat={"schema_version":"s9_native_archive_catalog_v1",
         "records":{old:entry(old,a),new:entry(new,b)}}
    now=start/1000+200
    ledger={"schema_version":"s9-original-hash-ledger-v1",
            "checks":{new:{"catalog_version":b,
                            "original_sha256_matches":True,
                            "checked_epoch":now-10}}}
    good=audit(cat,ledger,start,now)
    need(good["post_freeze_new_originals_verified"]==1 and
         good["eligible_independent_recognition_bags_count"]==0,
         "new_source_must_not_imply_identity_qualified")
    unverified=audit(cat,{"schema_version":"s9-original-hash-ledger-v1",
                          "checks":{}},start,now)
    need(unverified["post_freeze_new_originals_verified"]==0 and
         unverified["post_freeze_new_originals_not_yet_verified"]==1,
         "missing_ledger_should_not_verify_new_source")
    duplicate={**cat,"records":{old:entry(old,a),new:entry(new,a)}}
    try:audit(duplicate,ledger,start,now)
    except ValueError as e:need("reuses_historical_sha" in str(e),"wrong_dup_refusal")
    else:raise AssertionError("post_cutoff_reused_source_accepted")
    future="motion_"+str(int((now+3600)*1000))+".mp4"
    invalid={**cat,"records":{old:entry(old,a),future:entry(future,b)}}
    try:audit(invalid,ledger,start,now)
    except ValueError as e:need("future_dated" in str(e),"wrong_future_refusal")
    else:raise AssertionError("future_source_clock_spoof_accepted")
    print(json.dumps({"status":"R770_ANONYMOUS_PROSPECTIVE_SOURCE_GATE_SYNTHETIC_PASS",
                      "cases":4,
                      "independent_identity_bags_fabricated":False,
                      "automatic_people_filing_authorized":False},sort_keys=True))

def run():
    now=time.time()
    cat=sources.load_json(sources.CATALOG,now,sources.MAX_CATALOG_AGE_SEC)
    summ=sources.load_json(sources.SUMMARY,now,sources.MAX_CATALOG_AGE_SEC)
    need(summ.get("catalog_snapshot_id")==cat.get("snapshot_id") and
         summ.get("camera_4k_healthy_before_and_after") is True,
         "archive_catalog_snapshot_not_physically_verified")
    ledger=sources.load_json(sources.LEDGER)
    prior=freeze.verify()
    print(json.dumps(audit(cat,ledger,prior["cutoff_epoch_ms"],now),
                     sort_keys=True,indent=2))

def main():
    p=argparse.ArgumentParser()
    g=p.add_mutually_exclusive_group(required=True)
    g.add_argument("--self-test",action="store_true")
    g.add_argument("--audit",action="store_true")
    v=p.parse_args()
    if v.self_test:synthetic()
    else:run()

if __name__=="__main__":
    main()
