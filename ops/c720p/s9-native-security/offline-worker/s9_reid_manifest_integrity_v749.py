#!/usr/bin/env python3
"""R749: anonymous S9+ Re-ID research-manifest provenance gate.

This lightweight host-side orchestration only reads existing JSON metadata
from S9+. It performs NO image/video/embedding computation, no person
classification, no identity/folder mapping, and no phone or media writes.
It intentionally discards the 512-float embedding field immediately after
JSON parsing, and never outputs hashes, crop names, or track identifiers.
Run --self-test in CI; run --audit only against owner-authorized S9 via ADB.
"""
from __future__ import annotations

import argparse
import collections
import json
import math
import re
import statistics
import subprocess

PHONE = "192.168.178.250:5555"
ROOT = "/data/local/tmp/s9-osnet-qualcomm-reid-shadow"
MODEL_SHA = "5249d33bb1cd53e53c9096db9d6acf555b698a7f4561a2b3eb81df4fcbfaac5c"
HASH = re.compile(r"[0-9a-f]{64}\Z")

def require(value, reason):
    if not value:
        raise ValueError(reason)

def sha_valid(value):
    return type(value) is str and HASH.fullmatch(value) is not None

def phone_listing(folder):
    p = subprocess.run(["adb", "-s", PHONE, "shell", "ls", "-1", folder],
                       capture_output=True, text=True, check=True, timeout=10)
    return sorted(x.strip() for x in p.stdout.splitlines() if x.strip())

def phone_json(filename):
    require(filename.startswith(ROOT + "/") and ".." not in filename.split("/"),
            "invalid_read_path")
    p = subprocess.run(["adb", "-s", PHONE, "shell", "cat", filename],
                       capture_output=True, check=True, timeout=12)
    require(len(p.stdout) < 2 * 1024 * 1024, "metadata_file_too_large")
    return json.loads(p.stdout)

def extract_batch(x):
    require(type(x) is dict and x.get("schema") ==
            "S9_REAL_OSNET_SOURCE_SHA_ATTESTED_BATCH_V1",
            "unrecognized_batch_schema")
    require(sha_valid(x.get("plan_SHA256")), "plan_hash_bad")
    require(type(x.get("range_start")) is int and
            type(x.get("range_end")) is int and
            0 <= x["range_start"] < x["range_end"],
            "invalid_batch_range")
    require(type(x.get("crops")) is list and
            len(x["crops"]) == x["range_end"] - x["range_start"],
            "incorrect_batch_range_count")
    require(x.get("unknown_person_training_labels_present") is False,
            "unexpected_unknown_training_labels")
    safe = []
    for crop in x["crops"]:
        require(type(crop) is dict, "invalid_crop_metadata")
        require(crop.get("role") in ("reference", "heldout"),
                "unsupported_research_role")
        for key in ("source_sha256", "source_version", "crop_sha256"):
            require(sha_valid(crop.get(key)), key + "_invalid")
        require(type(crop.get("crop_name")) is str and
                0 < len(crop["crop_name"]) < 256,
                "missing_crop_name")
        require(type(crop.get("strict_upright_crop_quality")) is bool,
                "missing_crop_quality")
        require(type(crop.get("crop_bytes")) is int and
                0 < crop["crop_bytes"] < 15_000_000,
                "invalid_crop_size")
        ratio = crop.get("bounding_box_h_w_ratio")
        require(type(ratio) in (int, float) and math.isfinite(ratio) and
                0.1 < ratio < 12, "invalid_crop_aspect_ratio")
        safe.append({k: crop[k] for k in
                     ("role", "source_sha256", "source_version", "crop_sha256",
                      "crop_name", "crop_bytes", "strict_upright_crop_quality",
                      "bounding_box_h_w_ratio")})
        # track_id is intentionally NOT retained or returned.
    return x["plan_SHA256"], x["range_start"], x["range_end"], safe

