#!/usr/bin/env python3
"""Synthetic privacy, low-duty, camera priority checks; never calls a phone."""
import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent
SPEC=importlib.util.spec_from_file_location(
 "yunet_launch_environment_v165",ROOT/"audit-s9-yunet-launcher-v165.py")
m=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(m)

class Audit(unittest.TestCase):
 def test_healthy_read_only_probe_returns_no_private_identifiers(self):
  with tempfile.TemporaryDirectory() as tmp:
   lock=Path(tmp)/"worker.lock";lock.write_text("")
   good={"temperature_c":32.1,"continuous_4k_dropped_output_frames":0}
   with patch.object(m,"LOCK",lock),patch.object(m,"health",return_value=good) as camera, \
        patch.object(m,"adb",return_value=SimpleNamespace(returncode=0,stdout="device")) as phone, \
        patch.object(m,"shell_text",side_effect=[
            "SM-G965F","321","arm64-v8a","Enforcing","321"]) as shell, \
        patch.object(m,"phone_test",side_effect=[True,True,False,True]) as tests, \
        patch.object(m,"log_summary",return_value={"status":"unavailable"}):
    report=m.audit()
   self.assertEqual(report["status"],"verified_readonly")
   self.assertTrue(report["camera_pid_unchanged"])
   self.assertEqual(camera.call_count,2)
   self.assertEqual(tests.call_count,4)
   self.assertEqual(shell.call_count,5)
   self.assertEqual(phone.call_count,1)
   self.assertTrue(report["environment"]["system_app_process64_executable"])
   self.assertFalse(report["environment"]["onnxruntime_native_library_present"])
   self.assertFalse(report["app_process_invoked"])
   self.assertFalse(report["model_or_image_read"])
   self.assertFalse(report["recordings_modified"])

 def test_camera_pid_change_refuses_success(self):
  with tempfile.TemporaryDirectory() as tmp:
   lock=Path(tmp)/"lock";lock.write_text("")
   with patch.object(m,"LOCK",lock),patch.object(m,"health",return_value={
        "temperature_c":32,"continuous_4k_dropped_output_frames":0}), \
        patch.object(m,"adb",return_value=SimpleNamespace(returncode=0,stdout="device")), \
        patch.object(m,"shell_text",side_effect=[
            "SM-G965F","321","arm64-v8a","Enforcing","322"]), \
        patch.object(m,"phone_test",return_value=True), \
        patch.object(m,"log_summary",return_value={"status":"unavailable"}):
    with self.assertRaisesRegex(m.Stop,"native_camera_pid_changed"):
     m.audit()

 def test_busy_camera_blocks_phone_calls(self):
  with tempfile.TemporaryDirectory() as tmp:
   lock=Path(tmp)/"lock";lock.write_text("")
   with patch.object(m,"LOCK",lock),patch.object(m,"health",side_effect=m.Stop(
        "s9_capture_busy_hot_or_unhealthy")),patch.object(m,"adb") as phone:
    with self.assertRaises(m.Stop):m.audit()
    phone.assert_not_called()

 def test_only_fixed_phone_paths_can_be_metadata_probed(self):
  with patch.object(m,"adb") as phone:
   with self.assertRaisesRegex(m.Stop,"untrusted_probe_path"):
    m.phone_test("/sdcard/private/person.jpg")
   phone.assert_not_called()
  with patch.object(m,"adb",return_value=SimpleNamespace(
       returncode=1,stderr="",stdout="")):
   self.assertFalse(m.phone_test(m.LIBS+"/libonnxruntime4j_jni.so"))

 def test_raw_private_logcat_never_returned(self):
  raw="FATAL EXCEPTION secret-person-1\nUnsatisfiedLinkError person-2\n"
  with patch.object(m,"adb",return_value=SimpleNamespace(
      returncode=0,stdout=raw,stderr="")):
   report=m.log_summary()
  self.assertEqual(report["counts"]["java_fatal"],1)
  self.assertEqual(report["counts"]["native_dependency"],1)
  self.assertNotIn("person-1",str(report))
  self.assertNotIn("person-2",str(report))
  self.assertTrue(report["not_attributable_to_yunet"])

 def test_main_exception_redacts_private_details_and_exits_nonzero(self):
  output=io.StringIO()
  with patch.object(m,"audit",side_effect=RuntimeError(
      "private person's filename.jpg : adb command")),contextlib.redirect_stdout(output):
   with self.assertRaises(SystemExit) as ex:m.main()
  self.assertEqual(ex.exception.code,1)
  self.assertNotIn("person\x27s filename.jpg",output.getvalue())
  self.assertIn('"app_process_invoked":false',output.getvalue())

 def test_read_only_source_has_no_camera_model_or_mutation_calls(self):
  text=(ROOT/"audit-s9-yunet-launcher-v165.py").read_text()
  for command in ("adb push","am force-stop","pm install","unlink(", "shutil.rmtree",
                  "app_process -D", "onnxruntime.InferenceSession","torch.load",
                  "cv2.imread","adb shell rm","os.remove("):
   self.assertNotIn(command,text)
  self.assertIn("fcntl.LOCK_SH|fcntl.LOCK_NB",text)
  self.assertIn("native_camera_pid_changed",text)
  self.assertIn("phone_test",text)

if __name__=="__main__":unittest.main(verbosity=2)
