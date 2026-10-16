#!/usr/bin/env python3
"""Regressions for person-only movement review; no video or images used."""
import importlib.util
from pathlib import Path

CODE=Path(__file__).resolve().parents[1]/"s9-person-ml-v1/local-sd-catalog.py"
spec=importlib.util.spec_from_file_location("sd_catalog",CODE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def track(samples=4,peak=.9,aspect=.52,start=100,end=1600):
 return {"id":"Person 1","temporary_track_id":1,"sample_count":samples,
         "first_sample_ms":start,"last_sample_ms":end,
         "peak_detection_score":peak,"upper_clothing_colour":"blue",
         "cross_recording_identity":"not_attempted",
         "image_detector_box_aspect_ratio":aspect}
def manifest(t=None,category="single_person_repeated_candidate",hits=4,persons=1,labels=None):
 v=[track() if t is None else t]
 return {"anonymous_tracking_version":m.TRACK_VERSION,
         "anonymous_track_scope":"this_recording_only",
         "anonymous_tracks":v,"anonymous_track_count":len(v),
         "duration_ms":9000,"person_count":persons,
         "person_event_category":category,"person_frames_at_050":hits,
         "sampled_frame_count":10,"categories":labels or ["person"]}
def evidence(v):return m.anonymous_clip_metadata(v)

good=evidence(manifest())
assert good["person_track_count"]==1,good
assert good["person_track_review_count"]==0
assert good["person_tracks"][0]["id"]=="Person 1"
assert evidence(manifest(track(samples=1,start=100,end=100)))["rejected_object_track_count"]==1
assert evidence(manifest(track(peak=.55)))["rejected_object_track_count"]==1
assert evidence(manifest(track(aspect=3.2)))["rejected_object_track_count"]==1
assert evidence(manifest(persons=0))["person_track_count"]==0
assert evidence(manifest(category="no_person_model_detection"))["person_track_count"]==0
assert evidence(manifest(category="single_frame_person_candidate"))["person_track_review_count"]==1
assert evidence(manifest(hits=None))["person_track_review_count"]==1
assert evidence(manifest(hits=1))["person_track_review_count"]==1
assert evidence(manifest(hits=2,labels=["person","vehicle"]))["person_track_review_count"]==1
assert evidence(manifest(hits=4,labels=["person","vehicle"]))["person_track_count"]==1
v=manifest();v["anonymous_track_scope"]="all_recordings"
assert evidence(v)["anonymous_tracking_status"]=="invalid_tracking_scope"
v=manifest();v["anonymous_tracks"][0]["cross_recording_identity"]="known_person"
assert evidence(v)["anonymous_tracking_status"]=="invalid_tracking_manifest"
print("PERSON_ONLY_TRACK_EVIDENCE_V25_TESTS_PASS")
