#!/usr/bin/env python3
"""Synthetic proof of bounded no-image Java baseline and 4K capture priority."""
import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent
SRC=ROOT/"probe-s9-app-process-noimage-v166.py"
spec=importlib.util.spec_from_file_location("s9_noimage_v166",SRC)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Tests(unittest.TestCase):
 def test_one_launch_marker_and_phone_failure_are_not_face_evidence(self):
  jar=m.WORKER+"/safe.jar"
  for code,stdout,stderr,expected in (
   (0,m.EXPECTED,"","java_baseline_pass"),
   (137,"","Killed","android_baseline_terminated"),
   (-9,"","","android_baseline_terminated"),
   (1,"","private-photo.jpg","java_baseline_not_verified")):
   with self.subTest(code=code):
    with patch.object(m,"adb",return_value=SimpleNamespace(
         returncode=code,stdout=stdout,stderr=stderr)) as adb:
     result=m.launch(jar)
    self.assertEqual(result["reason"],expected)
    self.assertEqual(result["success"],expected=="java_baseline_pass")
    self.assertEqual(adb.call_count,1)
    self.assertEqual(adb.call_args.args[0],"shell")
    self.assertIn("--baseline-no-image",adb.call_args.args[1])
    self.assertNotIn("private",str(result))

 def test_process_timeout_never_leaks_android_command(self):
  with patch.object(m.subprocess,"run",side_effect=m.subprocess.TimeoutExpired(
     ["adb","shell","a-private-image.jpg"],8)):
   with self.assertRaisesRegex(m.Stop,"bounded_build_or_phone_operation_failed") as e:
    m.call(["adb","shell","a-private-image.jpg"],seconds=8)
  self.assertNotIn("private-image",str(e.exception))

 def test_failed_baseline_must_recheck_4k_and_pid_before_reporting(self):
  health={"temperature_c":31.4,"continuous_4k_dropped_output_frames":0}
  with tempfile.TemporaryDirectory() as tmp:
   lock=Path(tmp)/"worker.lock";lock.write_text("")
   report=io.StringIO()
   with patch.object(m,"LOCK",lock),patch.object(m,"current_camera",return_value=health) as camera, \
        patch.object(m,"must_adb",side_effect=["device","SM-G965F","123","123"]) as adb, \
        patch.object(m,"build",return_value=Path(tmp)/"fake.jar") as build, \
        patch.object(m,"stage",return_value="/data/local/tmp/s9_worker/fake.jar") as stage, \
        patch.object(m,"launch",return_value={"success":False,
          "reason":"android_baseline_terminated"}) as launch, \
        contextlib.redirect_stdout(report):
    m.main()
   self.assertEqual(camera.call_count,4)
   self.assertEqual(adb.call_count,4)
   self.assertEqual(build.call_count,1)
   self.assertEqual(stage.call_count,1)
   self.assertEqual(launch.call_count,1)
   data=report.getvalue()
   self.assertIn('"status":"physical_baseline_checked"',data)
   self.assertIn('"android_java_baseline_started":false',data)
   self.assertIn('"camera_pid_unchanged":true',data)
   self.assertIn('"launch_attempts":1',data)
   self.assertIn('"yu_net_inference_executed":false',data)

 def test_changed_native_camera_pid_forbids_success(self):
  health={"temperature_c":31.2,"continuous_4k_dropped_output_frames":0}
  with tempfile.TemporaryDirectory() as tmp:
   lock=Path(tmp)/"lock";lock.write_text("")
   with patch.object(m,"LOCK",lock),patch.object(m,"current_camera",return_value=health), \
        patch.object(m,"must_adb",side_effect=["device","SM-G965F","123","987"]), \
        patch.object(m,"build",return_value=Path(tmp)/"fake.jar"), \
        patch.object(m,"stage",return_value="/data/local/tmp/s9_worker/fake.jar"), \
        patch.object(m,"launch",return_value={"success":True,"reason":"java_baseline_pass"}):
    with self.assertRaisesRegex(m.Stop,"native_camera_pid_changed_after_baseline"):
     m.run()

 def test_untrusted_or_partial_stage_preserved_not_overwritten(self):
  with tempfile.TemporaryDirectory() as tmp:
   jar=Path(tmp)/"worker.jar";jar.write_bytes(b"known")
   with patch.object(m,"exists",side_effect=[False,True]), \
        patch.object(m,"must_adb") as adb:
    with self.assertRaisesRegex(m.Stop,"unknown_pending_minimal_worker"):
     m.stage(jar)
    adb.assert_not_called()

 def test_build_java_has_no_biometric_camera_or_model_code(self):
  java=(ROOT/"S9AppProcessNoImageBaselineV166.java").read_text()
  self.assertIn("S9_APP_PROCESS_NO_IMAGE_BASELINE_V166_OK",java)
  self.assertIn("--baseline-no-image",java)
  for bad in ("import android.", "import ai.", "OrtEnvironment",
              "CameraManager","BitmapFactory","new File(","Files.write",
              "System.loadLibrary","getSystemService"):
   self.assertNotIn(bad,java)
  source=SRC.read_text()
  for bad in ("adb install","pm install","am force-stop","shutil.rmtree",
              "os.unlink(","delete_original","review_decide"):
   self.assertNotIn(bad,source)
  self.assertIn("fcntl.LOCK_EX|fcntl.LOCK_NB",source)
  self.assertIn('return {"success":False,"reason":"android_baseline_terminated"}',source)
  self.assertIn("capture_dropped_output_frames_after",source)

if __name__=="__main__":unittest.main(verbosity=2)
