#!/usr/bin/env python3
"""R759: read-only independent person-ReID release-evidence gap report.

This does not and cannot validate real person identities, compare embeddings,
derive labels, identify people, train a model, or update People folders.
It consumes the two existing anonymous research-integrity audits and the
R743 statistical contract. The missing independent person truth is not
estimated from metadata. Never promote source disjointness to day disjointness.

All code runs as a one-shot check. C720P only joins small JSON metadata;
the S9+ R752 native projector verifies private vector norms and does
not transfer private vector values. No new scheduled job or timer.
"""
from __future__ import annotations
import argparse
import json
import math
import time

import s9_reid_manifest_integrity_v749 as r749
import r758_capture_day_leakage_audit as r758
import s9_reid_open_set_release_gate_v743 as r743
import r760_freeze_blind_capture_cohort as r760
import r763_research_quality_selection as r763

# Candidate R744 AIN x0.25 model does NOT equal the older TFLite model
# that produced the existing 98 feature sidecars. Both happen to emit
# 512D floats; identical dimensions NEVER imply interchangeable weights.
CANDIDATE_ONNX_SHA = (
    "e7adf72649332d97c613be93db17a047e526bf55fc8b7240f14a1da67390b7af"
)
QUALITY_METRICS = r758.STATE / "metrics" / "s9-recognition-quality-gate-v1.json"

def need(ok,reason):
    if not ok:raise ValueError(reason)

