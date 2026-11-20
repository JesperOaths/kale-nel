#!/usr/bin/env python3
"""R791: new, SEPARATE immutable SHADOW-method protocol; original R769 intact.

No real person gallery, media, biometric scores, faces or labels accessed.
R790's CSLS, per-template z normalization and RRF have score ranges unlike
cosine, so the existing frozen R769 cosine thresholds must NEVER be reused.
This only freezes mathematical/shadow testing rules BEFORE any new original
capture or independent person truth. It does not calibrate a real threshold.

Three possible branches => Bonferroni alpha / 3 for any OR acceptance.
Requires >=599 independent unknown calibration episodes, not reused as
final known/unknown or score-family selection trials. Each branch must
pass final release tests independently and source-provenance controls.
"""
from __future__ import annotations
import argparse,datetime as dt,hashlib,json,math,os,time
from pathlib import Path
import r760_freeze_blind_capture_cohort as r760
import r769_predeclared_open_set_protocol as primary
import r770_prospective_original_intake_gate as r770

SCHEMA="s9_r791_immutable_shadow_score_family_predeclaration_v1"
ALPHA_FAMILYWISE=.005
FAMILIES=("csls_v1_k3","template_z_v1_floor0p05","rrf_v1_csls_z_offset60")
ALPHA_BRANCH=ALPHA_FAMILYWISE/len(FAMILIES)
MIN_CALIBRATION_UNKNOWN=math.ceil(1/ALPHA_BRANCH)-1
PRIMARY_SHA="f9f8a840a8131e05d43d7ef9a2c0589f8c83ef1d740d7691dff132e6fa356d4b"
DEST=Path("/home/jespern/c720p-home-hub/staging/recognition-r744-ain-small-model-assets-20261120/r791_shadow_scoring_predeclaration.json")
CATALOG=Path("/home/jespern/c720p-home-hub/state/s9-standalone-archive-catalog-v1.json")
LEDGER=Path("/home/jespern/c720p-home-hub/state/s9-original-hash-ledger-v1.json")
DOMAINS={
    "cosine_primary_frozen":[-1.0,1.0],
    "csls_v1_k3":[-4.0,4.0],
    "template_z_v1_floor0p05":[-40.0,40.0],
    "rrf_v1_csls_z_offset60":[0.0,2/61],
}

def need(good,why):
    if not good:raise ValueError(why)

def canonical(obj):
    return (json.dumps(obj,sort_keys=True,separators=(",",":"),allow_nan=False)+"\n").encode()

def score_domain(family,value):
    need(family in DOMAINS and type(value) in (float,int) and
         math.isfinite(value),"nonfinite_or_unknown_score_family")
    lo,hi=DOMAINS[family]
    need(lo-1e-8<=value<=hi+1e-8,"score_outside_predeclared_family_domain")
    return True

def order_statistic(scores,family):
    """Purely synthetic mathematical exercise; never real-person calibration."""
    need(family in FAMILIES and type(scores) is list and
         MIN_CALIBRATION_UNKNOWN<=len(scores)<=200_000,
         "insufficient_or_unknown_score_family_calibration_bags")
    for s in scores:score_domain(family,s)
    n=len(scores)
    k=math.ceil((n+1)*(1-ALPHA_BRANCH))
    need(k<=n,"no_finite_alpha_corrected_threshold_available")
    sorted_scores=sorted(scores)
    return {
        "family":family,"n":n,"order_statistic_1_index":k,
        "threshold":sorted_scores[k-1],
        "use_only_if_score_strictly_greater":True,
        "unknown_episode_calibration_is_real":False,
        "does_not_authorize_people_filing":True
    }

