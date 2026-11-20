#!/usr/bin/env python3
"""R743 conservative open-set evidence contract: independent summary statistics only.

Standalone synthetic-testable function. This cannot authorize or modify People
folders, camera, model registry, cron, identities or production deployment.
It deliberately NEVER opens the owner's video/embeddings/labels. Evaluators
must produce independently audited source-bag summary counts and attestations.

Unknown FAR: for exactly 0 false accepts, exact one-sided upper confidence
bound = 1 - alpha**(1/N).  For nonzero false accepts, refuse review entirely.
Known recognition: Wilson 95% lower bound on correctly accepted identity
among all known original recording bags, including abstentions.
"""
from __future__ import annotations
import argparse
import json
import math
import statistics

# The optional continuous encoder is NOT mandatory. The normal camera
# legitimately uses native 3840x2160 MediaRecorder + AVC preroll.
# A sensor FPS counter or a preroll ring is NOT evidence that an event MP4
# was completed at 4K/30FPS while the model ran. Require independently
# verified finished event-file dimensions, output timestamps and continuity.
REQUIRED_TRUTHS = (
    "model_weights_provenance_verified",
    "model_runtime_verified_on_s9",
    "input_crop_geometry_and_preprocessing_verified",
    "exact_source_SHA256_current",
    "exact_crop_SHA256_current",
    "source_frame_PTS_independently_verified",
    "only_human_approved_reference_labels",
    "no_unverified_self_training",
    "heldout_original_sources_disjoint",
    "heldout_capture_days_disjoint",
    "heldout_outfit_episodes_disjoint",
    "heldout_known_and_unknown_labels_independent",
    "recordings_counted_as_bags_not_frames",
    "heldout_thresholds_predeclared",
    "camera_capture_30fps_under_model_load_verified",
    "native_4k_event_file_30fps_verified_under_model_load",
)
MIN_KNOWN_RECORDINGS = 100
MIN_KNOWN_PEOPLE = 8
MIN_UNKNOWN_RECORDINGS = 600
MIN_KNOWN_ACCURACY_LOWER_95 = .90
MAX_UNKNOWN_FAR_UPPER_95 = .005

def integer(x):
    return type(x) is int and x >= 0

def wilson_lower(success,total,z=1.959963984540054):
    if total <= 0:return 0.0
    p=success/total
    den=1+z*z/total
    num=p+z*z/(2*total)-z*math.sqrt(p*(1-p)/total+z*z/(4*total*total))
    return max(0,num/den)

def evaluate(e):
    reasons=[]
    if not isinstance(e,dict) or e.get("schema")!="s9_reid_independent_evaluation_summary_v1":
        return {"status":"REFUSE_AUTOMATION","reasons":["unsupported_or_missing_independent_summary"],
                "automation_authorized":False}
    for key in REQUIRED_TRUTHS:
        if e.get(key) is not True:
            reasons.append(key+"_not_independently_proven")
    for key in ("known_original_bags","known_correct_accepts","known_wrong_accepts",
                "unknown_original_bags","unknown_false_accepts","known_distinct_people"):
        if not integer(e.get(key)):
            reasons.append(key+"_missing_or_invalid")
    if any("missing_or_invalid" in x for x in reasons):
        return {"status":"REFUSE_AUTOMATION","reasons":sorted(reasons),
                "automation_authorized":False}
    k=e["known_original_bags"]; right=e["known_correct_accepts"]
    wrong=e["known_wrong_accepts"]; n=e["unknown_original_bags"]
    err=e["unknown_false_accepts"]
    if k<MIN_KNOWN_RECORDINGS:
        reasons.append("insufficient_known_source_bags")
    if right+wrong>k or err>n:
        reasons.append("impossible_classification_counts")
        return {"schema":"s9_reid_release_evidence_guard_v743",
                "status":"REFUSE_AUTOMATION",
                "reasons":sorted(set(reasons)),
                "automation_authorized":False,
                "model_activation_performed":False,
                "folder_assignment_performed":False}
    if e["known_distinct_people"]<MIN_KNOWN_PEOPLE:
        reasons.append("insufficient_distinct_known_people")
    if n<MIN_UNKNOWN_RECORDINGS:reasons.append("insufficient_independent_unknown_source_bags")
    if wrong!=0:reasons.append("wrong_known_person_auto_accepts_observed")
    if err!=0:reasons.append("unfamiliar_person_false_accepts_observed")
    known_lower=wilson_lower(right,k)
    if known_lower<MIN_KNOWN_ACCURACY_LOWER_95:
        reasons.append("known_accuracy_lower_bound_below_target")
    unknown_upper=1.0-.05**(1/n) if n and err==0 else 1.0
    if unknown_upper>MAX_UNKNOWN_FAR_UPPER_95:
        reasons.append("unknown_false_accept_upper_bound_above_target")
    return {
        "schema":"s9_reid_release_evidence_guard_v743",
        "status":"CANDIDATE_FOR_INDEPENDENT_REVIEW_ONLY" if not reasons else "REFUSE_AUTOMATION",
        "reasons":sorted(set(reasons)),
        "known_original_recording_bags":k,
        "unknown_original_recording_bags":n,
        "known_correct_lower_95":round(known_lower,6),
        "unknown_false_accept_upper_95":round(unknown_upper,6),
        "unknown_false_accept_target":MAX_UNKNOWN_FAR_UPPER_95,
        # Never allow this untrusted numeric report to flip the real release.
        "automation_authorized":False,
        "model_activation_performed":False,
        "folder_assignment_performed":False
    }

