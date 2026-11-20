#!/usr/bin/env python3
"""R810 independent, read-only gate for UNAPPROVED S9 full-4K face proposals.

This is an audit, NOT person identification. An existing owner-approved
source produces anonymous face proposals using R809. Its 4K original bytes
remain on the phone. No face images, identity embeddings or folder IDs are
read from the receipt, and no reference can be auto-enrolled.

Specific missing proof: the underlying MediaMetadataRetriever image does NOT
have independently attested exact decoded presentation timestamp, even if the
original clip hash was verified. Candidate person identity also has no
independent ground truth. These are separate mandatory release blockers.
"""
from __future__ import annotations
import argparse,json,math,pathlib,re,sys

BASE=pathlib.Path("/home/jespern/c720p-home-hub/staging/recognition-r744-ain-small-model-assets-20261120/r809_true4k_face_pixel_candidate_shadow/runs")
SHA=re.compile(r"^[a-f0-9]{64}$")

def need(v,why):
    if not v:raise ValueError(why)

def source_only(record):
    need(type(record) is dict and
         record.get("status")=="UNAPPROVED_S9_FACE_CANDIDATES_ONLY" and
         record.get("face_gallery_enrolled")==0,
         "not_a_private_unenrolled_face_shadow_receipt")
    rec=record.get("face_receipt")
    need(type(rec) is dict and rec.get("schema")==
         "S9_OWNER_SOURCE_FACE_CANDIDATE_SHADOW_V1",
         "unexpected_phone_face_receipt_version")
    need(rec.get("manifest_sha256")==record.get("manifest_sha256") and
         type(record.get("manifest_sha256")) is str and
         SHA.fullmatch(record["manifest_sha256"]),
         "owner_approved_source_manifest_digest_mismatch")
    need(rec.get("r809_true_native_4k_bitmap_decoding") is True and
         rec.get("r809_max_source_frames")==2 and
         rec.get("r808_unapproved_review_only_score_cutoff")==0.82 and
         rec.get("r808_production_thresholds_unchanged") is True,
         "not_frozen_review_only_native4k_source")
    need(rec.get("automatic_face_gallery_enrollment")==0 and
         rec.get("automatic_folder_assignments")==0 and
         rec.get("no_person_identification_performed") is True and
         rec.get("owner_review_required") is True and
         rec.get("r805_no_automatic_identity_enrollment") is True,
         "automatic_person_filing_or_identity_enrollment_requested")
    frames=rec.get("decoded_original_frames")
    heads=rec.get("attempted_head_regions")
    need(type(frames) is int and 1<=frames<=2 and
         type(heads) is int and 0<=heads<=2 and heads<=frames,
         "source_frame_processing_exceeds_two_frame_limit")
    candidates=rec.get("unapproved_face_candidates")
    need(type(candidates) is list and len(candidates)<=heads,
         "unapproved_face_candidate_count_mismatch")
    scores=[];eyes=[]
    for p in candidates:
        need(type(p) is dict and
             p.get("actual_decoded_video_pts_verified") is False and
             p.get("owner_verified_identity_of_face") is False and
             p.get("face_model_assigned_folder") is False and
             type(p.get("source_sha256")) is str and
             SHA.fullmatch(p["source_sha256"]) and
             type(p.get("candidate_face_sha256")) is str and
             SHA.fullmatch(p["candidate_face_sha256"]),
             "no_independently_certified_identity_or_exact_pts")
        score=p.get("face_score");eye=p.get("detected_eye_spacing_px_2k_head_roi")
        need(type(score) in (int,float) and math.isfinite(score) and
             0.82<=score<=1 and type(eye) in (int,float) and
             math.isfinite(eye) and eye>=18,
             "review_proposal_does_not_meet_frozen_geometric_minimum")
        scores.append(score);eyes.append(eye)
    obs=record.get("camera_observation")
    need(type(obs) is dict and
         type(obs.get("minimum_fps")) in (int,float) and
         obs["minimum_fps"]>=29 and
         type(obs.get("maximum_temp")) in (int,float) and
         obs["maximum_temp"]<38,
         "camera_safe_source_decode_not_qualified")
    return {
       "schema":"s9_r810_unapproved_native4k_face_candidate_release_refusal_v1",
       "status":"UNAPPROVED_FACE_CANDIDATES_AWAIT_INDEPENDENT_PTS_AND_IDENTITY",
       "original_source_4k_frames_decoded_on_phone":frames,
       "approved_head_regions_examined":heads,
       "unapproved_private_phone_only_proposals":len(candidates),
       "proposal_score_min":round(min(scores),4) if scores else None,
       "proposal_score_max":round(max(scores),4) if scores else None,
       "minimum_eye_spacing_px":round(min(eyes),2) if eyes else None,
       "proposal_frame_exact_pts_independently_verified_count":0,
       "proposal_owner_identity_independently_verified_count":0,
       "independent_known_positive_test_episodes_added":0,
       "independent_unknown_person_test_episodes_added":0,
       "candidate_images_transferred_or_read":0,
       "existing_verified_reference_gallery_modified":False,
       "source_originals_or_camera_app_modified":False,
       "automatic_people_folder_filing_authorized":False,
    }

