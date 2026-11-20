#!/usr/bin/env python3
"""R794 post-R793 methodological amendment, exclusive-create, before new data.

Purpose: lock a rank-only interpretation of RRF. The frozen original
R769 cosine trial and original R791 shadow arms remain bitwise unchanged.
This separate SHA-bound amendment forbids calibrating unknown acceptance
directly from RRF rank points, whose top can be identical for known and
unknown orthogonal 512D queries (proven on S9 via R793).

For unknown rejection the *RRF-selected candidate's* ABSOLUTE CSLS and
template-z scores each need independent calibration on source/person/day/
outfit-disjoint unknown calibration episodes. Both strict '>' tests and
the existing source provenance gates must pass; otherwise abstain.
No real images, biometric scores, identity annotations or model execution.
"""
from __future__ import annotations
import argparse,hashlib,json,math,os,time
from pathlib import Path
import r760_freeze_blind_capture_cohort as freeze_cohort
import r769_predeclared_open_set_protocol as primary
import r770_prospective_original_intake_gate as intake
import r791_shadow_score_family_predeclaration as shadow

SCHEMA="s9_r794_shadow_rrf_rank_only_absolute_rejection_amendment_v1"
PRIMARY_SHA="f9f8a840a8131e05d43d7ef9a2c0589f8c83ef1d740d7691dff132e6fa356d4b"
SHADOW_SHA="e58b5e17cbb5ab1b32ad62e9b8ea53081cefbe5509f3731e7024add7c3612375"
DEST=Path("/home/jespern/c720p-home-hub/staging/recognition-r744-ain-small-model-assets-20261120/r794_rank_only_amendment_predeclaration.json")
MIN_UNKNOWN_CAL=shadow.MIN_CALIBRATION_UNKNOWN

def need(ok,why):
    if not ok:raise ValueError(why)

def canonical(data):
    return (json.dumps(data,sort_keys=True,separators=(",",":"),allow_nan=False)+"\n").encode()

def decision(candidate,csls_values,z_values,threshold_csls,threshold_z,
             source_provenance_ok=False,independent_calibration_verified=False):
    """Generic math only; NEVER an application policy or real identity inference.

    Candidate is preselected by frozen RRF ranking, not score magnitude.
    Null, invalid and missing independently calibrated score thresholds
    produce abstention. A real system must separately audit candidate
    reference provenance and known/unknown accuracy as in frozen R759.
    """
    if (type(candidate) is not int or type(csls_values) is not list or
        type(z_values) is not list or len(csls_values)!=len(z_values) or
        candidate<0 or candidate>=len(csls_values)):
        return False
    if source_provenance_ok is not True or independent_calibration_verified is not True:
        return False
    if not all(type(v) in (int,float) and math.isfinite(v)
               for v in (csls_values[candidate],z_values[candidate],
                         threshold_csls,threshold_z)):
        return False
    if not (shadow.DOMAINS["csls_v1_k3"][0]<=threshold_csls<=shadow.DOMAINS["csls_v1_k3"][1] and
            shadow.DOMAINS["template_z_v1_floor0p05"][0]<=threshold_z<=shadow.DOMAINS["template_z_v1_floor0p05"][1]):
        return False
    # A rank can be arbitrary for an unrelated source. BOTH absolute
    # cohort-corrected evidences must exceed independent calibration.
    return csls_values[candidate]>threshold_csls and z_values[candidate]>threshold_z