def extract_sidecar(x):
    require(type(x) is dict and x.get("schema") ==
            "S9_REAL_OSNET_MARKET1501_SHA_EXACT_PERSON_CROP_RESEARCH_ONLY_V1",
            "unexpected_vector_sidecar_schema")
    require(x.get("model_sha256") == MODEL_SHA, "model_provenance_mismatch")
    require(x.get("model_output_dimensions") == 512 and
            type(x.get("model_output_dimensions")) is int, "output_dimension_invalid")
    require(x.get("no_manual_label_used_during_embedding") is True,
            "metadata_indicates_labels_used_in_embedding")
    require(x.get("automatic_identity_folder_assignments") == 0 and
            type(x.get("automatic_identity_folder_assignments")) is int,
            "identity_auto_assignment_not_zero")
    require(type(x.get("original_source_frame_PTS_independently_verified")) is bool,
            "PTS_attestation_not_boolean")
    for k in ("source_original_sha256", "source_crop_sha256", "source_version"):
        require(sha_valid(x.get(k)), "vector_" + k + "_invalid")
    require(type(x.get("crop_name")) is str and x["crop_name"],
            "sidecar_crop_name_missing")
    require(type(x.get("source_crop_bytes")) is int and
            0 < x["source_crop_bytes"] < 15_000_000,
            "sidecar_source_bytes_invalid")
    timing = x.get("embedding_inference_latency_ms")
    require(type(timing) in (float, int) and math.isfinite(timing) and
            0 < timing < 120_000, "sidecar_latency_invalid")
    # Deliberately do not read/use/return x["L2_normalized_embedding_phone_private"].
    return {k: x[k] for k in
            ("source_original_sha256", "source_crop_sha256", "source_version",
             "crop_name", "source_crop_bytes",
             "original_source_frame_PTS_independently_verified",
             "embedding_inference_latency_ms")}

def report(batches, sidecars):
    plans = set()
    indexed = {}
    ranges = []
    rows = []
    for b in batches:
        plan, start, end, payload = extract_batch(b)
        plans.add(plan)
        ranges.append((start, end))
        rows.extend(payload)
    require(len(plans) == 1 and len(rows) > 0,
            "inconsistent_or_empty_batch_plans")
    require(sorted(ranges)[0][0] == 0, "batch_ranges_do_not_start_at_zero")
    cursor = 0
    for start, end in sorted(ranges):
        require(start == cursor, "batch_ranges_overlap_or_have_gaps")
        cursor = end
    require(cursor == len(rows), "batch_count_total_mismatch")
    for original in sidecars:
        v = extract_sidecar(original)
        key = v["source_crop_sha256"]
        require(key not in indexed, "duplicate_vector_sidecar_crop")
        indexed[key] = v
    distinct_crops = {x["crop_sha256"] for x in rows}
    require(len(distinct_crops) == len(indexed), "crop_sidecar_count_mismatch")
    require(distinct_crops == set(indexed), "missing_or_unplanned_vector_sidecars")
    refs = [x for x in rows if x["role"] == "reference"]
    holdouts = [x for x in rows if x["role"] == "heldout"]
    sources = {kind:{x["source_sha256"] for x in rows if x["role"] == kind}
               for kind in ("reference", "heldout")}
    require(not sources["reference"] & sources["heldout"],
            "REFERENCE_HELDOUT_SOURCE_SHA_LEAKAGE")
    quality_bad = collections.Counter()
    pts_bad = collections.Counter()
    join_errors = []
    latency = []
    eligible_reference_crops = set()
    for x in rows:
        sidecar = indexed[x["crop_sha256"]]
        fields = (("source_sha256", "source_original_sha256"),
                  ("crop_name", "crop_name"),
                  ("source_version", "source_version"),
                  ("crop_bytes", "source_crop_bytes"))
        if any(x[a] != sidecar[b] for a, b in fields):
            join_errors.append("crop_source_byte_or_name_mismatch")
        if not x["strict_upright_crop_quality"]:
            quality_bad[x["role"]] += 1
        if not sidecar["original_source_frame_PTS_independently_verified"]:
            pts_bad[x["role"]] += 1
        if x["role"] == "reference" and x["strict_upright_crop_quality"] and (
            sidecar["original_source_frame_PTS_independently_verified"]
        ):
            eligible_reference_crops.add(x["crop_sha256"])
        latency.append(sidecar["embedding_inference_latency_ms"])
    require(not join_errors, "source_exact_metadata_join_mismatch")
    # Strict source SHA disjointness does NOT establish independent outfits,
    # source PTS, capture days, identity labels or prospective FAR.
    return {
        "schema": "s9_r749_anonymous_reid_provenance_gate_v1",
        "result": "RESEARCH_ONLY_NOT_PRODUCTION_PROVEN",
        "batch_count": len(batches),
        "plan_hash_consistent": True,
        "plan_rows": len(rows),
        "distinct_plan_crops": len(distinct_crops),
        "distinct_vector_sidecars": len(indexed),
        "repeat_plan_crop_rows": len(rows) - len(distinct_crops),
        "reference_rows": len(refs),
        "heldout_rows": len(holdouts),
        "reference_distinct_sources": len(sources["reference"]),
        "heldout_distinct_sources": len(sources["heldout"]),
        "reference_heldout_original_source_sha_overlap": 0,
        "reference_rows_failing_strict_quality": quality_bad["reference"],
        "heldout_rows_failing_strict_quality": quality_bad["heldout"],
        "reference_rows_without_independent_frame_pts": pts_bad["reference"],
        "heldout_rows_without_independent_frame_pts": pts_bad["heldout"],
        "reference_crops_eligible_with_quality_and_pts": len(eligible_reference_crops),
        "median_existing_phone_inference_ms": round(statistics.median(latency), 2),
        "model_sha_consistent": True,
        "model_accuracy_evaluated": False,
        "independent_known_unknown_labels_validated": False,
        "independent_capture_day_or_outfit_disjointness_verified": False,
        "production_auto_filing_authorized": False,
        "images_read": 0,
        "videos_decoded": 0,
        "embeddings_compared": 0,
        "folder_assignments_performed": 0,
    }

