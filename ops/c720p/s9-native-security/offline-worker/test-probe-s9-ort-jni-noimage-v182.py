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

    def test_deferred_camera_admission_fails_job_not_false_success(self):
        import contextlib,io,json
        from unittest.mock import patch
        reasons=("s9_background_work_queued","native_4k_recording_in_progress",
                 "native_4k_temperature_guard","native_4k_buffer_not_ready",
                 "native_4k_pipeline_unhealthy","noimage_ort_dex_compile_failed")
        for reason in reasons:
            with self.subTest(reason=reason):
                output=io.StringIO()
                with patch.object(m,"load_guard",return_value=object()),\
                     patch.object(m,"run",side_effect=RuntimeError(reason)),\
                     contextlib.redirect_stdout(output),\
                     self.assertRaises(SystemExit) as stopped:
                    m.main()
                self.assertEqual(stopped.exception.code,1)
                result=json.loads(output.getvalue().split(m.MARK,1)[1])
                self.assertEqual(result["status"],"deferred")
                self.assertEqual(result["reason"],reason)
                self.assertEqual(result["launch_attempts"],0)
                self.assertEqual(result["face_images_read"],0)
                self.assertEqual(result["models_loaded"],0)

    def test_untrusted_exception_is_redacted_and_fails(self):
        import contextlib,io,json
        from unittest.mock import patch
        output=io.StringIO()
        private="private-face-identifier.mp4"
        with patch.object(m,"load_guard",return_value=object()),\
             patch.object(m,"run",side_effect=RuntimeError(private)),\
             contextlib.redirect_stdout(output),\
             self.assertRaises(SystemExit) as stopped:
            m.main()
        self.assertEqual(stopped.exception.code,1)
        self.assertNotIn(private,output.getvalue())
        self.assertIn("unverified_no_private_detail",output.getvalue())

    def test_only_a_completed_probe_can_succeed(self):
        import contextlib,io,json
        from unittest.mock import patch
        result={"status":"one_native_bootstrap_checked",
                "native_ort_environment_started":False,"launch_attempts":1,
                "reason":"native_ort_environment_terminated","models_loaded":0,
                "face_images_read":0,"camera_pid_unchanged":True}
        output=io.StringIO()
        with patch.object(m,"load_guard",return_value=object()),\
             patch.object(m,"run",return_value=result),\
             contextlib.redirect_stdout(output):
            m.main()
        self.assertIn("one_native_bootstrap_checked",output.getvalue())
if __name__=="__main__":unittest.main(verbosity=2)