def proposal(cutoff):
    need(type(cutoff) is int and cutoff>0,"missing_source_freeze")
    return {
        "schema":SCHEMA,
        "status":"SHADOW_RRF_RANK_ONLY_METHOD_AMENDMENT_NOT_CALIBRATED",
        "locked_primary_method_sha256":PRIMARY_SHA,
        "locked_initial_shadow_method_sha256":SHADOW_SHA,
        "locked_source_cutoff_epoch_ms":cutoff,
        "model_sha256":primary.CANDIDATE_SHA,
        "reason_for_amendment":"R793: orthogonal unknown and synthetic known queries both achieved identical RRF top 2/61",
        "rrf_role":"candidate_ranking_only_never_unknown_acceptance_score",
        "direct_rrf_top_score_unknown_threshold_forbidden":True,
        "nominal_ranking_rule":"rank_top_1/(60+rank_csls)+1/(60+rank_template_z)",
        "absolute_unknown_rejection_scores":[
            "rrf_selected_candidate_csls_absolute",
            "rrf_selected_candidate_template_z_absolute",
        ],
        "absolute_rejection_rule":"accept_only_if_both_selected_candidate_csls_and_z_are_strictly_above_their_separately_independent_unknown_thresholds",
        "unknown_calibration_scores_must_be_conditioned_on_frozen_rrf_candidate_selection":True,
        "all_reference_and_background_cohorts_frozen_before_unknown_calibration":True,
        "unknown_calibration_vs_background_reference_and_final_holdout_source_person_day_outfit_disjoint":True,
        "calibration_no_threshold_look_at_final_unknown_or_known_test":True,
        "per_absolute_arm_alpha":shadow.ALPHA_BRANCH,
        "required_independent_unknown_calibration_episodes_per_absolute_arm":MIN_UNKNOWN_CAL,
        "real_r793_unknown_query_examples_used_to_select_method":0,
        "synthetic_known_unknown_identifications_calibrated":False,
        "independent_real_unknown_calibration_available":False,
        "real_known_unknown_final_truth_available":False,
        "unknown_acceptance_metric_calibrated":False,
        "automatic_people_folder_filing_authorized":False,
        "production_s9_camera_or_recognition_changed":False,
        "new_scheduled_tasks":0
    }

def offline_validate(data,cutoff):
    need(data==proposal(cutoff),"rank_only_amendment_drift_or_mutation")
    need(data["locked_primary_method_sha256"]==PRIMARY_SHA and
         data["locked_initial_shadow_method_sha256"]==SHADOW_SHA and
         data["direct_rrf_top_score_unknown_threshold_forbidden"] is True and
         data["unknown_calibration_scores_must_be_conditioned_on_frozen_rrf_candidate_selection"] is True and
         data["automatic_people_folder_filing_authorized"] is False,
         "unsafe_rank_fusion_method_amendment")
    return True

def strict_private_parent_checks():
    cohort=freeze_cohort.verify()
    a=primary.verify();b=shadow.verify()
    need(a["private_method_commitment_sha256"]==PRIMARY_SHA and
         b["shadow_method_commitment_sha256"]==SHADOW_SHA,
         "source_protocols_changed_after_predeclaration")
    return cohort["cutoff_epoch_ms"]

def freeze():
    cutoff=strict_private_parent_checks()
    need(DEST.parent.is_dir() and not DEST.parent.is_symlink() and
         not DEST.exists() and not DEST.is_symlink(),
         "rank_only_amendment_already_frozen_refuse_overwrite")
    with shadow.CATALOG.open("r",encoding="utf-8") as f:cat=json.load(f)
    with shadow.LEDGER.open("r",encoding="utf-8") as f:led=json.load(f)
    prospective=intake.audit(cat,led,cutoff,time.time())
    need(prospective["post_freeze_new_originals_seen"]==0,
         "rank_only_amendment_cannot_be_chosen_after_test_capture")
    q=proposal(cutoff);offline_validate(q,cutoff)
    raw=canonical(q);need(1200<len(raw)<12000,"amendment_size_out_of_bounds")
    fd=os.open(DEST,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,"wb") as f:
        f.write(raw);f.flush();os.fsync(f.fileno())
    return {"result":"R794_SEPARATE_RRF_UNKNOWN_REJECTION_AMENDMENT_FROZEN",
        "method_commitment_sha256":hashlib.sha256(raw).hexdigest(),
        "primary_method_unchanged":True,"shadow_initial_method_unchanged":True,
        "real_person_threshold_calibrated":False,
        "auto_people_filing_authorized":False}

