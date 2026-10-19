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

 def test_every_camera_admission_blocker_is_distinct_and_no_image_access(self):
  import json
  good={"ok":True,"mode":"watching","native_4k_enabled":True,
        "continuous_4k_ready":True,
        "continuous_4k_dropped_output_frames":0,
        "continuous_4k_error":None,"temperature_c":31.1,
        "continuous_4k_buffered_ms":8995,
        "recording_active":False,"recording_in_progress":False,
        "face_backfill_queued":False,"appearance_backfill_queued":False,
        "historical_import_queued":False}
  class Reply:
   status=200
   def __init__(self,obj):self.payload=json.dumps(obj).encode()
   def __enter__(self):return self
   def __exit__(self,*args):pass
   def read(self,n):return self.payload[:n]
  with patch.object(m.urllib.request,"urlopen",return_value=Reply(good)):
   self.assertEqual(m.current_camera()["temperature_c"],31.1)
  cases=(
   ({"continuous_4k_ready":False},"native_4k_pipeline_unhealthy"),
   ({"continuous_4k_dropped_output_frames":1},"native_4k_pipeline_unhealthy"),
   ({"temperature_c":37.5},"native_4k_temperature_guard"),
   ({"continuous_4k_buffered_ms":2000},"native_4k_buffer_not_ready"),
   ({"recording_in_progress":True},"native_4k_recording_in_progress"),
   ({"recording_active":True},"native_4k_recording_in_progress"),
   ({"face_backfill_queued":True},"s9_background_work_queued"),
   ({"appearance_backfill_queued":True},"s9_background_work_queued"),
   ({"historical_import_queued":True},"s9_background_work_queued"),
  )
  for changes,why in cases:
   with self.subTest(why=why,changes=changes),patch.object(
        m.urllib.request,"urlopen",return_value=Reply(dict(good,**changes))):
    with self.assertRaisesRegex(m.Stop,"^"+why+"$"):
     m.current_camera()
  source=SRC.read_text()
  for reason in ("native_4k_pipeline_unhealthy","native_4k_temperature_guard",
                 "native_4k_buffer_not_ready","native_4k_recording_in_progress",
                 "s9_background_work_queued"):
   self.assertIn(reason,source)
 def test_native_library_path_mode_keeps_one_tiny_launch_and_no_model(self):
  path=m.WORKER+"/safe-class.jar"
  with patch.object(m,"adb",return_value=SimpleNamespace(
       returncode=0,stdout=m.EXPECTED,stderr="")) as shell:
   report=m.launch(path,True)
  self.assertTrue(report["success"])
  shell.assert_called_once()
  cmd=shell.call_args.args[1]
  self.assertIn("export LD_LIBRARY_PATH="+m.LIBS+";",cmd)
  self.assertIn("-Djava.library.path="+m.LIBS+" ",cmd)
  self.assertIn("--baseline-no-image",cmd)
  for forbidden in ("face_five_point","motion_","FaceSnapshots/","--audit-single",
                    "S9YuNetSingleSnapshotAudit"):
   self.assertNotIn(forbidden,cmd)
  with patch.object(m,"adb",return_value=SimpleNamespace(
       returncode=137,stdout="",stderr="Killed")) as shell:
   bad=m.launch(path,True)
  self.assertEqual(bad,{"success":False,"reason":"android_baseline_terminated"})
  shell.assert_called_once()

 def test_native_env_run_path_does_not_repeat_art_launch(self):
  import io,contextlib,tempfile
  health={"temperature_c":31.1,"continuous_4k_dropped_output_frames":0}
  with tempfile.TemporaryDirectory() as tmp:
   lock=Path(tmp)/"lock";lock.write_text("")
   with patch.object(m,"LOCK",lock),patch.object(m,"current_camera",return_value=health), \
        patch.object(m,"must_adb",side_effect=["device","SM-G965F","1","1"]), \
        patch.object(m,"build",return_value=Path(tmp)/"fake.jar"), \
        patch.object(m,"stage",return_value=m.WORKER+"/fake.jar"), \
        patch.object(m,"launch",return_value={"success":True,"reason":"java_baseline_pass"}) as launch:
    report=m.run(native_env=True)
   launch.assert_called_once_with(m.WORKER+"/fake.jar",True)
   self.assertTrue(report["native_library_path_enabled"])
   self.assertEqual(report["launch_attempts"],1)
   self.assertFalse(report["model_or_image_opened"])
if __name__=="__main__":unittest.main(verbosity=2)
