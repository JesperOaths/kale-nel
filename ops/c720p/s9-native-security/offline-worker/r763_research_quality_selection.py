#!/usr/bin/env python3
"""R763: deterministic quality-and-capture-day research crop admission.

Neither this module nor its results map a source/crop to a person or folder.
It does NOT compare identity embeddings, decode photos, or create gallery
vectors. The selected crop SHA lists exist only transiently in memory.
Only an aggregate commitment and counts leave this process.

Historical crop PTS is still unverified. A geometry/date-only research
selection is NOT a recognition-accuracy evaluation or filing authorization.
"""
from __future__ import annotations
import argparse,datetime as dt,hashlib,json
from zoneinfo import ZoneInfo
import r758_capture_day_leakage_audit as r758
import s9_reid_manifest_integrity_v749 as r749

ZONE=ZoneInfo("Europe/Amsterdam")
MIN_HW=1.25
MAX_HW=3.6

def need(good,reason):
    if not good:raise ValueError(reason)

def date_from_name(name):
    need(r758.CLIP.fullmatch(name) is not None,"invalid_original_clip_name")
    return dt.datetime.fromtimestamp(int(name[7:20])/1000,ZONE).date().isoformat()

def select(rows,catalog,ledger,summary,now=None):
    need(type(rows) is list and len(rows)>0,
         "missing_source_qualified_research_manifest")
    sources=r758.validate_catalog(catalog,summary,ledger,rows,now)
    bysha={}
    for name,e in catalog["records"].items():
        sha=e["manifest"].get("sha256")
        if r749.sha_valid(sha):
            need(sha not in bysha,"duplicate_catalog_original_source")
            bysha[sha]=name
    reference=[];holdout=[];bad_ref=[];bad_hold=[]
    role_of_crop={}
    for row in rows:
        need(row["role"] in ("reference","heldout") and
             r749.sha_valid(row["crop_sha256"]) and
             row["source_sha256"] in sources,
             "unqualified_source_or_crop_metadata")
        crop=row["crop_sha256"]
        need(crop not in role_of_crop,"duplicate_crop_or_cross_role_evidence")
        role_of_crop[crop]=row["role"]
        shape=row["bounding_box_h_w_ratio"]
        good=(row.get("strict_upright_crop_quality") is True and
              type(shape) in (int,float) and
              MIN_HW<=shape<=MAX_HW)
        if row["role"]=="reference":
            (reference if good else bad_ref).append(row)
        else:
            (holdout if good else bad_hold).append(row)
    need(reference and holdout,"no_quality_qualified_reference_or_holdout")
    refs_sources={x["source_sha256"] for x in reference}
    refs_days={date_from_name(bysha[s]) for s in refs_sources}
    holdouts=[x for x in holdout if
              date_from_name(bysha[x["source_sha256"]]) not in refs_days and
              x["source_sha256"] not in refs_sources]
    hold_sources={x["source_sha256"] for x in holdouts}
    hold_days={date_from_name(bysha[s]) for s in hold_sources}
    require_ref_sha=sorted(x["crop_sha256"] for x in reference)
    require_hold_sha=sorted(x["crop_sha256"] for x in holdouts)
    def canonical(x):
        return json.dumps(x,sort_keys=True,separators=(",",":")).encode()
    committed=hashlib.sha256(canonical({
        "geometry_ratio_h_w_min":MIN_HW,
        "geometry_ratio_h_w_max":MAX_HW,
        "reference_crop_SHA256":require_ref_sha,
        "holdout_crop_SHA256":require_hold_sha,
        "calendar_basis":"Europe/Amsterdam",
        "historical_crop_pts_verified":False,
    })).hexdigest()
    return {
        "schema":"s9_r763_anonymous_research_quality_selection_v1",
        "status":"RESEARCH_MASK_ONLY_NOT_IDENTITY_EVALUATION",
        "original_research_crop_rows":len(rows),
        "raw_reference_crop_rows":len(reference)+len(bad_ref),
        "quality_eligible_reference_crop_rows":len(reference),
        "rejected_reference_crop_rows":len(bad_ref),
        "quality_eligible_reference_sources":len(refs_sources),
        "quality_eligible_reference_capture_dates":len(refs_days),
        "raw_holdout_crop_rows":len(holdout)+len(bad_hold),
        "quality_eligible_holdout_crop_rows_before_day_filter":len(holdout),
        "rejected_holdout_crop_rows":len(bad_hold),
        "date_disjoint_holdout_crop_rows":len(holdouts),
        "date_disjoint_holdout_original_sources":len(hold_sources),
        "date_disjoint_holdout_capture_dates":len(hold_days),
        "calibration_source_sha_and_day_overlaps":0,
        "eligible_ref_holdout_crop_mask_commitment_sha256":committed,
        "eligible_mask_source_originals_verified_against_current_ledger":True,
        "historical_exact_frame_PTS_proven_for_selected_crops":False,
        "independent_known_person_truth_proven":False,
        "independent_unknown_person_truth_proven":False,
        "candidate_ain_x025_recognition_accuracy_proven":False,
        "real_person_crop_images_decoded":0,
        "biometric_vectors_compared":0,
        "identity_labels_read":0,
        "people_folder_assignments":0,
        "production_automation_authorized":False,
    }