def proposal(cutoff):
    need(type(cutoff) is int and cutoff>0,"invalid_frozen_source_cutoff")
    return {
        "schema":SCHEMA,
        "status":"SEPARATE_SHADOW_METHOD_PREDECLARED_NO_REAL_CALIBRATION",
        "locked_primary_method_sha256":PRIMARY_SHA,
        "primary_scoring_metric_unmodified":"cosine_top1_normalized_feature_pair",
        "candidate_model_sha256":primary.CANDIDATE_SHA,
        "original_research_source_freeze_epoch_ms":cutoff,
        "candidate_shadow_score_families":list(FAMILIES),
        "shadow_score_definitions":{
            "csls_v1_k3":"2*cos(q,r)-mean_top3_cos(q,ref_cohort)-mean_top3_cos(r,independent_background_queries)",
            "template_z_v1_floor0p05":"(cos(q,r)-mean_cos(r,independent_background_queries))/max(sd_cos(r,background),0.05)",
            "rrf_v1_csls_z_offset60":"1/(60+rank_csls)+1/(60+rank_template_z),rank_1_is_best",
        },
        "per_family_numeric_score_domain":DOMAINS,
        "shadow_family_count":len(FAMILIES),
        "familywise_unknown_false_accept_target":ALPHA_FAMILYWISE,
        "bonferroni_per_shadow_branch_alpha":ALPHA_BRANCH,
        "minimum_independent_unknown_calibration_episodes_per_branch":MIN_CALIBRATION_UNKNOWN,
        "unknown_episode_threshold_rule":"strictly_greater_than_ceil((n+1)*(1-alpha/3))_unknown_bag_quantile",
        "calibration_unknown_episodes_must_be_source_person_day_outfit_disjoint_from_reference_and_final_test":True,
        "background_density_queries_must_be_disjoint_from_unknown_calibration_and_final_test":True,
        "frozen_primary_cosine_threshold_cannot_be_reused_for_shadow_family":True,
        "primary_R769_threshold_cannot_be_mutated":True,
        "no_shadow_method_selection_using_final_test_outcomes":True,
        "no_three_method_or_release_claim_without_adjusted_familywise_far":True,
        "score_family_choice_requires_predeclared_independent_selection":True,
        "existing_primary_known_unknown_final_holdout_must_remain_unseen":True,
        "actual_person_unknown_calibration_labels":0,
        "actual_person_known_final_test_labels":0,
        "no_real_person_score_calculated":True,
        "shadow_numeric_threshold_calibrated":False,
        "shadow_people_folder_filing_authorized":False,
        "camera_or_person_reference_data_modified":False,
        "new_scheduled_tasks_created":0
    }

def offline_contract(q,cutoff):
    need(q==proposal(cutoff),"shadow_protocol_manifest_drift")
    need(q["locked_primary_method_sha256"]==PRIMARY_SHA and
         q["primary_scoring_metric_unmodified"]==
             "cosine_top1_normalized_feature_pair",
         "attempt_to_override_immutable_primary_method")
    need(q["minimum_independent_unknown_calibration_episodes_per_branch"]>=599 and
         q["shadow_numeric_threshold_calibrated"] is False and
         q["shadow_people_folder_filing_authorized"] is False,
         "shadow_release_condition_not_blocked")
    return True

def validate(q):
    frozen=r760.verify()
    baseline=primary.verify()
    need(baseline["private_method_commitment_sha256"]==PRIMARY_SHA,
         "primary_scoring_protocol_changed")
    return offline_contract(q,frozen["cutoff_epoch_ms"])

def freeze():
    need(DEST.parent.is_dir() and not DEST.parent.is_symlink() and
         not DEST.exists() and not DEST.is_symlink(),
         "already_frozen_shadow_method_refuse_replacement")
    orig=r760.verify()
    baseline=primary.verify()
    need(baseline["private_method_commitment_sha256"]==PRIMARY_SHA,
         "cosine_primary_method_hash_mismatch")
    # Genuine prospective unknown-person scoring cannot begin before
    # score-family disclosure. This local archive check reads ONLY
    # anonymous source filename/SHA metadata, no photo/video/labels.
    need(CATALOG.is_file() and LEDGER.is_file(),
         "current_archive_metadata_not_available")
    with CATALOG.open("r",encoding="utf-8") as f:cat=json.load(f)
    with LEDGER.open("r",encoding="utf-8") as f:led=json.load(f)
    prospective=r770.audit(cat,led,orig["cutoff_epoch_ms"],time.time())
    need(prospective["post_freeze_new_originals_seen"]==0,
         "cannot_predeclare_shadow_after_new_original_capture")
    q=proposal(orig["cutoff_epoch_ms"])
    validate(q)
    raw=canonical(q)
    need(1000<len(raw)<12000,"predeclared_shadow_manifest_size_invalid")
    fd=os.open(DEST,os.O_WRONLY|os.O_EXCL|os.O_NOFOLLOW|os.O_CREAT,0o600)
    with os.fdopen(fd,"wb") as fp:
        fp.write(raw);fp.flush();os.fsync(fp.fileno())
    return {
        "result":"R791_SHADOW_METHOD_FROZEN_NO_PERSON_CALIBRATION",
        "shadow_method_commitment_sha256":hashlib.sha256(raw).hexdigest(),
        "locked_primary_method_sha256":PRIMARY_SHA,
        "familywise_alpha":ALPHA_FAMILYWISE,
        "per_shadow_branch_alpha":ALPHA_BRANCH,
        "independent_unknown_calibration_episodes_required":MIN_CALIBRATION_UNKNOWN,
        "post_cutoff_originals_at_predeclaration":0,
        "actual_person_identification_validated":False,
        "automatic_people_filing_authorized":False,
    }

