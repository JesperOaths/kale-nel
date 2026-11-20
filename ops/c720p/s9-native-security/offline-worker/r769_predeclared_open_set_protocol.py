#!/usr/bin/env python3
"""R769 immutable *method* predeclaration for future independent ReID tests.

No actual person labels, faces, body images, embeddings or identity/gallery
records are opened. A purely SYNTHETIC conformal quantile test demonstrates
how a future *independently supplied* unknown-person calibration score may
select a threshold without looking at a prospective test set.

This cannot attest exchangeability, independence or person truth, cannot
set a real threshold without genuine calibration and ALWAYS forbids
production People-folder filing. Source/date/outfit independence has to be
separately validated before any future numeric metric is admissible.
"""
from __future__ import annotations
import argparse,datetime as dt,hashlib,json,math,os,statistics,time
from pathlib import Path

import r760_freeze_blind_capture_cohort as r760
import s9_reid_open_set_release_gate_v743 as release

PROTOCOL_SCHEMA="s9_r769_locked_independent_open_set_reid_trial_method_v1"
CANDIDATE_SHA="e7adf72649332d97c613be93db17a047e526bf55fc8b7240f14a1da67390b7af"
ALPHA=.005
MIN_CALIBRATION_UNKNOWN=199
DEST=Path("/home/jespern/c720p-home-hub/staging/recognition-r744-ain-small-model-assets-20261120/r769_statistical_protocol_freeze.json")

def need(ok,reason):
    if not ok:raise ValueError(reason)

def canonical(value):
    return (json.dumps(value,sort_keys=True,separators=(",",":"),allow_nan=False)+"\n").encode()

def calibrate_synthetic_unknown_max_scores(scores):
    """Conservative order-statistic threshold; strictly GREATER is accepted.

    Unseen exchangeable UNKNOWN observations exceed this finite-sample
    threshold with probability at most floor(alpha*(n+1))/(n+1) when the
    quantile index exists. This conditional guarantee DOES NOT follow
    when clips are correlated, identities are not independently verified,
    or calibration data are reused as the final holdout.
    """
    need(type(scores) is list and len(scores)>=MIN_CALIBRATION_UNKNOWN and
         len(scores)<=200_000 and
         all(type(x) in (float,int) and math.isfinite(x) and -1<=x<=1
             for x in scores),
         "unknown_calibration_missing_underpowered_or_nonnumeric")
    ordered=sorted(float(x) for x in scores)
    n=len(ordered)
    # 1-based conformal upper quantile. When k>n refuse rather than
    # invent a threshold from unavailable data.
    k=math.ceil((n+1)*(1-ALPHA))
    need(k<=n,"cannot_calibrate_a_finite_sample_alpha_quantile")
    cutoff=ordered[k-1]
    return {
        "n":n,
        "threshold":cutoff,
        "accept_rule":"test_best_score_strictly_greater_than_threshold",
        "nominal_false_accept_bound_under_exchangeability":
            math.floor(ALPHA*(n+1))/(n+1),
        "threshold_computed_on_final_test_set":False,
        "production_automatic_filing_authorized":False
    }

def proposal(cutoff):
    need(type(cutoff) is int and cutoff>0,"no_prospective_cutoff")
    return {
        "schema":PROTOCOL_SCHEMA,
        "status":"METHOD_PREDECLARED_NOT_CALIBRATED",
        "candidate_model_sha256":CANDIDATE_SHA,
        "locked_original_archive_cutoff_epoch_ms":cutoff,
        "target_unknown_per_bag_far_alpha":ALPHA,
        "minimum_independent_unknown_calibration_bags":MIN_CALIBRATION_UNKNOWN,
        "calibration_rule":"ceil((n+1)*(1-alpha))_th_sorted_unknown_best_match_score",
        "future_unknown_decision":"accept_only_if_best_match_score_strictly_greater_than_calibrated_threshold",
        "model_output":"512D_OSNet_AIN_x025_NCHW",
        "scoring_metric":"cosine_top1_normalized_feature_pair",
        "score_eligible_person_sources":"strict_single_person_verified_anchor_only",
        "no_unverified_self_training":True,
        "source_and_capture_day_exclusive_between_training_calibration_and_final_holdout":True,
        "independently_verified_outfit_episodes_required":True,
        "future_test_bag_definition":"one_independent_original_capture_episode_not_video_frame",
        "future_trial_requires_exact_original_sha_and_physical_decoder_crop_pts":True,
        "future_trial_requires_true_unknown_person_labels":True,
        "future_trial_data_must_be_newly_captured_after_cutoff":True,
        "final_test_threshold_adjustments_allowed":False,
        "target_independent_final_unknown_bags":release.MIN_UNKNOWN_RECORDINGS,
        "target_independent_final_known_bags":release.MIN_KNOWN_RECORDINGS,
        "target_distinct_known_people":release.MIN_KNOWN_PEOPLE,
        "target_known_accuracy_wilson_lower_95":release.MIN_KNOWN_ACCURACY_LOWER_95,
        "target_unknown_false_accept_upper_95":release.MAX_UNKNOWN_FAR_UPPER_95,
        "require_zero_wrong_known_accepts":True,
        "require_zero_unknown_false_accepts":True,
        "model_capture_load_must_pass_live_4k_event":True,
        "candidate_threshold_numerically_calibrated":False,
        "independent_calibration_unknown_labels_available":False,
        "independent_final_known_unknown_labels_available":False,
        "current_data_eligible_for_release":False,
        "identities_labels_and_embeddings_read":0,
        "automatic_people_folder_filing_authorized":False,
        "new_scheduled_tasks_created":0
    }

