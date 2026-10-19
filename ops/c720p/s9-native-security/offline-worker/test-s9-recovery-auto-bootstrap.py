#!/usr/bin/env python3
"""Recovery DEX is staged only after a real one-sided source artifact."""
from pathlib import Path
import hashlib
import importlib.util
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("s9_recovery_bootstrap",ROOT/"run-s9-v3-resumable-archive.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class S9:
    ROOT="/data/local/tmp/s9_worker"
    def __init__(self,clip,crop,metadata,jar):
        key=hashlib.sha256(("s9_sd\x00"+clip).encode()).hexdigest()
        self.crop=self.ROOT+"/inbox/"+key+".jpg"
        self.metadata=self.ROOT+"/features/"+key+"-detector.json"
        self.jar=self.ROOT+"/s9-offline-person-roi-recovery-v3.jar"
        self.present=set()
        if crop:self.present.add(self.crop)
        if metadata:self.present.add(self.metadata)
        if jar:self.present.add(self.jar)
        self.transport_error=False
    def readiness(self):
        if self.transport_error:
            raise RuntimeError("Camera readiness unavailable")
        return "9341",31.0
    def adb(self,*args,**kwargs):
        if args[0]!="shell" or not args[1].startswith("test -s "):
            raise AssertionError("Unexpected ADB operation")
        if self.transport_error:
            return SimpleNamespace(returncode=1,stderr="device offline",stdout="")
        path=args[1][len("test -s "):]
        return SimpleNamespace(returncode=0 if path in self.present else 1,
                               stdout="",stderr="")

class Tests(unittest.TestCase):
    def test_no_install_for_clean_new_or_fully_verified_source(self):
        clip="motion_1700000000000.mp4"
        with patch.object(m,"run_worker") as runner:
            self.assertFalse(m.prepare_partial_recovery(S9(clip,False,False,False),clip))
            self.assertFalse(m.prepare_partial_recovery(S9(clip,True,True,False),clip))
            self.assertFalse(m.prepare_partial_recovery(S9(clip,True,False,True),clip))
            runner.assert_not_called()

    def test_partial_crop_only_bootstraps_and_validates_install(self):
        clip="motion_1700000001000.mp4"
        phone=S9(clip,True,False,False)
        record={"no_camera_apk_changes":True,
                "no_recording_changes":True,
                "no_review_changes":True,
                "dex_sha256":"a"*64,
                "new_worker_files":["s9-offline-person-roi-recovery-v3.jar"]}
        def fake_runner(filename,args,marker,timeout):
            self.assertEqual(filename,"install-s9-roi-partial-recovery-v3.py")
            self.assertEqual(args,["--install"])
            self.assertEqual(marker,"S9_ROI_PARTIAL_RECOVERY_V3_INSTALLED")
            phone.present.add(phone.jar)
            return record
        with patch.object(m,"run_worker",side_effect=fake_runner) as runner:
            self.assertTrue(m.prepare_partial_recovery(phone,clip))
            self.assertEqual(runner.call_count,1)
            self.assertFalse(m.prepare_partial_recovery(phone,clip))
            self.assertEqual(runner.call_count,1)

    def test_missing_camera_integrity_flags_fail_closed(self):
        clip="motion_1700000002000.mp4"
        phone=S9(clip,False,True,False)
        with patch.object(m,"run_worker",return_value={
                "no_camera_apk_changes":False,"no_recording_changes":True,
                "no_review_changes":True,"dex_sha256":"a"*64}):
            with self.assertRaisesRegex(RuntimeError,"not verified"):
                m.prepare_partial_recovery(phone,clip)

    def test_phone_unavailable_is_not_missing_evidence(self):
        clip="motion_1700000003000.mp4"
        phone=S9(clip,True,False,False)
        phone.transport_error=True
        with patch.object(m,"run_worker") as runner:
            with self.assertRaisesRegex(RuntimeError,"transport"):
                m.prepare_partial_recovery(phone,clip)
            runner.assert_not_called()

if __name__=="__main__":unittest.main(verbosity=2)