def verify():
    need(DEST.is_file() and not DEST.is_symlink() and
         1000<DEST.stat().st_size<12000 and
         DEST.stat().st_mode&0o077==0,
         "shadow_method_file_missing_or_public")
    raw=DEST.read_bytes()
    q=json.loads(raw)
    validate(q)
    return {
        "result":"R791_SEPARATE_SHADOW_SCORE_METHOD_LOCK_VERIFIED",
        "shadow_method_commitment_sha256":hashlib.sha256(raw).hexdigest(),
        "locked_primary_method_sha256":PRIMARY_SHA,
        "shadow_scoring_families":list(FAMILIES),
        "minimum_independent_unknown_calibration_episodes":
            MIN_CALIBRATION_UNKNOWN,
        "real_person_unknown_calibration_exists":False,
        "automatic_people_filing_authorized":False
    }

def synthetic():
    need(len(FAMILIES)==3 and MIN_CALIBRATION_UNKNOWN==599,
         "bonferroni_independent_sample_minimum_wrong")
    good=[float(i)/1000 for i in range(MIN_CALIBRATION_UNKNOWN)]
    for family in FAMILIES:
        normalized=(good if family!="rrf_v1_csls_z_offset60" else
                    [i*(2/61)/599 for i in range(MIN_CALIBRATION_UNKNOWN)])
        x=order_statistic(normalized,family)
        need(x["n"]==599 and x["order_statistic_1_index"]==599 and
             x["threshold"]==max(normalized) and
             x["does_not_authorize_people_filing"] is True,
             "synthetic_familywise_quantile_not_conservative")
    # CSLS can exceed the cosine [-1,1] numeric domain.
    score_domain("csls_v1_k3",1.6)
    score_domain("template_z_v1_floor0p05",12.0)
    score_domain("rrf_v1_csls_z_offset60",2/61)
    negative=0
    bad=[
        ("csls_v1_k3",4.01),
        ("template_z_v1_floor0p05",40.01),
        ("rrf_v1_csls_z_offset60",0.05),
        ("cosine_primary_frozen",1.4),
        ("csls_v1_k3",float("nan")),
        ("unknown_family",0.1),
    ]
    for family,value in bad:
        try:score_domain(family,value)
        except ValueError:negative+=1
        else:raise AssertionError("accepted_bad_score_family_or_numeric_domain")
    for badscores in (good[:-1],good+[float("inf")],good+[5]):
        try:order_statistic(badscores,FAMILIES[0])
        except ValueError:negative+=1
        else:raise AssertionError("invalid_calibration_distribution_accepted")
    # CI self-test must be fully portable: never read the owner-private
    # R760/R769 frozen manifests or phone archive in a public runner.
    synthetic_cutoff=1795135935959
    q=proposal(synthetic_cutoff)
    offline_contract(q,synthetic_cutoff)
    edited=dict(q,primary_scoring_metric_unmodified="csls_new")
    try:offline_contract(edited,synthetic_cutoff)
    except ValueError:negative+=1
    else:raise AssertionError("shadow_method_override_allowed")
    need(negative==10,"wrong_synthetic_refusal_count")
    print(json.dumps({
        "result":"R791_SHADOW_SCORE_DOMAIN_AND_MULTIPLICITY_SYNTHETIC_PASS",
        "negative_cases":negative,
        "primary_R769_scoring_metric_unchanged":True,
        "score_families":list(FAMILIES),
        "alpha_familywise":ALPHA_FAMILYWISE,
        "per_branch_alpha":ALPHA_BRANCH,
        "min_independent_unknown_calibration_bags":MIN_CALIBRATION_UNKNOWN,
        "actual_person_unknown_labels_read":0,
        "real_threshold_calibrated":False,
        "automatic_people_filing_authorized":False
    },sort_keys=True))

def main():
    p=argparse.ArgumentParser()
    modes=p.add_mutually_exclusive_group(required=True)
    modes.add_argument("--self-test",action="store_true")
    modes.add_argument("--freeze",action="store_true")
    modes.add_argument("--verify",action="store_true")
    a=p.parse_args()
    if a.self_test:synthetic()
    elif a.freeze:print(json.dumps(freeze(),sort_keys=True))
    else:print(json.dumps(verify(),sort_keys=True))

if __name__=="__main__":main()
