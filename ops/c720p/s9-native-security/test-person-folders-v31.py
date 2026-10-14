#!/usr/bin/env python3
"""Person folders cannot drift, merge overlapping people, or infer unmeasured gait."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def load():
    spec = importlib.util.spec_from_file_location("person_folders_test", HERE / "s9_person_folders_v31.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def track(idx=1, first=1000, last=4000, **kwargs):
    return {"id": f"Person {idx}", "temporary_track_id": idx, "first_sample_ms": first,
            "last_sample_ms": last, "sample_count": 4, "peak_detection_score": .94,
            "upper_clothing_colour": "blue", **kwargs}


def row(name="motion_1791600000000.mp4", tracks=None, faces=None):
    return {"name": name, "sd_verified": True, "duration_ms": 10000,
            "anonymous_tracking_status": "sampled_tracks_available", "anonymous_tracks": tracks or [track()],
            "face_review_status": "review_complete_unverified_matches", "face_gallery_epoch": "a" * 64,
            "face_candidates": faces or []}


def face(alias="unknown_00001", ms=2000, **kwargs):
    return {"person_id": alias, "time_ms": ms, "match_status": "anonymous_similarity_unverified",
            "cosine_similarity": .93, **kwargs}


class PersonFolderTests(unittest.TestCase):
    def test_actual_phone_pose_schema_and_missing_cadence(self):
        module=load()
        pose={"version":"projected_pose_motion_v1","posture":"projected_upright",
              "posture_availability":"available","mean_confidence":.91,"torso_samples":8,
              "apparent_speed_body_heights_per_second":.4,"gait_availability":"available_projected_ankle_cycle",
              "cadence_steps_per_minute":120}
        result=module.metrics(track(pose_metrics=pose))
        self.assertEqual(result["posture"],"projected_upright")
        self.assertEqual(result["normalized_speed"],.4)
        self.assertEqual(result["cadence_hz"],2)
        pose["gait_availability"]="insufficient_dense_full_body_samples"
        self.assertIsNone(module.metrics(track(pose_metrics=pose))["cadence_hz"])

    def setUp(self):
        self.module = load()
        self.temp = tempfile.TemporaryDirectory()
        self.module.STORE = Path(self.temp.name) / "folders.json"
        self.module.AUDIT = Path(self.temp.name) / "audit.jsonl"
        self.a = "motion_1791600000000.mp4"
        self.b = "motion_1791600100000.mp4"
        self.c = "motion_1791600200000.mp4"
        self.source = {self.a: row(self.a), self.b: row(self.b), self.c: row(self.c)}
        self.module._source_rows = lambda: self.source
        self.key = self.a + ":track:1"

    def tearDown(self):
        self.temp.cleanup()

    def write(self, action, key=None, pid=None, name=None):
        return self.module.review(action, key, pid, name, True)

    def test_private_verified_native_tracks_only(self):
        self.source[self.b]["sd_verified"] = False
        self.source[self.c]["anonymous_tracks"][0]["temporary_track_id"] = True
        self.source["../../escape.mp4"] = row()
        result = self.module.observations()
        self.assertEqual(list(result), [self.key])

    def test_group_faces_without_track_association_stay_unattached(self):
        self.source[self.a] = row(self.a, [track(1), track(2)], [face()])
        entries = self.module.observations()
        self.assertTrue(all(not o["face_evidence"] for o in entries.values()))
        self.source[self.a]["face_candidates"][0]["temporary_track_id"] = 2
        entries = self.module.observations()
        self.assertEqual(entries[self.a + ":track:2"]["face_evidence"][0]["person_id"], "unknown_00001")
        self.assertEqual(entries[self.key]["face_evidence"], [])

    def test_snapshot_only_and_low_similarity_do_not_support_face_match(self):
        self.source[self.a]["face_candidates"] = [face(cosine_similarity=.5)]
        self.source[self.b]["face_candidates"] = [face()]
        self.source[self.b]["face_review_status"] = "face_embedding_unavailable_snapshots_only"
        self.assertTrue(all(not self.module.aliases(o) for o in self.module.observations().values()))

    def test_matching_same_track_number_clothing_and_direction_is_not_identity(self):
        for item in self.source.values():
            item["anonymous_tracks"][0]["image_movement_direction"] = "image_left"
        self.write("create", self.key, name="Garden visitor")
        result = self.module.report()
        self.assertEqual(result["suggestions"], [])
        self.assertEqual(result["summary"]["confirmed_appearances"], 1)

    def test_missing_pose_and_sparse_fake_cadence_stay_unknown(self):
        self.source[self.a]["anonymous_tracks"][0].update(gait_cadence_hz=1.6, gait_cadence_status="sampled_12_frames")
        metrics = self.module.observations()[self.key]["metrics"]
        self.assertIsNone(metrics["posture"])
        self.assertIsNone(metrics["normalized_speed"])
        self.assertIsNone(metrics["cadence_hz"])
        self.assertEqual(metrics["cadence_status"], "unknown")

    def test_complementary_measured_pose_motion_only_suggest_review(self):
        for item in self.source.values():
            item["anonymous_tracks"][0]["pose_metrics"] = {"posture_label": "upright", "posture_confidence": .9,
                "pose_observations": 5, "movement_speed_body_lengths_per_second": .5}
        self.write("create", self.key, name="Visitor")
        suggestions = self.module.report()["suggestions"]
        self.assertEqual(len(suggestions), 2)
        self.assertTrue(all(s["strength"] == "appearance_motion_review_only" and s["human_review_required"] and
                            not s["confirmed_identity"] for s in suggestions))
        self.assertEqual(self.module.registry()["links"].keys(), {self.key})

    def test_face_supported_candidate_folders_are_automatic_but_tentative(self):
        for item in self.source.values():
            item["face_candidates"] = [face()]
        result = self.module.report()
        self.assertEqual(len(result["candidates"]), 1)
        candidate = result["candidates"][0]
        self.assertEqual(candidate["recording_count"], 3)
        self.assertTrue(candidate["human_review_required"])
        self.assertFalse(candidate["confirmed_identity"])
        self.assertFalse(self.module.STORE.exists())

    def test_face_epoch_changes_or_missing_prevent_cross_recording_group(self):
        for item in self.source.values():
            item["face_candidates"] = [face()]
            item.pop("face_gallery_epoch")
        self.assertEqual(len(self.module.report()["candidates"]), 3)
        self.source[self.a]["face_gallery_epoch"] = "a" * 64
        self.source[self.b]["face_gallery_epoch"] = "b" * 64
        self.write("create", self.key, name="Visitor")
        self.assertEqual(self.module.report()["suggestions"], [])

    def test_human_links_persist_and_rename_does_not_change_recordings(self):
        before = json.dumps(self.source, sort_keys=True)
        status, result = self.write("create", self.key, name="First name")
        self.assertEqual(status, 200)
        pid = result["profile_id"]
        self.write("link", self.b + ":track:1", pid)
        self.write("rename", pid=pid, name="New name")
        report = self.module.report()
        self.assertEqual(report["profiles"][0]["name"], "New name")
        self.assertEqual(report["profiles"][0]["recording_count"], 2)
        self.assertEqual(json.dumps(self.source, sort_keys=True), before)
        self.assertEqual(len(self.module.AUDIT.read_text().splitlines()), 3)
        self.assertEqual(self.write("unlink", self.b + ":track:1")[0], 200)
        self.assertEqual(self.module.report()["profiles"][0]["recording_count"], 1)

    def test_overlapping_people_cannot_join_one_confirmed_profile(self):
        self.source[self.a]["anonymous_tracks"].append(track(2))
        _, created = self.write("create", self.key, name="Visitor")
        status, error = self.write("link", self.a + ":track:2", created["profile_id"])
        self.assertEqual(status, 409)
        self.assertEqual(error["error"], "overlapping_tracks_cannot_share_person_folder")

    def test_bad_alias_group_collision_requires_individual_review(self):
        self.source[self.a] = row(self.a, [track(1), track(2)],
            [face(temporary_track_id=1), face(temporary_track_id=2)])
        groups = self.module.report()["candidates"]
        self.assertEqual(groups[0]["association_status"], "ambiguous_face_alias")

    def test_rejected_candidate_is_suppressed_until_explicit_relink(self):
        for item in self.source.values():
            item["face_candidates"] = [face()]
        _, created = self.write("create", self.key, name="Visitor")
        pid = created["profile_id"]
        self.assertEqual(len(self.module.report()["suggestions"]), 2)
        self.write("reject", self.b + ":track:1", pid)
        self.assertEqual(len(self.module.report()["suggestions"]), 1)
        self.write("link", self.b + ":track:1", pid)
        self.assertNotIn(pid, self.module.registry()["rejections"][self.b + ":track:1"])

    def test_competing_confirmed_profiles_make_suggestion_ambiguous(self):
        for item in self.source.values():
            item["face_candidates"] = [face()]
        self.write("create", self.key, name="A")
        self.write("create", self.b + ":track:1", name="B")
        suggestions = self.module.report()["suggestions"]
        self.assertEqual(len(suggestions), 2)
        self.assertTrue(all(s["ambiguous"] for s in suggestions))

    def test_reanalysis_cannot_silently_move_or_relearn_confirmed_track(self):
        for item in self.source.values():
            item["face_candidates"] = [face()]
        self.write("create", self.key, name="Visitor")
        self.source[self.a]["anonymous_tracks"][0]["last_sample_ms"] = 9000
        result = self.module.report()
        profile = result["profiles"][0]
        self.assertEqual(profile["observations"][0]["association_status"], "source_changed_needs_review")
        self.assertEqual(profile["confirmed_appearance_count"], 0)
        self.assertEqual(result["suggestions"], [])

    def test_api_does_not_expose_vectors_landmarks_or_paths(self):
        self.source[self.a]["anonymous_tracks"][0].update(appearance_vector=[.1] * 48, embedding=[.2] * 128,
            pose_keypoints=[[0, 0, .9]] * 17, local_path="/private/test")
        serialized = json.dumps(self.module.report())
        for forbidden in ("appearance_vector", "embedding", "pose_keypoints", "local_path", "signature"):
            self.assertNotIn(forbidden, serialized)

    def test_invalid_registry_is_preserved(self):
        self.module.STORE.write_text("broken", encoding="utf-8")
        self.assertFalse(self.module.report()["ok"])
        self.assertEqual(self.write("create", self.key, name="Visitor")[0], 503)
        self.assertEqual(self.module.STORE.read_text(), "broken")

    def test_failed_audit_rolls_back_registry(self):
        before = self.module.registry()
        with mock.patch.object(self.module, "audit_line", side_effect=OSError("full")):
            self.assertEqual(self.write("create", self.key, name="Visitor")[0], 503)
        self.assertEqual(self.module.registry(), before)

    def test_http_route_requires_exact_review_intent_and_shape(self):
        class Handler:
            def __init__(self, path="/new/api/person-folders/review", headers=None, body=b"{}"):
                self.path, self.headers, self.rfile = path, headers or {}, io.BytesIO(body)
                self.result = None
            def go(self):
                self.result = (404, {})
            def do_POST(self):
                self.result = (404, {})
            def js(self, status, body):
                self.result = (status, body)
        self.module.install(Handler, lambda: self.source)
        request = Handler()
        request.do_POST()
        self.assertEqual(request.result[0], 403)
        body = json.dumps({"action": "create", "observation_key": self.key, "profile_id": None,
                           "name": "Visitor", "human_confirmed": True}).encode()
        headers = {"X-S9-Person-Folder-Intent": "explicit-review-v31", "Content-Type": "application/json",
                   "Content-Length": str(len(body)), "Origin": "http://jesper-hub.local:8123"}
        request = Handler(headers=headers, body=body)
        request.do_POST()
        self.assertEqual(request.result[0], 200)
        request = Handler(headers={**headers, "Origin": "https://evil.example"}, body=body)
        request.do_POST()
        self.assertEqual(request.result[0], 403)
        request = Handler(path="/new/api/person-folders")
        request.go()
        self.assertEqual(request.result[0], 200)
        self.assertEqual(request.result[1]["summary"]["profiles"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