def synthetic_tests():
    example={"schema":"s9_reid_independent_evaluation_summary_v1",
             **{k:True for k in REQUIRED_TRUTHS},
             "known_original_bags":500,"known_correct_accepts":495,
             "known_wrong_accepts":0,"known_distinct_people":10,
             "unknown_original_bags":1000,"unknown_false_accepts":0}
    assert evaluate(example)["status"]=="CANDIDATE_FOR_INDEPENDENT_REVIEW_ONLY"
    assert evaluate(example)["automation_authorized"] is False
    tests=0
    for k,v,code in (
        ("source_frame_PTS_independently_verified",False,"source_frame_PTS_independently_verified_not_independently_proven"),
        ("heldout_capture_days_disjoint",False,"heldout_capture_days_disjoint_not_independently_proven"),
        ("heldout_original_sources_disjoint",False,"heldout_original_sources_disjoint_not_independently_proven"),
        ("heldout_outfit_episodes_disjoint",False,"heldout_outfit_episodes_disjoint_not_independently_proven"),
        ("only_human_approved_reference_labels",False,"only_human_approved_reference_labels_not_independently_proven"),
        ("camera_capture_30fps_under_model_load_verified",False,"camera_capture_30fps_under_model_load_verified_not_independently_proven"),
        ("native_4k_event_file_30fps_verified_under_model_load",False,"native_4k_event_file_30fps_verified_under_model_load_not_independently_proven"),
        ("known_distinct_people",3,"insufficient_distinct_known_people"),
        ("known_original_bags",30,"insufficient_known_source_bags"),
        ("known_wrong_accepts",1,"wrong_known_person_auto_accepts_observed"),
        ("unknown_original_bags",52,"insufficient_independent_unknown_source_bags"),
        ("unknown_original_bags",100,"unknown_false_accept_upper_bound_above_target"),
        ("unknown_false_accepts",1,"unfamiliar_person_false_accepts_observed"),
        ("known_correct_accepts",260,"known_accuracy_lower_bound_below_target"),
    ):
        test=dict(example,**{k:v})
        result=evaluate(test)
        assert result["status"]=="REFUSE_AUTOMATION" and code in result["reasons"],(k,result)
        assert result["automation_authorized"] is False
        tests+=1
    assert evaluate({})["status"]=="REFUSE_AUTOMATION"
    assert evaluate(dict(example,unknown_false_accepts=True))["status"]=="REFUSE_AUTOMATION"
    print(json.dumps({"status":"R743_SYNTHETIC_RELEASE_GATE_TEST_PASS",
                      "synthetic_refusals_checked":tests+2,
                      "example_unknown_count":1000,
                      "example_unknown_upper_95":evaluate(example)["unknown_false_accept_upper_95"],
                      "real_person_scores_processed":False,
                      "actual_release_authorized":False},sort_keys=True))

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--self-test",action="store_true",required=True)
    parser.parse_args()
    synthetic_tests()

if __name__=="__main__":
    main()