def verify():
    cutoff=strict_private_parent_checks()
    need(DEST.is_file() and not DEST.is_symlink() and
         1200<DEST.stat().st_size<12000 and
         DEST.stat().st_mode&0o077==0,
         "private_rejection_amendment_missing_or_public")
    raw=DEST.read_bytes();offline_validate(json.loads(raw),cutoff)
    return {"result":"R794_SHADOW_RRF_RANK_ONLY_AMENDMENT_VERIFY_PASS",
        "method_commitment_sha256":hashlib.sha256(raw).hexdigest(),
        "original_cosine_method_sha256":PRIMARY_SHA,
        "original_shadow_method_sha256":SHADOW_SHA,
        "rank_only_acceptance_forbidden":True,
        "two_independent_real_unknown_calibration_thresholds_exist":False,
        "automatic_people_filing_authorized":False}

def synthetic():
    cutoff=1795135935959
    spec=proposal(cutoff);offline_validate(spec,cutoff)
    # Explicitly demonstrate same high RRF rank for known and unknown.
    known_rrf=2/(60+1);unknown_rrf=2/(60+1)
    need(known_rrf==unknown_rrf,"rank_point_collision_not_demonstrated")
    no_real_thresholds=(None,None)
    need(not decision(1,[0,1.401653],[0,10.192146],
                      *no_real_thresholds,True,True),
         "uncalibrated_known_must_always_abstain")
    need(not decision(2,[-0.9,-0.1,0],[-10,-2,0],
                      *no_real_thresholds,True,True),
         "uncalibrated_unknown_must_always_abstain")
    # Toy numbers solely for logic tests, never frozen as real thresholds.
    need(decision(1,[0,1.401653],[0,10.192146],0.1,1.0,True,True),
         "toy_known_two_absolute_gates_refused")
    need(not decision(2,[-0.9,-0.1,0],[-10,-2,0],0.1,1.0,True,True),
         "toy_unknown_rank_points_false_accepted")
    faults=[
        (None,[0,1.4],[0,10],0.1,1),
        (1,[0,1.4],[0,10],None,1),
        (1,[0,1.4],[0,10],0.1,float("nan")),
        (1,[0,1.4],[0,10],float("inf"),1),
        (2,[0,1.4],[0,10],0.1,1),
        (1,[0,1.4],[0],0.1,1),
        (1,[0,1.4],[0,10],4.5,1),
        (1,[0,1.4],[0,10],0.1,41),
    ]
    negatives=0
    for candidate,c,z,t1,t2 in faults:
        need(not decision(candidate,c,z,t1,t2,True,True),
             "invalid_shadow_math_was_accepted")
        negatives+=1
    for proven,calibrated in [(False,True),(True,False),(False,False)]:
        need(not decision(1,[0,1.4],[0,10],0.1,1,proven,calibrated),
             "missing_independence_or_provenance_accepted")
        negatives+=1
    q=dict(spec);q["direct_rrf_top_score_unknown_threshold_forbidden"]=False
    try:offline_validate(q,cutoff)
    except ValueError:negatives+=1
    else:raise AssertionError("amendment_mutation_accepted")
    need(negatives==12,"refusal_count_inconsistent")
    print(json.dumps({"result":"R794_RRF_RANK_ONLY_UNKNOWN_ABSTENTION_SYNTHETIC_PASS",
        "negative_cases":negatives,
        "same_rrf_top_score_known_unknown":True,
        "two_absolute_method_score_gates_required":True,
        "real_unknown_calibration_episodes_required":MIN_UNKNOWN_CAL,
        "real_person_scores_or_labels_used":0,
        "original_R769_and_R791_private_files_read":0,
        "automatic_people_filing_authorized":False},sort_keys=True))

def main():
    p=argparse.ArgumentParser()
    actions=p.add_mutually_exclusive_group(required=True)
    actions.add_argument("--self-test",action="store_true")
    actions.add_argument("--freeze",action="store_true")
    actions.add_argument("--verify",action="store_true")
    a=p.parse_args()
    if a.self_test:synthetic()
    elif a.freeze:print(json.dumps(freeze(),sort_keys=True))
    else:print(json.dumps(verify(),sort_keys=True))

if __name__=="__main__":main()