def self_test():
    sha="a"*64
    c={"actual_decoded_video_pts_verified":False,
       "owner_verified_identity_of_face":False,
       "face_model_assigned_folder":False,
       "source_sha256":sha,"candidate_face_sha256":"b"*64,
       "face_score":.84,"detected_eye_spacing_px_2k_head_roi":22}
    record={
       "status":"UNAPPROVED_S9_FACE_CANDIDATES_ONLY",
       "manifest_sha256":sha,"face_gallery_enrolled":0,
       "camera_observation":{"minimum_fps":30.02,"maximum_temp":32.5},
       "face_receipt":{
         "schema":"S9_OWNER_SOURCE_FACE_CANDIDATE_SHADOW_V1",
         "manifest_sha256":sha,"r809_true_native_4k_bitmap_decoding":True,
         "r809_max_source_frames":2,
         "r808_unapproved_review_only_score_cutoff":.82,
         "r808_production_thresholds_unchanged":True,
         "automatic_face_gallery_enrollment":0,
         "automatic_folder_assignments":0,
         "no_person_identification_performed":True,
         "owner_review_required":True,
         "r805_no_automatic_identity_enrollment":True,
         "decoded_original_frames":2,
         "attempted_head_regions":2,
         "unapproved_face_candidates":[c,dict(c,candidate_face_sha256="c"*64)],
       }}
    valid=source_only(record)
    need(valid["unapproved_private_phone_only_proposals"]==2 and
         valid["automatic_people_folder_filing_authorized"] is False,
         "valid_unapproved_receipt_was_rejected")
    from copy import deepcopy
    bad=(
      ("auto_folder",lambda r:r["face_receipt"].update(automatic_folder_assignments=1)),
      ("auto_gallery",lambda r:r.update(face_gallery_enrolled=1)),
      ("no_label_cert",lambda r:r["face_receipt"]["unapproved_face_candidates"][0].update(owner_verified_identity_of_face=True)),
      ("no_pts_cert",lambda r:r["face_receipt"]["unapproved_face_candidates"][0].update(actual_decoded_video_pts_verified=True)),
      ("pseudo_face",lambda r:r["face_receipt"]["unapproved_face_candidates"][0].update(face_score=.3)),
      ("small_eyes",lambda r:r["face_receipt"]["unapproved_face_candidates"][0].update(detected_eye_spacing_px_2k_head_roi=12)),
      ("not_original_4k",lambda r:r["face_receipt"].update(r809_true_native_4k_bitmap_decoding=False)),
      ("wrong_source",lambda r:r["face_receipt"].update(manifest_sha256="d"*64)),
      ("too_many_frames",lambda r:r["face_receipt"].update(decoded_original_frames=3)),
      ("camera_regressed",lambda r:r["camera_observation"].update(minimum_fps=10)),
      ("too_many_candidates",lambda r:r["face_receipt"].update(attempted_head_regions=1)),
    )
    failures=0
    for name,fn in bad:
        broken=deepcopy(record);fn(broken)
        try:source_only(broken)
        except ValueError:failures+=1
        else:raise AssertionError("unsafe_source_promotion_"+name)
    need(failures==len(bad),"not_all_provenance_abstentions_passed")
    print(json.dumps({
       "status":"R810_UNAPPROVED_FULL4K_FACE_CANDIDATE_GUARD_SYNTHETIC_PASS",
       "adversarial_cases":failures,
       "unapproved_candidate_input_fixture":2,
       "independent_verified_faces_assumed":0,
       "new_automations_or_background_services":0,
       "automatic_identity_filing_authorized":False},sort_keys=True))

def run():
    files=sorted(BASE.glob("phone_face_*.json"))
    need(files and len(files)<=100,"private_face_receipt_population_missing")
    summaries=[]
    for f in files:
        need(not f.is_symlink() and 100<=f.stat().st_size<=20_000 and
             f.stat().st_mode&0o077==0,
             "face_receipt_permissions_or_size_invalid")
        summaries.append(source_only(json.loads(f.read_text())))
    print(json.dumps({
       "schema":"s9_r810_unapproved_full4k_face_proposal_population_v1",
       "result":"RESEARCH_FACE_PROPOSALS_ONLY_NOT_KNOWN_UNKNOWN_TRUTH",
       "source_receipts_audited":len(summaries),
       "unapproved_candidate_count":sum(x["unapproved_private_phone_only_proposals"] for x in summaries),
       "independent_exact_native_frame_pts_attestations":0,
       "independent_verified_known_identity_episodes":0,
       "independent_verified_unknown_person_episodes":0,
       "automatic_filing_authorized":False},sort_keys=True))

if __name__=="__main__":
    cli=argparse.ArgumentParser()
    modes=cli.add_mutually_exclusive_group(required=True)
    modes.add_argument("--self-test",action="store_true")
    modes.add_argument("--audit-live",action="store_true")
    args=cli.parse_args()
    if args.self_test:self_test()
    else:run()
