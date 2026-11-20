#!/usr/bin/env python3
"""R797 strict read-only known/unknown person truth coverage audit.

This intentionally does NOT use embeddings, faces or similarity scores and
does not attempt to infer unknown-person ground truth from a low match score.
It reconciles independently declared prospective *verified* truth counts
against the frozen S9+ recognition quality reports. Historical references
and tentative unknown candidates are never converted into blinded trials.

No People folders, research reference files or clips changed.
"""
from __future__ import annotations
import argparse,json,pathlib
from typing import Any

STATE=pathlib.Path("/home/jespern/c720p-home-hub/state/metrics")
QUALITY=STATE/"s9-recognition-quality-gate-v1.json"
KNOWN=STATE/"s9-independent-known-positive-v1.json"
UNKNOWN=STATE/"s9-independent-unknown-far-v1.json"
MIN_KNOWN=100
MIN_KNOWN_PEOPLE=8
MIN_UNKNOWN=600

def need(condition, message):
    if not condition:raise ValueError(message)

def exact_nonnegative(value,key):
    need(type(value) is int and value>=0,"invalid_nonnegative_"+key)
    return value

def audit(q,k,u):
    need(all(type(v) is dict for v in (q,k,u)),"missing_evidence_document")
    refs=q.get("reference_count_by_folder")
    need(type(refs) is dict and len(refs)>0 and len(refs)<200,
         "reference_inventory_missing_or_corrupt")
    values=[exact_nonnegative(v,"per_folder_count") for v in refs.values()]
    historical=sum(values)
    archived_originals=exact_nonnegative(q.get("native_original_count"),
                                         "originals")
    need(historical<=archived_originals and archived_originals>0,
         "reference_source_exceeds_archive")
    unverified_unknown=exact_nonnegative(
        q.get("historical_unknown_review_candidates_not_validated_labels"),
        "historical_unknown_candidates")
    owner_unknown=exact_nonnegative(u.get("owner_labels"),
                                    "unknown_owner_labels")
    unrepresented=exact_nonnegative(
        u.get("postfreeze_unrepresented_owner_folder_sources"),
        "postfreeze_unrepresented_sources")
    future_known=exact_nonnegative(
        k.get("human_verified_future_positive_candidates"),
        "future_known_candidate_count")
    evaluated_known=exact_nonnegative(
        k.get("evaluated_source_disjoint_known_positives"),
        "evaluated_independent_known_count")
    distinct_days=exact_nonnegative(k.get("independent_capture_dates"),
                                    "independent_known_days")
    need(evaluated_known<=future_known and
         owner_unknown<=unrepresented,
         "validated_prospective_truth_exceeds_evidence_population")
    # Unknown source count is NOT the number of distinct verified people.
    known_evaluable=(
        k.get("independent_true_positive_validation_complete") is True
        and k.get("frozen_model_captured_before_positive_sources") is True
        and evaluated_known>=MIN_KNOWN and distinct_days>=2)
    unknown_evaluable=(
        u.get("unknown_population_FAR_validated") is True
        and u.get("separately_selected_thresholds_then_held_out_evaluated")
            is True
        and owner_unknown>=MIN_UNKNOWN
        and u.get("independent_known_positive_validation") is True)
    # Never manufacture a number of distinct known persons from source
    # bags. Requiring an externally audited distinct-person count is
    # stronger than a permissive folder number; the current metric has
    # no future-known distinct identity certificate.
    known_distinct_verified_persons=0
    independent_distinct_person_proven=False
    ready=(known_evaluable and unknown_evaluable and
           independent_distinct_person_proven and
           known_distinct_verified_persons>=MIN_KNOWN_PEOPLE and
           q.get("independent_known_positive_validated") is True and
           q.get("independent_unknown_FAR_validated") is True)
    reasons=[]
    if evaluated_known<MIN_KNOWN:reasons.append("MISSING_INDEPENDENT_FUTURE_KNOWN_POSITIVES")
    if owner_unknown<MIN_UNKNOWN:reasons.append("MISSING_VERIFIED_UNREPRESENTED_UNKNOWN_PEOPLE_EPISODES")
    if not independent_distinct_person_proven:
        reasons.append("INDEPENDENT_DISTINCT_KNOWN_PEOPLE_TRUTH_NOT_ATTESTED")
    if not known_evaluable:reasons.append("PROSPECTIVE_KNOWN_VALIDATION_NOT_COMPLETE")
    if not unknown_evaluable:reasons.append("UNKNOWN_FAR_VALIDATION_NOT_COMPLETE")
    need(not ready,"release_not_authorized_by_unattested_distinct_persons")
    return {
        "schema":"s9_r797_independent_known_unknown_truth_source_audit_v1",
        "result":"INDEPENDENT_PERSON_TRUTH_INSUFFICIENT",
        "original_archived_sha_sources":archived_originals,
        "historical_owner_verified_clean_reference_recordings":historical,
        "historical_clean_reference_folder_count":len(refs),
        "reference_count_distribution_anonymous":sorted(values),
        "historical_unknown_candidate_sources_not_labelled":unverified_unknown,
        "independently_evaluated_future_known_episodes":evaluated_known,
        "future_known_owner_verified_candidates":future_known,
        "independent_future_known_capture_days":distinct_days,
        "owner_labeled_unknown_person_sources":owner_unknown,
        "postfreeze_unrepresented_owner_folder_sources":unrepresented,
        "distinct_independently_attested_known_people":known_distinct_verified_persons,
        "required_independent_known_episodes":MIN_KNOWN,
        "required_distinct_independent_known_people":MIN_KNOWN_PEOPLE,
        "required_independent_unknown_episodes":MIN_UNKNOWN,
        "historical_reference_rows_count_as_prospective_known_truth":False,
        "unverified_unknown_candidates_count_as_unknown_truth":False,
        "relative_similarity_scores_count_as_ground_truth":False,
        "historical_source_separated_LOO_is_independent_prospective_trial":False,
        "independent_real_person_model_accuracy_proven":False,
        "independent_unknown_false_accept_rate_proven":False,
        "identity_or_face_embeddings_read":False,
        "people_folders_or_originals_modified":False,
        "automatic_people_folder_filing_authorized":False,
        "remaining_reasons":reasons
    }