def readiness(integrity,days,selection=None):
    need(type(integrity) is dict and type(days) is dict and
         integrity.get("schema")=="s9_r749_anonymous_reid_provenance_gate_v1" and
         days.get("schema")=="s9_r758_sha_verified_capture_day_split_audit_v1",
         "unrecognized_research_integrity_evidence")
    require_ints=(
        "distinct_vector_sidecars", "reference_rows",
        "heldout_rows", "reference_rows_failing_independent_geometry",
        "reference_rows_without_independent_frame_pts",
        "heldout_rows_without_independent_frame_pts",
        "reference_crops_eligible_with_quality_and_pts",
    )
    for key in require_ints:
        need(type(integrity.get(key)) is int and integrity[key]>=0,
             "invalid_r749_source_provenance_counts")
    day_keys=(
        "distinct_research_sources", "source_versions_verified_against_original_catalog_and_ledger",
        "source_SHA_ledger_rechecks_within_14_days",
        "source_SHA_ledger_rechecks_older_than_14_days",
        "reference_distinct_sources", "holdout_distinct_sources",
        "reference_holdout_source_sha_overlap", "shared_capture_days_local",
        "shared_capture_days_utc", "holdout_rows_on_shared_days",
        "holdout_rows_on_exclusive_days", "holdout_sources_on_exclusive_days",
        "holdout_exclusive_capture_day_count"
    )
    for key in day_keys:
        need(type(days.get(key)) is int and days[key]>=0,
             "invalid_r758_capture_day_counts")
    need(integrity.get("result")=="RESEARCH_ONLY_NOT_PRODUCTION_PROVEN" and
         days.get("automated_identity_filing_authorized") is False and
         integrity.get("production_auto_filing_authorized") is False,
         "attempt_to_use_research_data_as_production_approval")
    need(integrity.get("embeddings_compared")==0 and
         days.get("biometric_embeddings_loaded")==0 and
         days.get("person_identity_labels_read")==0 and
         days.get("photos_decoded")==0 and
         days.get("video_bytes_transferred_to_hub")==0,
         "privacy_boundary_exceeded")
    need(integrity["reference_rows"]+integrity["heldout_rows"]>=
         integrity["distinct_vector_sidecars"] and
         integrity["heldout_rows"]==
         days["holdout_rows_on_shared_days"]+days["holdout_rows_on_exclusive_days"],
         "r749_r758_inconsistent_row_counts")
    need(days["distinct_research_sources"]==
         days["reference_distinct_sources"]+
         days["holdout_distinct_sources"]-
         days["reference_holdout_source_sha_overlap"] and
         days["distinct_research_sources"]==
         days["source_versions_verified_against_original_catalog_and_ledger"] and
         days["distinct_research_sources"]==
         days["source_SHA_ledger_rechecks_within_14_days"]+
         days["source_SHA_ledger_rechecks_older_than_14_days"],
         "inconsistent_verified_source_counts")

    # Historical raw inputs are still invalid. Only an independently
    # recomputed metadata-only R763 mask can repair the *research selection*,
    # never the raw historical data or production matcher. No identity claim.
    mask_ok=False
    if selection is not None:
        need(type(selection) is dict and
             selection.get("schema")==
                 "s9_r763_anonymous_research_quality_selection_v1" and
             selection.get("status")=="RESEARCH_MASK_ONLY_NOT_IDENTITY_EVALUATION" and
             selection.get("production_automation_authorized") is False and
             selection.get("real_person_crop_images_decoded")==0 and
             selection.get("biometric_vectors_compared")==0 and
             selection.get("identity_labels_read")==0,
             "invalid_research_quality_mask_evidence")
        need(selection.get("rejected_reference_crop_rows")==
             integrity["reference_rows_failing_independent_geometry"] and
             type(selection.get("quality_eligible_reference_crop_rows")) is int and
             selection["quality_eligible_reference_crop_rows"]>0 and
             type(selection.get("date_disjoint_holdout_crop_rows")) is int and
             0<selection["date_disjoint_holdout_crop_rows"]<=
                 days["holdout_rows_on_exclusive_days"] and
             type(selection.get("date_disjoint_holdout_original_sources")) is int and
             0<selection["date_disjoint_holdout_original_sources"]<=
                 days["holdout_sources_on_exclusive_days"] and
             selection.get("calibration_source_sha_and_day_overlaps")==0 and
             selection.get("eligible_mask_source_originals_verified_against_current_ledger") is True and
             selection.get("historical_exact_frame_PTS_proven_for_selected_crops") is False and
             selection.get("independent_known_person_truth_proven") is False and
             selection.get("independent_unknown_person_truth_proven") is False,
             "unverified_filter_cannot_remove_raw_historical_blockers")
        mask_ok=True

    # R743 demands evidence about independently known/unknown persons;
    # NONE can be inferred from anonymous crop/manifests. We do not fabricate
    # a 'correct' label count from 39 approved crops or 59 holdout rows.
    verifiable={
        "model_weights_provenance_verified":False,
        "model_runtime_verified_on_s9":False,
        "input_crop_geometry_and_preprocessing_verified":False,
        "exact_source_SHA256_current":days["all_source_SHA_rechecks_current"] is True,
        "exact_crop_SHA256_current":False,
        "source_frame_PTS_independently_verified":
            integrity["reference_rows_without_independent_frame_pts"]==0 and
            integrity["heldout_rows_without_independent_frame_pts"]==0 and
            integrity["reference_crops_eligible_with_quality_and_pts"]>0,
        "only_human_approved_reference_labels":False,
        "no_unverified_self_training":False,
        "heldout_original_sources_disjoint":
            days["reference_holdout_source_sha_overlap"]==0,
        "heldout_capture_days_disjoint":
            mask_ok or (
              days["shared_capture_days_local"]==0 and
              days["shared_capture_days_utc"]==0),
        "heldout_outfit_episodes_disjoint":False,
        "heldout_known_and_unknown_labels_independent":False,
        "recordings_counted_as_bags_not_frames":False,
        "heldout_thresholds_predeclared":False,
        "camera_capture_30fps_under_model_load_verified":False,
        "native_4k_event_file_30fps_verified_under_model_load":False,
    }
    need(set(verifiable)==set(r743.REQUIRED_TRUTHS),
         "r743_required_release_conditions_changed_without_audit_update")
    # Even if a future synthetic report contains all True, R743 never
    # authorizes activation. No independent person labels are read here.
    synthetic_summary={
        "schema":"s9_reid_independent_evaluation_summary_v1",
        **verifiable,
        "known_original_bags":0,
        "known_correct_accepts":0,
        "known_wrong_accepts":0,
        "known_distinct_people":0,
        "unknown_original_bags":0,
        "unknown_false_accepts":0,
    }
    gate=r743.evaluate(synthetic_summary)
    need(gate["automation_authorized"] is False and
         gate["status"]=="REFUSE_AUTOMATION",
         "open_set_release_gate_incorrectly_authorized_real_data")

    blockers=[]
    def block(ok,key,observation):
        if not ok:blockers.append({"gate":key,"observed":observation})
    block(days["reference_holdout_source_sha_overlap"]==0,
          "SOURCE_SHA_DISJOINTNESS",days["reference_holdout_source_sha_overlap"])
    block(verifiable["heldout_capture_days_disjoint"],
          "CAPTURE_DAY_DISJOINTNESS",
          {"shared_local_days":days["shared_capture_days_local"],
           "holdout_rows_on_shared_days":days["holdout_rows_on_shared_days"]})
    block(verifiable["exact_source_SHA256_current"],
          "SOURCE_LEDGER_RECENCY",
          {"source_rechecks_older_than_14_days":
              days["source_SHA_ledger_rechecks_older_than_14_days"]})
    block(mask_ok or integrity["reference_rows_failing_independent_geometry"]==0,
          "STRICT_REFERENCE_CROP_GEOMETRY",
          {"bad_reference_rows":integrity["reference_rows_failing_independent_geometry"]})
    block(verifiable["source_frame_PTS_independently_verified"],
          "HISTORICAL_SOURCE_FRAME_PTS",
          {"reference_rows_unverified":integrity["reference_rows_without_independent_frame_pts"],
           "holdout_rows_unverified":integrity["heldout_rows_without_independent_frame_pts"]})
    # Missing independently approved identity truth is UNKNOWN, not zero
    # wrong assignments. Its absence is itself an absolute blocker.
    if (mask_ok and
        selection["date_disjoint_holdout_original_sources"]<
            r743.MIN_KNOWN_RECORDINGS):
        blockers.append({
            "gate":"INDEPENDENT_ELIGIBLE_SOURCE_BAGS_UNDERPOWERED",
            "observed":{
                "research_date_disjoint_source_bags":
                    selection["date_disjoint_holdout_original_sources"],
                "minimum_known_independent_bags":r743.MIN_KNOWN_RECORDINGS,
                "minimum_unknown_independent_bags":r743.MIN_UNKNOWN_RECORDINGS,
                "verified_independent_person_labels":0,
            }})
    blockers.append({"gate":"INDEPENDENT_KNOWN_PERSON_TRUTH_AND_OUTFITS",
                     "observed":"unproven; labels never loaded"})
    blockers.append({"gate":"INDEPENDENT_OPEN_SET_UNKNOWN_PERSON_TRUTH_AND_FAR",
                     "observed":"unproven; no verified unknown-person test labels"})
    blockers.append({"gate":"END_TO_END_4K_EVENT_OUTPUT_DURING_MODEL_LOAD",
                     "observed":"not established by sensor FPS alone"})
    blockers.append({"gate":"PROSPECTIVE_PREDECLARED_THRESHOLDS",
                     "observed":"not proven by the research manifests"})
    blockers.append({"gate":"CANDIDATE_MODEL_HAS_NO_IDENTICAL_VERSION_RECOGNITION_EVALUATION",
                     "observed":"98 sidecars have legacy TFLite feature-model SHA; candidate OSNet-AIN x0.25 ONNX SHA differs"})


    return {
        "schema":"s9_r759_independent_release_evidence_readiness_v1",
        "status":"RECOGNITION_RELEASE_BLOCKED",
        "blocker_count":len(blockers),
        "blockers":blockers,
        "independent_original_source_disjointness_only":days["reference_holdout_source_sha_overlap"]==0,
        "heldout_source_day_disjointness":verifiable["heldout_capture_days_disjoint"],
        "historical_raw_split_shared_capture_days":days["shared_capture_days_local"],
        "research_filter_approved_for_metadata_only_split":mask_ok,
        "research_raw_originals_and_crops_unchanged":True,
        "research_vector_model_matches_candidate_ain_x025":
            r749.MODEL_SHA==CANDIDATE_ONNX_SHA,
        "candidate_ain_x025_independent_recognition_accuracy_evaluated":False,
        "heldout_rows_on_exclusive_capture_days":days["holdout_rows_on_exclusive_days"],
        "holdout_source_bags_on_exclusive_capture_days":
            days["holdout_sources_on_exclusive_days"],
        "known_person_independently_scored_bags":None,
        "unknown_person_independently_scored_bags":None,
        "minimum_known_bags_for_future_independent_trial":
            r743.MIN_KNOWN_RECORDINGS,
        "minimum_known_distinct_people_for_future_independent_trial":
            r743.MIN_KNOWN_PEOPLE,
        "minimum_independent_unknown_bags_if_no_false_accepts":
            r743.MIN_UNKNOWN_RECORDINGS,
        "unknown_95pct_upper_far_if_zero_false_accepts_in_600_independent_bags":
            round(1.0 - 0.05**(1/r743.MIN_UNKNOWN_RECORDINGS),6),
        "thresholds_tuned_from_this_holdout":False,
        "private_vectors_compared":False,
        "owner_person_labels_processed":False,
        "real_camera_modified":False,
        "real_people_folder_assignments":0,
        "automatic_filing_authorized":False,
        "new_recurring_tasks_created":0
    }

