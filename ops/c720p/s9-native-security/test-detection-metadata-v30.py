"""Meaningful whitelist and catalog-to-relay regression tests for staged correction."""
import copy
import importlib.util
import json
import math
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parent.parent/"s9-person-ml-v1"


def load(name):
    spec=importlib.util.spec_from_file_location(name.replace("-","_"),ROOT/name)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


class EvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog=load("local-sd-catalog.py");cls.proxy=load("s9_sd_proxy_extension.py")

    def manifest(self):
        return {"name":"motion_1791600000000.mp4","duration_ms":12000,"sampled_frame_count":2,
                "person_sample_timeline":[{"time_ms":1000,"people_at_050":1,"vehicles_at_050":0,"animals_at_050":0,"person_peak_score":.7339},
                                          {"time_ms":6000,"people_at_050":0,"vehicles_at_050":1,"animals_at_050":0,"person_peak_score":.20}]}

    def test_sampled_timeline_survives_catalog_and_relay(self):
        raw=self.manifest();row=self.catalog.safe_native_detection_stats(raw)
        served=self.proxy.detection_metrics(row)
        self.assertEqual(served["person_sample_timeline"],row["person_sample_timeline"])
        self.assertEqual(served["person_first_sample_ms"],1000)
        self.assertEqual(served["person_last_sample_ms"],1000)
        self.assertEqual(served["person_sample_timeline"][0]["person_peak_score"],.734)

    def test_untrusted_points_cannot_inject_or_falsify_timing(self):
        for key,value in (("time_ms",True),("time_ms",12001),("people_at_050",65),("person_peak_score",math.nan)):
            raw=self.manifest();raw["person_sample_timeline"][0][key]=value
            result=self.catalog.safe_native_detection_stats(raw)
            self.assertEqual(result["person_timeline_status"],"invalid_sample_timeline")
            self.assertEqual(result["person_sample_timeline"],[])
        raw=self.manifest();raw["person_sample_timeline"][1]["time_ms"]=1000
        self.assertEqual(self.catalog.safe_native_detection_stats(raw)["person_sample_timeline"],[])
        raw=self.manifest();raw["person_sample_timeline"][0]["private_identity"]="secret"
        self.assertNotIn("private_identity",json.dumps(self.catalog.safe_native_detection_stats(raw)))

    def test_missing_timeline_is_distinct_from_sampled_zero_people(self):
        self.assertEqual(self.catalog.safe_native_detection_stats({})["person_timeline_status"],"not_in_original_review")
        raw=self.manifest()
        for point in raw["person_sample_timeline"]:point["people_at_050"]=0
        value=self.catalog.safe_native_detection_stats(raw)
        self.assertEqual(value["person_timeline_status"],"sampled_model_evidence")
        self.assertIsNone(value["person_first_sample_ms"])

    def test_segment_lineage_survives_relay_without_unsafe_previous_path(self):
        row={"name":"motion_1791600000000.mp4","capture_evidence_status":"recording_segment_verified",
             "capture_event_id":"garden_1791500000000","capture_segment_index":2,"capture_previous_segment":"motion_1791500000000.mp4",
             "capture_segment_transition":"max_duration_continuation","capture_segment_gap_ms":1500}
        self.assertEqual(self.proxy.detection_metrics(row)["capture_event_id"],row["capture_event_id"])
        row["capture_previous_segment"]="../../private.mp4"
        self.assertNotIn("capture_event_id",self.proxy.detection_metrics(row))

    def test_candidate_without_verified_jpeg_is_not_a_saved_snapshot(self):
        raw={"name":"motion_1791600000000.mp4","face_review_version":"s9_face_review_v1","face_review_status":"review_complete_unverified_matches",
             "face_review_sampled_frames":3,"face_candidates":[{"time_ms":1000,"match_status":"new_anonymous_candidate","person_id":"unknown_00001"}]}
        result=self.catalog.safe_face_review_metadata(raw)
        self.assertEqual(len(result["face_candidates"]),1)
        self.assertEqual(result["face_snapshots_saved"],0)

    def test_thumbnail_revision_is_a_bounded_digest_not_an_arbitrary_url(self):
        self.assertEqual(self.proxy.detection_metrics({"thumbnail_sha256":"a"*64})["thumbnail_revision"],"a"*16)
        self.assertEqual(self.proxy.detection_metrics({"thumbnail_revision":"b"*16})["thumbnail_revision"],"b"*16)
        for value in ("../../secret",True,"https://example.test", "A"*16):
            self.assertIsNone(self.proxy.detection_metrics({"thumbnail_revision":value})["thumbnail_revision"])


if __name__=="__main__":unittest.main()