def read_json(path):
    need(path.is_file() and not path.is_symlink() and
         30<=path.stat().st_size<=200_000,
         "missing_or_oversize_read_only_evidence_document")
    return json.loads(path.read_text(encoding="utf-8"))

def self_test():
    q={"reference_count_by_folder":{"anonymousA":4,"anonymousB":3,
                                    "anonymousC":2,"anonymousD":1,
                                    "anonymousE":1},
       "native_original_count":756,
       "historical_unknown_review_candidates_not_validated_labels":5,
       "independent_known_positive_validated":False,
       "independent_unknown_FAR_validated":False}
    k={"human_verified_future_positive_candidates":0,
       "evaluated_source_disjoint_known_positives":0,
       "independent_capture_dates":0,
       "independent_true_positive_validation_complete":False,
       "frozen_model_captured_before_positive_sources":True}
    u={"owner_labels":0,"postfreeze_unrepresented_owner_folder_sources":0,
       "unknown_population_FAR_validated":False,
       "separately_selected_thresholds_then_held_out_evaluated":False,
       "independent_known_positive_validation":False}
    x=audit(q,k,u)
    need(x["historical_owner_verified_clean_reference_recordings"]==11
         and x["independently_evaluated_future_known_episodes"]==0
         and x["owner_labeled_unknown_person_sources"]==0
         and x["automatic_people_folder_filing_authorized"] is False,
         "real-world_counts_misrepresented_in_fixture")
    count=0
    # More historical manual folder clips never become future known trials.
    v=dict(q,reference_count_by_folder={"a":700})
    x=audit(v,k,u);need(x["independently_evaluated_future_known_episodes"]==0,
                          "historical_reference_leaked_as_future");count+=1
    # Tentative unknown review candidates are NOT independently labelled.
    v=dict(q,historical_unknown_review_candidates_not_validated_labels=900)
    x=audit(v,k,u);need(x["owner_labeled_unknown_person_sources"]==0,
                        "unverified_unknown_leaked_as_truth");count+=1
    from copy import deepcopy
    for section,key,bad in (
        ("q","native_original_count",-1),
        ("q","reference_count_by_folder",None),
        ("q","historical_unknown_review_candidates_not_validated_labels",-1),
        ("k","human_verified_future_positive_candidates",-1),
        ("k","evaluated_source_disjoint_known_positives",1),
        ("u","owner_labels",1),
        ("u","postfreeze_unrepresented_owner_folder_sources",-1)
    ):
        a,b,c=deepcopy(q),deepcopy(k),deepcopy(u)
        {"q":a,"k":b,"u":c}[section][key]=bad
        try:audit(a,b,c)
        except ValueError:count+=1
        else:raise AssertionError("invalid_evidence_accepted_"+key)
    # Even high source counts and optimistic booleans cannot make a
    # fabricated independent distinct-person certificate appear.
    b=dict(k,human_verified_future_positive_candidates=120,
           evaluated_source_disjoint_known_positives=120,
           independent_capture_dates=10,
           independent_true_positive_validation_complete=True)
    c=dict(u,owner_labels=650,
           postfreeze_unrepresented_owner_folder_sources=650,
           unknown_population_FAR_validated=True,
           separately_selected_thresholds_then_held_out_evaluated=True,
           independent_known_positive_validation=True)
    a=dict(q,independent_known_positive_validated=True,
           independent_unknown_FAR_validated=True)
    need(audit(a,b,c)["automatic_people_folder_filing_authorized"] is False,
         "sources_incorrectly_promoted_to_independent_verified_persons")
    count+=1
    need(count==10,"unexpected_adversarial_case_count")
    print(json.dumps({
        "status":"R797_INDEPENDENT_TRUTH_INSPECTION_SYNTHETIC_PASS",
        "adversarial_cases":count,
        "real_identity_labels_accessed":0,
        "unknown_candidates_auto_labeled":False,
        "automatic_people_folder_filing_authorized":False
    },sort_keys=True))

def main():
    p=argparse.ArgumentParser()
    m=p.add_mutually_exclusive_group(required=True)
    m.add_argument("--self-test",action="store_true")
    m.add_argument("--audit-live",action="store_true")
    a=p.parse_args()
    if a.self_test:self_test()
    else:print(json.dumps(audit(read_json(QUALITY),
                                read_json(KNOWN),
                                read_json(UNKNOWN)),sort_keys=True))
if __name__=="__main__":main()