def test():
    a={
        "schema":"s9_r749_anonymous_reid_provenance_gate_v1",
        "result":"RESEARCH_ONLY_NOT_PRODUCTION_PROVEN",
        "distinct_vector_sidecars":98,
        "reference_rows":40,"heldout_rows":59,
        "reference_rows_failing_independent_geometry":5,
        "reference_rows_without_independent_frame_pts":40,
        "heldout_rows_without_independent_frame_pts":59,
        "reference_crops_eligible_with_quality_and_pts":0,
        "production_auto_filing_authorized":False,
        "embeddings_compared":0,
    }
    b={
        "schema":"s9_r758_sha_verified_capture_day_split_audit_v1",
        "distinct_research_sources":71,
        "source_versions_verified_against_original_catalog_and_ledger":71,
        "source_SHA_ledger_rechecks_within_14_days":7,
        "source_SHA_ledger_rechecks_older_than_14_days":64,
        "all_source_SHA_rechecks_current":False,
        "reference_distinct_sources":39,
        "holdout_distinct_sources":32,
        "reference_holdout_source_sha_overlap":0,
        "shared_capture_days_local":5,
        "shared_capture_days_utc":5,
        "holdout_rows_on_shared_days":50,
        "holdout_rows_on_exclusive_days":9,
        "holdout_sources_on_exclusive_days":6,
        "holdout_exclusive_capture_day_count":3,
        "automated_identity_filing_authorized":False,
        "biometric_embeddings_loaded":0,
        "person_identity_labels_read":0,
        "photos_decoded":0,
        "video_bytes_transferred_to_hub":0
    }
    real=readiness(a,b)
    need(real["status"]=="RECOGNITION_RELEASE_BLOCKED" and
         real["blocker_count"]>=9 and
         real["research_vector_model_matches_candidate_ain_x025"] is False and
         real["automatic_filing_authorized"] is False,
         "hypothetical_release_should_stay_blocked")
    need(real["heldout_rows_on_exclusive_capture_days"]==9,
         "source_capture_day_remainder_math_bad")
    selection={
        "schema":"s9_r763_anonymous_research_quality_selection_v1",
        "status":"RESEARCH_MASK_ONLY_NOT_IDENTITY_EVALUATION",
        "production_automation_authorized":False,
        "real_person_crop_images_decoded":0,
        "biometric_vectors_compared":0,"identity_labels_read":0,
        "rejected_reference_crop_rows":5,
        "quality_eligible_reference_crop_rows":34,
        "date_disjoint_holdout_crop_rows":9,
        "date_disjoint_holdout_original_sources":6,
        "calibration_source_sha_and_day_overlaps":0,
        "eligible_mask_source_originals_verified_against_current_ledger":True,
        "historical_exact_frame_PTS_proven_for_selected_crops":False,
        "independent_known_person_truth_proven":False,
        "independent_unknown_person_truth_proven":False,
    }
    filtered=readiness(a,b,selection)
    need(filtered["research_filter_approved_for_metadata_only_split"] is True and
         filtered["heldout_source_day_disjointness"] is True and
         filtered["historical_raw_split_shared_capture_days"]==5 and
         filtered["blocker_count"]==real["blocker_count"]-1 and
         any(x["gate"]=="INDEPENDENT_ELIGIBLE_SOURCE_BAGS_UNDERPOWERED"
             for x in filtered["blockers"]),
         "selection_filter_must_fix_only_quality_date_and_expose_low_power")
    for key,bad in (
        ("production_automation_authorized",True),
        ("date_disjoint_holdout_crop_rows",60),
        ("rejected_reference_crop_rows",0),
        ("calibration_source_sha_and_day_overlaps",1),
        ("independent_known_person_truth_proven",True),
    ):
        tampered={**selection,key:bad}
        try:readiness(a,b,tampered)
        except ValueError:pass
        else:raise AssertionError("unsafe_research_mask_accepted_"+key)
    # Even with date and SHA blocks repaired, unknown/known independent
    # evaluation and 4K event output remain unknown, never inferred.
    other=dict(b,shared_capture_days_local=0,shared_capture_days_utc=0,
               holdout_rows_on_shared_days=0,
               holdout_rows_on_exclusive_days=59,
               all_source_SHA_rechecks_current=True,
               source_SHA_ledger_rechecks_within_14_days=71,
               source_SHA_ledger_rechecks_older_than_14_days=0)
    attempt=readiness(a,other)
    need(attempt["status"]=="RECOGNITION_RELEASE_BLOCKED" and
         attempt["automatic_filing_authorized"] is False and
         any(x["gate"]=="INDEPENDENT_OPEN_SET_UNKNOWN_PERSON_TRUTH_AND_FAR"
             for x in attempt["blockers"]),
         "future_source_fixes_must_not_prove_identity_labels")
    refusal_count=0
    for root,k,v in (
        ("a","production_auto_filing_authorized",True),
        ("a","embeddings_compared",1),
        ("b","person_identity_labels_read",1),
        ("b","source_SHA_ledger_rechecks_within_14_days",72),
        ("a","heldout_rows",60),
    ):
        aa=dict(a);bb=dict(b);(aa if root=="a" else bb)[k]=v
        try:readiness(aa,bb);raise AssertionError("invalid_evidence_accepted")
        except ValueError:refusal_count+=1
    print(json.dumps({
        "status":"R759_RELEASE_READINESS_SYNTHETIC_PASS",
        "adversarial_evidence_cases_rejected":refusal_count,
        "hypothetical_source_fixes_cannot_promote_unknown_identity_truth":True,
        "automatic_filing_authorized":False
    },sort_keys=True))

