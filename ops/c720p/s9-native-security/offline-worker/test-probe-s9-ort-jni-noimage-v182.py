#!/usr/bin/env python3
"""No phone or person image needed for native ORT-loader diagnosis tests."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import re
import unittest
from unittest.mock import Mock
ROOT=Path(__file__).resolve().parent
src=ROOT/"probe-s9-ort-jni-noimage-v182.py"
spec=importlib.util.spec_from_file_location("s9_v182",src)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def simulated(code,text="",err=""):
    o=SimpleNamespace(returncode=code,stdout=text,stderr=err)
    return SimpleNamespace(
       WORKER="/data/local/tmp/s9_worker",SHA=re.compile("[a-f0-9]{64}"),
       Stop=RuntimeError,
       phone_digest=lambda p:"a"*64,
       require=lambda ok,msg:None if ok else (_ for _ in ()).throw(RuntimeError(msg)),
       adb=lambda *a,**kw:o)

class Tests(unittest.TestCase):
    def test_valid_noimage_native_environment(self):
        r=m.launch_once(simulated(0,m.EXPECTED),"/tmp/good.jar")
        self.assertEqual(r,{"success":True,"reason":"native_ort_environment_initialized"})
    def test_android_137_failure_is_not_claimed_as_success(self):
        r=m.launch_once(simulated(137,"","Killed"),"/tmp/good.jar")
        self.assertEqual(r["reason"],"native_ort_environment_terminated")
        self.assertFalse(r["success"])
    def test_loader_failure_is_distinct_from_art_failure(self):
        r=m.launch_once(simulated(1,"","java.lang.UnsatisfiedLinkError: xyz"),
                         "/tmp/good.jar")
        self.assertEqual(r["reason"],"native_ort_java_dependency_error")
    def test_wrong_marker_does_not_pass(self):
        self.assertFalse(m.launch_once(simulated(0,"different"),"/tmp/good.jar")["success"])
    def test_missing_native_library_fails_closed_before_launch(self):
        guard=simulated(0,m.EXPECTED)
        guard.phone_digest=lambda _: "bad"
        with self.assertRaises(RuntimeError):
            m.launch_once(guard,"/tmp/good.jar")
    def test_diagnostics_require_no_model_or_any_face(self):
        py=src.read_text()
        java=(ROOT/"S9OrtJniNoImageV182.java").read_text()
        self.assertIn("models_loaded",py)
        self.assertIn("face_images_read",py)
        self.assertIn("launch_attempts",py)
        for invalid in ("OrtSession", "OnnxTensor", "Bitmap", "FaceRecognizer",
                        "FileOutputStream","ImageReader","Camera2"):
            self.assertNotIn(invalid,java)
        for invalid in ("rm -rf","pm install","am force-stop","video.unlink",
                        "review_decide","/Security4K/FaceSnapshots/"):
            self.assertNotIn(invalid,py)
    def test_thermal_gate_and_shared_lock_reused(self):
        py=src.read_text()
        self.assertIn("guard.current_camera()",py)
        self.assertIn("guard.LOCK.open",py)
        self.assertIn("camera_pid_changed_after_probe",py)
        self.assertIn("official_ort_aar_sha_changed",py)

if __name__=="__main__":unittest.main(verbosity=2)
