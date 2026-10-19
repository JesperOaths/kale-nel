#!/usr/bin/env python3
"""No-device original provenance recovery tests for S9 partial private ROI cache."""
from pathlib import Path
import hashlib
import importlib.util
import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location(
    "s9_roi_recovery_controller",ROOT/"backfill-s9-original-roi-osnet-temporal-v2.py")
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)

class FakeS9:
    def __init__(self,clip,has_crop,has_detector,damaged=False):
        self.clip=clip
        self.has_crop=has_crop
        self.has_detector=has_detector
        self.damaged=damaged
        self.called_recovery=0
        self.key=hashlib.sha256(("s9_sd\x00"+clip).encode()).hexdigest()
        self.meta={
            "schema":"s9_offline_single_person_roi_v1","source":"s9_sd",
            "source_clip":clip,"source_qualified_key":self.key,
            "detector_sha256":worker.DETECT_SHA,
            "crop_sha256":"b"*64,
            "identity_verified":False,"requires_human_review":True}
        self.visual={
            "schema":"s9_offline_appearance_embedding_v1",
            "source_qualified_key":self.key,
            "crop_sha256":"b"*64,"model_sha256":worker.OSNET_SHA,
            "model_type":"visual","appearance_only":True,
            "human_review_required":True,"verified_same_person":False,
            "visual_embedding":[1.0]+[0.0]*511}
    def result(self,stdout="",returncode=0):
        return SimpleNamespace(stdout=stdout,stderr="",returncode=returncode)
    def call(self,*args,**kwargs):
        mode=args[0]
        target=args[1] if len(args)>1 else ""
        if mode=="shell" and target.startswith("test -s "):
            path=target.split("test -s ",1)[1]
            if path.endswith(".jpg"):return self.result(returncode=0 if self.has_crop else 1)
            if path.endswith("-detector.json"):return self.result(returncode=0 if self.has_detector else 1)
            if path.endswith("-visual.json"):return self.result()
            if path.endswith("s9-offline-person-roi-recovery-v3.jar"):return self.result()
        if mode=="shell" and target.startswith("sha256sum "):
            return self.result(("c" if self.damaged else "b")*64+"  "+target)
        if mode=="shell" and "S9StandalonePersonRoiRecoveryV3 --recover" in target:
            self.called_recovery+=1
            self.has_crop=True;self.has_detector=True
            return self.result("S9_OFFLINE_ROI_PARTIAL_REPAIRED source_verified=true")
        if mode=="exec-out" and args[1]=="cat":
            return self.result(json.dumps(self.meta if args[2].endswith("-detector.json")
                                          else self.visual))
        raise AssertionError("Unexpected S9 call "+str(args))

class Recovery(unittest.TestCase):
    def test_immutable_java_recovery_only_recreates_missing_artifact(self):
        java=(ROOT/"S9StandalonePersonRoiRecoveryV3.java").read_text()
        setup=(ROOT/"install-s9-roi-partial-recovery-v3.py").read_text()
        for item in ("jpegPresent!=metaPresent",
                     "Partial ROI repair requires exactly one missing private artifact",
                     "reconstructed.equals(approved.optString(\"crop_sha256\"))",
                     "reconstructed.equals(hash(jpeg))",
                     "S9_OFFLINE_ROI_PARTIAL_REPAIRED",
                     "Already processed: no overwrite"):
            if item!="Already processed: no overwrite":
                self.assertIn(item,java,item)
        for item in ("Files.isSymbolicLink(jpeg)",
                     "Files.isSymbolicLink(metadata)",
                     "requires_human_review",
                     "source_qualified_key",
                     "source_clip"):
            self.assertIn(item,java,item)
        self.assertIn("S9StandalonePersonRoiRecoveryV3.java",setup)
        self.assertIn("s9-offline-person-roi-recovery-v3.jar",setup)
        for forbidden in ("pm install","am force-stop","delete_original","review_decide"):
            self.assertNotIn(forbidden,java)
            self.assertNotIn(forbidden,setup)

    def test_metadata_exists_roi_missing_recovers_before_old_vector(self):
        clip="motion_1700000000000.mp4"
        fake=FakeS9(clip,False,True)
        with patch.object(worker,"adb",side_effect=fake.call):
            self.assertEqual(worker.compute_one(clip),"already_verified")
        self.assertEqual(fake.called_recovery,1)

    def test_orphan_roi_without_metadata_is_recovered_only_by_independent_worker(self):
        clip="motion_1700000001000.mp4"
        fake=FakeS9(clip,True,False)
        with patch.object(worker,"adb",side_effect=fake.call):
            self.assertEqual(worker.compute_one(clip),"already_verified")
        self.assertEqual(fake.called_recovery,1)

    def test_both_present_but_corrupt_roi_never_counts_as_verified(self):
        clip="motion_1700000002000.mp4"
        fake=FakeS9(clip,True,True,damaged=True)
        with patch.object(worker,"adb",side_effect=fake.call):
            with self.assertRaisesRegex(RuntimeError,"integrity mismatch"):
                worker.compute_one(clip)
        self.assertEqual(fake.called_recovery,0)

if __name__=="__main__":unittest.main(verbosity=2)