def quality_summary(metadata, days):
    """Read ONLY approved aggregate keys of the existing live quality gate."""
    proof=r758.load_json(QUALITY_METRICS)
    need(proof.get("schema")=="s9_source_verified_recognition_quality_gate_v1",
         "unrecognized_quality_gate_report")
    need(proof.get("native_original_count")==days["current_catalog_originals"] and
         proof.get("source_model_originals_sha_verified") is True,
         "quality_gate_does_not_match_current_archive")
    total=proof.get("assessable_leave_one_original_out")
    correct=proof.get("deployed_holdout_correct")
    need(type(total) is int and total>=0 and
         type(correct) is int and 0<=correct<=total,
         "historical_recognition_trial_counts_inconsistent")
    gates=proof.get("read_only_deployment_gates",{})
    need(type(gates) is dict and
         gates.get("automatic_people_filing_authorized") is False and
         proof.get("independent_known_positive_validated") is False and
         proof.get("independent_unknown_FAR_validated") is False and
         proof.get("unknown_person_human_labels")==0,
         "quality_gate_production_assumptions_changed")
    return {
        "historical_source_separated_assessable_recordings":total,
        "historical_correct_assessable_recordings":correct,
        "historical_accuracy_descriptive_only":round(correct/total,4) if total else None,
        "historical_trial_is_not_independent_prospective_evidence":True,
        "independent_unknown_person_ground_truth_count":0,
        "production_people_filing_authorized_by_live_quality_gate":False
    }

