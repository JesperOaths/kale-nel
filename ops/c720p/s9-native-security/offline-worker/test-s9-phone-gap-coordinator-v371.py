#!/usr/bin/env python3
"""Pure synthetic, deterministic: never import live C720P worker or launch adb."""
import importlib.util
import pathlib
import unittest

SOURCE=pathlib.Path(__file__).with_name("s9_phone_gap_coordinator_v371.py")
spec=importlib.util.spec_from_file_location("s9_phone_gap_v371",SOURCE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
HEX=lambda x:x*64

def row():
    return dict(clip_no="motion_1792095266692.mp4",
        source="s9_original_4k_microsd",source_bytes=48_831_739,
        source_sha256=HEX("a"),media_revision=HEX("b"),
        model_sha256=m.MODEL_SHA,
        native_pass="s9_onphone_36_samples_overlapping_tiles_v5",
        required_analysis=m.ANALYSIS,priority_reason="no_indexed_image",
        attempts=1,status="processing",lease_until=1240)

def receipt(r,requested,override=None):
    result={"schema":m.SCHEMA,"source":"s9_original_4k_microsd",
        "clip_no":r["clip_no"],"source_sha256":r["source_sha256"],
        "source_bytes":r["source_bytes"],"source_revision":r["media_revision"],
        "model_sha256":m.MODEL_SHA,"duration_ms":12_000,
        "one_frame_only":True,"host_attestation_required":True,
        "eligible_to_publish":False,"frame_requested_not_actual_pts":False,
        "originals_modified":False,"review_decisions_modified":False,
        "automatic_person_assignments":0,
        "sample":{"requested_time_ms":requested,"time_ms":requested+32,
            "decoded_pts_verified":True,
            "pts_source":"mediacodec_output_buffer_info",
            "state":"decoded","original_resolution":[3840,2160],
            "face_candidates":[]}}
    if override:override(result)
    return result

class CoordinatorTests(unittest.TestCase):
    def setUp(self):
        self.r=row()
        self.events=[]
        self.now=1000.
    def guard(self,r):self.events.append("guard")
    def source(self,r):self.events.append("source");return True
    def probe(self,r,at,budget):
        self.events.append(("probe",at))
        return receipt(r,at)
    def exercise(self,**overrides):
        return m.coordinate(self.r,12_000,guard=overrides.get("guard",self.guard),
          source_check=overrides.get("source",self.source),
          probe=overrides.get("probe",self.probe),
          clock=lambda:self.now,wall=lambda:self.now)
    def test_three_actual_pts_and_guards(self):
        record=self.exercise()
        self.assertEqual(record["analysis_version"],m.ANALYSIS)
        self.assertEqual([s["time_ms"] for s in record["samples"]],
                         [2032,6032,10032])
        self.assertEqual([x[1] for x in self.events if isinstance(x,tuple)],
                         [2000,6000,10000])
        self.assertEqual(self.events.count("guard"),7)
        self.assertEqual(self.events.count("source"),7)
    def test_partial_transport_not_result(self):
        count=[0]
        def bad(r,at,budget):
            count[0]+=1
            if count[0]==2:raise TimeoutError("offline")
            return receipt(r,at)
        with self.assertRaisesRegex(m.Deferred,"transport_interrupted"):
            self.exercise(probe=bad)
        self.assertEqual(count[0],2)
    def test_partial_invalid_timestamp_not_result(self):
        def bad(r,at,budget):
            return receipt(r,at,lambda z:z["sample"].update(
                {"time_ms":at+1000}))
        with self.assertRaisesRegex(m.Deferred,"decoded_timestamp"):
            self.exercise(probe=bad)
    def test_fabricated_seek_time_not_result(self):
        def bad(r,at,budget):
            return receipt(r,at,lambda z:z["sample"].update(
                {"pts_source":"unverified_retriever_seek"}))
        with self.assertRaises(m.Deferred):self.exercise(probe=bad)
    def test_wrong_original_refused(self):
        def bad(r,at,budget):
            return receipt(r,at,lambda z:z.update(source_revision=HEX("f")))
        with self.assertRaisesRegex(m.Revoked,"provenance_mismatch"):
            self.exercise(probe=bad)
    def test_priority_revoked_between_frames(self):
        n=[0]
        def source(r):
            n[0]+=1
            return n[0]<4
        with self.assertRaises(m.Revoked):
            self.exercise(source=source)
        self.assertEqual(len([e for e in self.events if isinstance(e,tuple)]),1)
    def test_lease_ends_before_third_frame(self):
        self.r["lease_until"]=1041
        with self.assertRaises(m.Deferred):
            self.exercise()
        self.assertEqual(len([e for e in self.events if isinstance(e,tuple)]),0)
    def test_thermal_guard_refuses_before_phone(self):
        def hot(r):raise m.Deferred("phone_thermal_exclusion")
        with self.assertRaises(m.Deferred):self.exercise(guard=hot)
        self.assertEqual(len([e for e in self.events if isinstance(e,tuple)]),0)
    def test_pending_queue_cannot_start(self):
        self.r["status"]="pending"
        with self.assertRaises(m.Deferred):self.exercise()
    def test_all_sample_times_unique_and_in_bounds(self):
        self.assertEqual(m.sample_times(12000),[2000,6000,10000])
        for duration in (1,300001):
            with self.assertRaises(m.Deferred):m.sample_times(duration)
    def test_identity_leakage_not_accepted(self):
        def unsafe(r,at,budget):
            return receipt(r,at,lambda z:z.update(
                automatic_person_assignments=1))
        with self.assertRaises(m.Revoked):self.exercise(probe=unsafe)
    def test_source_changed_final_guard(self):
        count=[0]
        def source(r):
            count[0]+=1
            return count[0]<7
        with self.assertRaises(m.Revoked):self.exercise(source=source)
        self.assertEqual(len([x for x in self.events if isinstance(x,tuple)]),3)

if __name__=="__main__":unittest.main()