def audit():
    names = phone_listing(ROOT)
    batches = [phone_json(ROOT + "/" + n) for n in names
               if n.startswith("batch-") and n.endswith(".json")]
    vector_files = [n for n in phone_listing(ROOT + "/vectors")
                    if n.endswith(".json")]
    require(0 < len(batches) <= 200 and 0 < len(vector_files) <= 1000,
            "unexpected_number_of_research_manifests")
    sidecars = [phone_json(ROOT + "/vectors/" + n) for n in vector_files]
    print(json.dumps(report(batches, sidecars), sort_keys=True, indent=2))

def self_test():
    hash_a="a"*64;hash_b="b"*64;hash_c="c"*64;hash_d="d"*64;hash_e="e"*64
    def crop(role,source,crop_hash,quality=True):
        return {"role":role,"source_sha256":source,"source_version":hash_e,
                "crop_sha256":crop_hash,"crop_name":"generic_synthetic.jpg",
                "crop_bytes":4000,"strict_upright_crop_quality":quality,
                "bounding_box_h_w_ratio":1.7}
    b={"schema":"S9_REAL_OSNET_SOURCE_SHA_ATTESTED_BATCH_V1",
       "plan_SHA256":hash_e,"range_start":0,"range_end":3,
       "unknown_person_training_labels_present":False,
       "crops":[crop("reference",hash_a,hash_c),
                crop("reference",hash_a,hash_c),
                crop("heldout",hash_b,hash_d)]}
    def side(c,pts=False):
        return {"schema":"S9_REAL_OSNET_MARKET1501_SHA_EXACT_PERSON_CROP_RESEARCH_ONLY_V1",
                "model_sha256":MODEL_SHA,"source_original_sha256":c["source_sha256"],
                "source_crop_sha256":c["crop_sha256"],
                "source_version":c["source_version"],
                "crop_name":c["crop_name"],"source_crop_bytes":c["crop_bytes"],
                "original_source_frame_PTS_independently_verified":pts,
                "no_manual_label_used_during_embedding":True,
                "automatic_identity_folder_assignments":0,
                "model_output_dimensions":512,
                "embedding_inference_latency_ms":92.5}
    sides=[side(b["crops"][0]),side(b["crops"][2])]
    good=report([b],sides)
    assert good["plan_rows"]==3 and good["repeat_plan_crop_rows"]==1
    assert good["reference_crops_eligible_with_quality_and_pts"]==0
    assert not good["production_auto_filing_authorized"]
    corrupt=dict(b, crops=[*b["crops"][:-1],crop("heldout",hash_a,hash_d)])
    try:report([corrupt],sides);raise AssertionError("source_overlap_should_refuse")
    except ValueError as e:assert "SOURCE_SHA_LEAKAGE" in str(e)
    invalid=dict(sides[0],model_sha256=hash_e)
    try:report([b],[invalid,sides[1]]);raise AssertionError("model_mismatch_should_refuse")
    except ValueError as e:assert "model_provenance_mismatch" in str(e)
    print(json.dumps({"status":"R749_METADATA_ONLY_SYNTHETIC_TEST_PASS",
                      "cases":3,"identities_read":0,"images_read":0,
                      "embeddings_compared":0,"auto_filing_enabled":False}))

if __name__=="__main__":
    p=argparse.ArgumentParser()
    actions=p.add_mutually_exclusive_group(required=True)
    actions.add_argument("--audit",action="store_true")
    actions.add_argument("--self-test",action="store_true")
    args=p.parse_args()
    if args.self_test:self_test()
    else:audit()