def run():
    now=time.time()
    catalog=r758.load_json(r758.CATALOG,now,r758.MAX_CATALOG_AGE_SEC)
    summary=r758.load_json(r758.SUMMARY,now,r758.MAX_CATALOG_AGE_SEC)
    ledger=r758.load_json(r758.LEDGER)
    listing=r749.phone_listing(r749.ROOT)
    batch_names=sorted(n for n in listing
                       if n.startswith("batch-") and n.endswith(".json"))
    need(0<len(batch_names)<=200,"untrusted_batch_manifest_count")
    batches=[r749.phone_json(r749.ROOT+"/"+n) for n in batch_names]
    projected=r749.phone_projected_vector_metadata()
    integrity=r749.report(batches,projected)
    positioned={}
    for batch in batches:
        _,start,end,payload=r749.extract_batch(batch)
        for offset,row in enumerate(payload):
            pos=start+offset
            if pos in positioned:
                need(positioned[pos]==row,"conflicting_replayed_research_manifest")
            else:positioned[pos]=row
    need(sorted(positioned)==list(range(len(positioned))),
         "research_manifest_rows_not_complete")
    rows=[positioned[i] for i in sorted(positioned)]
    day_audit=r758.audit_rows(rows,catalog,summary,ledger,now)
    clean_mask=r763.select(rows,catalog,ledger,summary,now)
    frozen_cohort=r760.verify()
    need(clean_mask["rejected_reference_crop_rows"]==
         integrity["reference_rows_failing_independent_geometry"],
         "research_quality_selector_does_not_exclude_all_bad_references")
    need(clean_mask["date_disjoint_holdout_crop_rows"]==
         day_audit["holdout_rows_on_exclusive_days"],
         "reference_quality_mask_and_day_exclusions_disagree")
    need(frozen_cohort["historical_samples_are_prospective"] is False and
         frozen_cohort["prospective_independent_recordings_observed_at_cutoff"]==0,
         "old_recordings_must_not_be_promoted_to_prospective_labels")
    output=readiness(integrity,day_audit,clean_mask)
    output.update(quality_summary(integrity,day_audit))
    output.update({
        "research_selection_filter_verified":True,
        "excluded_bad_reference_crops_from_research_selection":
            clean_mask["rejected_reference_crop_rows"],
        "research_quality_eligible_reference_crops":
            clean_mask["quality_eligible_reference_crop_rows"],
        "research_date_disjoint_holdout_crop_rows":
            clean_mask["date_disjoint_holdout_crop_rows"],
        "research_selection_mask_commitment_sha256":
            clean_mask["eligible_ref_holdout_crop_mask_commitment_sha256"],
        "historical_anonymous_candidate_cohort_frozen":True,
        "historical_anonymous_candidates":
            frozen_cohort["historical_exploratory_candidates"],
        "historical_candidates_are_valid_identity_accuracy_trial":False,
        "future_prospective_identity_trials_available_at_cutoff":0,
        "production_automatic_people_filing_enabled":False
    })
    print(json.dumps(output,sort_keys=True,indent=2))

def main():
    p=argparse.ArgumentParser()
    g=p.add_mutually_exclusive_group(required=True)
    g.add_argument("--self-test",action="store_true")
    g.add_argument("--audit",action="store_true")
    a=p.parse_args()
    if a.self_test:test()
    else:run()

if __name__=="__main__":
    main()