def validate(q):
    need(type(q) is dict and q.get("schema")==PROTOCOL_SCHEMA and
         q.get("status")=="METHOD_PREDECLARED_NOT_CALIBRATED" and
         q.get("candidate_model_sha256")==CANDIDATE_SHA and
         q.get("target_unknown_per_bag_far_alpha")==ALPHA and
         q.get("minimum_independent_unknown_calibration_bags")==MIN_CALIBRATION_UNKNOWN and
         q.get("final_test_threshold_adjustments_allowed") is False and
         q.get("future_trial_data_must_be_newly_captured_after_cutoff") is True and
         q.get("require_zero_unknown_false_accepts") is True and
         q.get("require_zero_wrong_known_accepts") is True and
         q.get("candidate_threshold_numerically_calibrated") is False and
         q.get("independent_calibration_unknown_labels_available") is False and
         q.get("automatic_people_folder_filing_authorized") is False and
         q.get("identities_labels_and_embeddings_read")==0,
         "unknown_or_untrusted_trial_predeclaration")
    frozen=r760.verify()
    need(q["locked_original_archive_cutoff_epoch_ms"]==frozen["cutoff_epoch_ms"],
         "predeclaration_not_bound_to_research_freeze")
    need(q["target_independent_final_unknown_bags"]==
         release.MIN_UNKNOWN_RECORDINGS and
         q["target_independent_final_known_bags"]==
         release.MIN_KNOWN_RECORDINGS and
         q["target_unknown_false_accept_upper_95"]==
         release.MAX_UNKNOWN_FAR_UPPER_95,
         "release_gate_targets_disagree")
    return q

def freeze():
    need(DEST.parent.is_dir() and not DEST.parent.is_symlink() and
         not DEST.exists() and not DEST.is_symlink(),
         "research_protocol_already_frozen_no_mutation")
    cohort=r760.verify()
    q=proposal(cohort["cutoff_epoch_ms"])
    raw=canonical(q)
    need(len(raw)<12000,"protocol_excessive_size")
    fd=os.open(DEST,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,"wb") as f:
        f.write(raw);f.flush();os.fsync(f.fileno())
    validate(q)
    return {"schema":PROTOCOL_SCHEMA,
        "status":q["status"],
        "private_method_commitment_sha256":hashlib.sha256(raw).hexdigest(),
        "source_freeze_epoch_ms":q["locked_original_archive_cutoff_epoch_ms"],
        "future_unknown_calibration_bags_minimum":MIN_CALIBRATION_UNKNOWN,
        "future_final_unknown_bags_minimum":release.MIN_UNKNOWN_RECORDINGS,
        "real_person_threshold_already_calibrated":False,
        "automatic_people_filing_authorized":False}

def verify():
    need(DEST.is_file() and not DEST.is_symlink() and
         100<DEST.stat().st_size<12000,"protocol_file_missing_or_untrusted")
    raw=DEST.read_bytes()
    q=json.loads(raw)
    validate(q)
    return {
        "schema":PROTOCOL_SCHEMA,
        "status":q["status"],
        "private_method_commitment_sha256":hashlib.sha256(raw).hexdigest(),
        "source_freeze_epoch_ms":q["locked_original_archive_cutoff_epoch_ms"],
        "future_unknown_calibration_bags_minimum":MIN_CALIBRATION_UNKNOWN,
        "future_final_unknown_bags_minimum":release.MIN_UNKNOWN_RECORDINGS,
        "real_person_threshold_already_calibrated":False,
        "automatic_people_filing_authorized":False
    }

def self_test():
    scores=[float(i)/250.0 for i in range(MIN_CALIBRATION_UNKNOWN)]
    a=calibrate_synthetic_unknown_max_scores(scores)
    need(a["threshold"]==max(scores) and
         a["nominal_false_accept_bound_under_exchangeability"]<=ALPHA+1e-12 and
         a["production_automatic_filing_authorized"] is False,
         "synthetic_conformal_quantile_bad")
    failures=0
    for problem in (
        scores[:-1],
        scores+[float("nan")],
        scores+[float("inf")],
        scores+[1.01],
        ["wrong_score"]*MIN_CALIBRATION_UNKNOWN
    ):
        try:calibrate_synthetic_unknown_max_scores(problem)
        except ValueError:failures+=1
        else:raise AssertionError("unsafe_calibration_accepted")
    need(failures==5,"synthetic_failure_count_wrong")
    need(a["threshold"]==0.792 and
         not (a["threshold"]<a["threshold"]),
         "synthetic_calibration_tie_handling")
    # Calibration is only a method, and no current candidate score/label
    # or data can be promoted by this test.
    print(json.dumps({
        "status":"R769_FUTURE_OPEN_SET_CALIBRATION_METHOD_SYNTHETIC_PASS",
        "refusal_cases":failures,
        "minimum_future_unknown_calibration_bags":MIN_CALIBRATION_UNKNOWN,
        "real_unknown_labels_seen":0,
        "production_automatic_filing_authorized":False
    },sort_keys=True))

def main():
    p=argparse.ArgumentParser()
    g=p.add_mutually_exclusive_group(required=True)
    g.add_argument("--self-test",action="store_true")
    g.add_argument("--freeze",action="store_true")
    g.add_argument("--verify",action="store_true")
    args=p.parse_args()
    if args.self_test:self_test()
    elif args.freeze:print(json.dumps(freeze(),indent=2,sort_keys=True))
    else:print(json.dumps(verify(),indent=2,sort_keys=True))

if __name__=="__main__":
    main()
