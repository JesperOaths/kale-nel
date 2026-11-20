#!/usr/bin/env python3
"""R756 two-day, independently catalog-pinned, anonymous original-frame proof.

Nothing here computes identity, person embeddings, face/body matching, or
automatic filing. All original SHA verification, MediaCodec decoded-frame
timestamp extraction, and pixel hashing run on the S9+ using R755.

No new daemon, scheduled task, cron entry, Camera2 patch or footage copy.
Use --self-test for CI. Use --phone-verify-nov17-nov18 only for an explicit
owner-authorized one-shot, fail-closed read-only experiment.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import re
import secrets
import subprocess
import time

PHONE = "192.168.178.250:5555"
BASE = Path("/home/jespern/c720p-home-hub/state")
CATALOG = BASE / "s9-standalone-archive-catalog-v1.json"
SUMMARY = BASE / "s9-standalone-archive-summary-v1.json"
LEDGER = BASE / "s9-original-hash-ledger-v1.json"
DEX = "/data/local/tmp/s9_reid_r740/r755_anonymous_pts.dex.jar"
DEX_SHA = "b18f1df682ab9ce2d3cefad5e3dabe01562a37a5535936a136085694ada87286"
MARK = "S9_ORIGINAL_ANON_PTS_R755 "
NAMES = re.compile(r"motion_[0-9]{13}[.]mp4\Z")
SHA = re.compile(r"[a-f0-9]{64}\Z")
DAYS = ("2026-11-17", "2026-11-18")

def need(ok,reason):
    if not ok:
        raise ValueError(reason)

def digest(value):
    return isinstance(value,str) and SHA.fullmatch(value) is not None

def utcday(name):
    need(isinstance(name,str) and NAMES.fullmatch(name),"invalid_original_name")
    return dt.datetime.fromtimestamp(int(name[7:20])/1000,
                                     dt.timezone.utc).strftime("%Y-%m-%d")

def load_current_sources(catalog,ledger,summary):
    need(isinstance(catalog,dict) and isinstance(ledger,dict) and
         isinstance(summary,dict),"catalog_or_ledger_unavailable")
    need(catalog.get("schema_version")=="s9_native_archive_catalog_v1",
         "invalid_current_catalog_schema")
    need(summary.get("camera_4k_healthy_before_and_after") is True and
         summary.get("catalog_snapshot_id")==catalog.get("snapshot_id"),
         "catalog_summary_not_4k_healthy_and_source_bound")
    records = catalog.get("records")
    checks=ledger.get("checks")
    need(isinstance(records,dict) and isinstance(checks,dict),
         "bad_original_ledger_shape")
    picked={}
    for day in DAYS:
        choices=[]
        for name,x in records.items():
            if not (isinstance(name,str) and NAMES.fullmatch(name)):continue
            if utcday(name)!=day:continue
            prior=checks.get(name,{})
            manifest=x.get("manifest",{})
            if not (prior.get("original_sha256_matches") is True and
                    prior.get("catalog_version")==x.get("version") and
                    x.get("bytes")==manifest.get("bytes") and
                    manifest.get("name")==name and
                    manifest.get("width")==3840 and
                    manifest.get("height")==2160 and
                    type(manifest.get("duration_ms")) is int and
                    6000<=manifest["duration_ms"]<=300000 and
                    type(x.get("bytes")) is int and
                    35_000_000<=x["bytes"]<=110_000_000 and
                    digest(manifest.get("sha256"))):
                continue
            choices.append({
                "name":name,"day":day,"sha":manifest["sha256"],
                "bytes":x["bytes"],"version":x["version"],
                "checked_epoch":prior.get("checked_epoch")
            })
        need(bool(choices),"no_exact_verified_original_for_day_"+day)
        picked[day]=sorted(choices,key=lambda x:(x["bytes"],x["name"]))[0]
    need(picked[DAYS[0]]["sha"] != picked[DAYS[1]]["sha"],
         "two_source_days_same_original_sha")
    return picked

def validate_receipt(receipt,source,offset,nonce):
    need(isinstance(receipt,dict) and
         receipt.get("schema")=="s9_r755_anonymous_original_frame_pts_evidence_v1" and
         receipt.get("status")=="ONE_ORIGINAL_REAL_MEDIA_PHYSICAL_PTS_ROI_HASH_VERIFIED",
         "invalid_actual_original_decoder_receipt")
    need(receipt.get("nonce")==nonce and
         receipt.get("original_basename_sha256")==
             hashlib.sha256(source["name"].encode()).hexdigest(),
         "nonce_or_filename_source_binding_invalid")
    need(receipt.get("original_sha256")==source["sha"] and
         receipt.get("original_size_bytes")==source["bytes"] and
         receipt.get("original_sha_verified_before_after_on_s9") is True,
         "original_sha_source_revision_not_attested")
    pts=receipt.get("physical_output_frame_pts_us")
    need(type(receipt.get("requested_seek_ms")) is int and
         receipt["requested_seek_ms"]==offset and
         type(pts) is int and offset*1000-1000<=pts<=offset*1000+500000,
         "decoder_pts_not_bound_to_requested_window")
    need(receipt.get("physical_pts_from_decoder_bufferinfo") is True,
         "decoded_pts_producer_not_attested")
    need(tuple(receipt.get(k) for k in ("roi_x0","roi_y0","roi_x1","roi_y1"))==
         (1810,950,1938,1206) and
         receipt.get("roi_is_anonymous_center_scene_sample") is True,
         "unsupported_roi_or_identity_crop")
    for key in ("roi_image_file_created","owner_verified_person_crop_pts_attested",
                "person_identity_or_folder_label_read","biometric_similarity_computed",
                "camera_apk_modified","original_media_modified"):
        need(receipt.get(key) is False,key+"_prohibited")
    need(type(receipt.get("automatic_people_folder_assignments")) is int and
         receipt["automatic_people_folder_assignments"]==0,
         "auto_identity_filing_prohibited")
    pixel_sha=receipt.get("roi_pixel_sha256_on_s9")
    need(digest(pixel_sha),"missing_hashed_pixel_data")
    return {"day":source["day"],"offset":offset,
            "pts_us":pts,"pixel_sha":pixel_sha}

def validate_series(rows):
    need(type(rows) is list and len(rows)==4,"four_bounded_real_receipts_required")
    need([x["day"] for x in rows]==[DAYS[0],DAYS[1],DAYS[1],DAYS[1]] and
         [x["offset"] for x in rows]==[2000,2000,2000,4000],
         "source_day_or_offset_order_invalid")
    need(rows[1]["pts_us"]==rows[2]["pts_us"] and
         rows[1]["pixel_sha"]==rows[2]["pixel_sha"],
         "same_source_frame_replay_not_deterministic")
    need(rows[3]["pts_us"]>rows[2]["pts_us"] and
         rows[3]["pixel_sha"]!=rows[2]["pixel_sha"],
         "different_original_frame_not_distinct")
    return {"schema":"s9_r756_two_day_anonymous_physical_pts_proof",
            "result":"TWO_DAYS_ORIGINAL_PTS_AND_CROP_HASH_VERIFIED",
            "days":list(DAYS),"physical_phone_decodes":len(rows),
            "physically_observed_pts_us":[x["pts_us"] for x in rows],
            "source_day_separation_verified":True,
            "duplicate_seek_physical_pts_repeats":True,
            "duplicate_seek_pixel_digest_repeats":True,
            "different_seek_has_distinct_pixel_digest":True,
            "existing_reference_crop_pts_verified":False,
            "person_identity_accuracy_evaluated":False,
            "unknown_person_FAR_evaluated":False,
            "production_automatic_filing_authorized":False,
            "real_images_copied_to_hub":0,
            "person_identity_labels_read":0,
            "new_scheduled_tasks":0}

def synthetic_tests():
    ha="a"*64;hb="b"*64
    data={"name":"motion_1794991337339.mp4","day":DAYS[1],
          "sha":ha,"bytes":40000000}
    def receipt(src,offset=2000,nonce="0"*32,digest_value="a"*64):
        return {"schema":"s9_r755_anonymous_original_frame_pts_evidence_v1",
                "status":"ONE_ORIGINAL_REAL_MEDIA_PHYSICAL_PTS_ROI_HASH_VERIFIED",
                "nonce":nonce,
                "original_basename_sha256":hashlib.sha256(src["name"].encode()).hexdigest(),
                "original_sha256":src["sha"],"original_size_bytes":src["bytes"],
                "original_sha_verified_before_after_on_s9":True,
                "requested_seek_ms":offset,
                "physical_output_frame_pts_us":offset*1000+9033,
                "physical_pts_from_decoder_bufferinfo":True,
                "roi_pixel_sha256_on_s9":digest_value,
                "roi_x0":1810,"roi_y0":950,"roi_x1":1938,"roi_y1":1206,
                "roi_is_anonymous_center_scene_sample":True,
                "roi_image_file_created":False,
                "owner_verified_person_crop_pts_attested":False,
                "person_identity_or_folder_label_read":False,
                "biometric_similarity_computed":False,"camera_apk_modified":False,
                "original_media_modified":False,
                "automatic_people_folder_assignments":0}
    base=receipt(data)
    assert validate_receipt(base,data,2000,"0"*32)["pts_us"]==2009033
    fail_cases=(
        ("nonce","1"*32,"nonce_or_filename_source_binding_invalid"),
        ("original_sha256",hb,"original_sha_source_revision_not_attested"),
        ("original_size_bytes",23,"original_sha_source_revision_not_attested"),
        ("requested_seek_ms",4000,"decoder_pts_not_bound_to_requested_window"),
        ("physical_output_frame_pts_us",1200000,"decoder_pts_not_bound_to_requested_window"),
        ("physical_pts_from_decoder_bufferinfo",False,"decoded_pts_producer_not_attested"),
        ("owner_verified_person_crop_pts_attested",True,"owner_verified_person_crop_pts_attested_prohibited"),
        ("person_identity_or_folder_label_read",True,"person_identity_or_folder_label_read_prohibited"),
        ("biometric_similarity_computed",True,"biometric_similarity_computed_prohibited"),
        ("original_media_modified",True,"original_media_modified_prohibited"),
        ("roi_x0",17,"unsupported_roi_or_identity_crop"),
        ("roi_image_file_created",True,"roi_image_file_created_prohibited"),
        ("automatic_people_folder_assignments",1,"auto_identity_filing_prohibited"),
        ("roi_pixel_sha256_on_s9","none","missing_hashed_pixel_data"),
    )
    count=0
    for k,v,reason in fail_cases:
        broken=dict(base,**{k:v})
        try:
            validate_receipt(broken,data,2000,"0"*32)
            raise AssertionError("bad_attestation_accepted_"+k)
        except ValueError as ex:
            assert reason in str(ex),(k,str(ex))
        count+=1
    src17=dict(data,day=DAYS[0],sha=hb)
    good=[{"day":DAYS[0],"offset":2000,"pts_us":2009000,"pixel_sha":ha},
          {"day":DAYS[1],"offset":2000,"pts_us":2009033,"pixel_sha":hb},
          {"day":DAYS[1],"offset":2000,"pts_us":2009033,"pixel_sha":hb},
          {"day":DAYS[1],"offset":4000,"pts_us":4030000,"pixel_sha":"c"*64}]
    assert validate_series(good)["result"]=="TWO_DAYS_ORIGINAL_PTS_AND_CROP_HASH_VERIFIED"
    for index,mutated,expected in (
        (2,{"pixel_sha":ha},"same_source_frame_replay_not_deterministic"),
        (3,{"pts_us":2000000},"different_original_frame_not_distinct"),
        (3,{"pixel_sha":hb},"different_original_frame_not_distinct")
    ):
        failed=[dict(x) for x in good];failed[index].update(mutated)
        try:validate_series(failed);raise AssertionError("bad_series_accepted")
        except ValueError as ex:assert expected in str(ex)
        count+=1
    print(json.dumps({"status":"R756_SYNTHETIC_TWO_DAY_ORIGINAL_PTS_CONTRACT_PASS",
                      "synthetic_faults_rejected":count,
                      "real_person_images_processed":False,
                      "identity_folder_assignment_authorized":False}))

def phone_verify():
    import s9_reid_capture_admission_v742 as admission
    now=time.time()
    for path in (CATALOG,SUMMARY,LEDGER):
        need(path.is_file() and not path.is_symlink() and
             path.stat().st_size < 10_000_000,"source_catalog_or_ledger_unavailable")
    need(all(-120<=now-p.stat().st_mtime<=1200 for p in (CATALOG,SUMMARY)),
         "source_catalog_not_recently_verified")
    catalog=json.loads(CATALOG.read_text())
    summary=json.loads(SUMMARY.read_text())
    ledger=json.loads(LEDGER.read_text())
    sources=load_current_sources(catalog,ledger,summary)
    binary=subprocess.run(["adb","-s",PHONE,"shell","sha256sum",DEX],
                          capture_output=True,text=True,timeout=10,check=True)
    need(binary.stdout.strip().split()[0]==DEX_SHA,
         "research_phone_decoder_not_pinned")
    checks=((DAYS[0],2000),(DAYS[1],2000),(DAYS[1],2000),(DAYS[1],4000))
    rows=[]
    camera_results=[]
    for day,offset in checks:
        src=sources[day]
        before=admission.camera_status();pb=admission.phone_status()
        need(not admission.inspect_camera(before) and
             not admission.inspect_phone(pb),"camera_not_admitted")
        nonce=secrets.token_hex(16)
        cmd=(f"CLASSPATH={DEX} nice -n 15 /system/bin/app_process "
             " /system/bin nl.kalenel.s9offline.S9OriginalAnonymousPtsV755 "
             f"--one-verified-original {src['name']} {src['sha']} "
             f"{src['bytes']} {offset} {nonce}")
        proc=subprocess.run(["adb","-s",PHONE,"shell",cmd],
                            capture_output=True,text=True,timeout=29,check=True)
        pieces=[x[len(MARK):] for x in proc.stdout.splitlines()
                if x.startswith(MARK)]
        need(len(pieces)==1,"phone_original_pts_receipt_missing")
        receipt=json.loads(pieces[0])
        row=validate_receipt(receipt,src,offset,nonce)
        after=admission.camera_status();pa=admission.phone_status()
        need(not admission.inspect_camera(after) and
             not admission.inspect_phone(pa) and
             pb["recorder_pid"]==pa["recorder_pid"],
             "camera_after_decoder_unhealthy")
        need(after["sensor_capture_result_frames"]>before["sensor_capture_result_frames"] and
             after["preroll_encoded_frames"]>before["preroll_encoded_frames"] and
             after["preroll_dropped_frames"]==before["preroll_dropped_frames"],
             "camera_capture_continuity_compromised")
        rows.append(row)
        camera_results.append({"day":day,"sensor_frames":
            after["sensor_capture_result_frames"]-before["sensor_capture_result_frames"],
            "preroll_encoded_frames":
            after["preroll_encoded_frames"]-before["preroll_encoded_frames"],
            "new_preroll_drops":0,"sensor_fps":after["sensor_result_fps"],
            "camera_pid_unchanged":True})
    result=validate_series(rows)
    result["catalog_source_count"]=len(catalog["records"])
    result["source_ledger_versions_and_sha_verified"]=True
    result["camera_continuity_samples"]=camera_results
    print(json.dumps(result,sort_keys=True,indent=2))

if __name__=="__main__":
    p=argparse.ArgumentParser()
    act=p.add_mutually_exclusive_group(required=True)
    act.add_argument("--self-test",action="store_true")
    act.add_argument("--phone-verify-nov17-nov18",action="store_true")
    args=p.parse_args()
    if args.self_test:synthetic_tests()
    else:phone_verify()