def self_test():
    a,b,c,d="a"*64,"b"*64,"c"*64,"d"*64
    t=dt.datetime(2026,11,18,10,tzinfo=dt.timezone.utc).timestamp()
    n1="motion_"+str(int(t*1000))+".mp4"
    n2="motion_"+str(int((t+3600)*1000))+".mp4"
    n3="motion_"+str(int((t+86400)*1000))+".mp4"
    rows=[]
    def row(role,source,crop,good,ratio):
        return {"role":role,"source_sha256":source,"source_version":source,
                "crop_sha256":crop,"strict_upright_crop_quality":good,
                "bounding_box_h_w_ratio":ratio}
    def entry(name,source):
        return {"version":source,"bytes":40000000,
                "manifest":{"name":name,"sha256":source,"bytes":40000000,
                            "width":3840,"height":2160}}
    records={n1:entry(n1,a),n2:entry(n2,b),n3:entry(n3,c)}
    catalog={"schema_version":"s9_native_archive_catalog_v1","snapshot_id":d,
             "records":records}
    summary={"catalog_snapshot_id":d,
             "camera_4k_healthy_before_and_after":True,
             "video_bytes_transferred_to_hub":False}
    now=t+90000
    ledger={"schema_version":"s9-original-hash-ledger-v1",
            "checks":{n:{"catalog_version":e["version"],
                         "original_sha256_matches":True,
                         "checked_epoch":now-100}
                      for n,e in records.items()}}
    base=[row("reference",a,d,True,1.6),
          row("reference",b,"e"*64,False,0.4),
          row("heldout",b,"f"*64,True,1.8),
          row("heldout",c,"1"*64,True,1.7)]
    receipt=select(base,catalog,ledger,summary,now)
    need(receipt["quality_eligible_reference_crop_rows"]==1 and
         receipt["rejected_reference_crop_rows"]==1 and
         receipt["date_disjoint_holdout_crop_rows"]==1 and
         receipt["date_disjoint_holdout_original_sources"]==1,
         "research_mask_geometry_and_date_filter_incorrect")
    clean_good=[row("reference",a,d,True,1.6),
                row("heldout",c,"1"*64,True,1.7)]
    hash1=select(clean_good,catalog,ledger,summary,now)
    hash2=select(list(reversed(clean_good)),catalog,ledger,summary,now)
    need(hash1["eligible_ref_holdout_crop_mask_commitment_sha256"]==
         hash2["eligible_ref_holdout_crop_mask_commitment_sha256"],
         "selection_commitment_changes_with_manifest_order")
    invalid=[row("reference",a,d,True,1.6),
             row("heldout",c,d,True,1.7)]
    try:select(invalid,catalog,ledger,summary,now)
    except ValueError as e:need("duplicate_crop" in str(e),"wrong_duplicate_refusal")
    else:raise AssertionError("cross_role_same_crop_accepted")
    invalid=[row("reference",a,d,True,1.6),
             row("heldout",c,"1"*64,True,0.2)]
    try:select(invalid,catalog,ledger,summary,now)
    except ValueError as e:need("no_quality_qualified" in str(e),"wrong_geometry_refusal")
    else:raise AssertionError("bad_holdout_crop_accepted")
    need(receipt["production_automation_authorized"] is False,
         "research_mask_cannot_authorize_person_filing")
    print(json.dumps({"status":"R763_ANONYMOUS_SOURCE_QUALITY_DAY_MASK_SELFTEST_PASS",
                      "cases":5,"person_labels_loaded":0,
                      "automatic_filing_enabled":False},sort_keys=True))

def main():
    p=argparse.ArgumentParser()
    g=p.add_mutually_exclusive_group(required=True)
    g.add_argument("--self-test",action="store_true")
    g.add_argument("--audit",action="store_true")
    a=p.parse_args()
    if a.self_test:self_test()
    else:
        now=dt.datetime.now(dt.timezone.utc).timestamp()
        c=r758.load_json(r758.CATALOG,now,r758.MAX_CATALOG_AGE_SEC)
        s=r758.load_json(r758.SUMMARY,now,r758.MAX_CATALOG_AGE_SEC)
        l=r758.load_json(r758.LEDGER)
        rows=r758.phone_rows()
        print(json.dumps(select(rows,c,l,s,now),sort_keys=True,indent=2))

if __name__=="__main__":
    main()
