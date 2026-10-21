#!/usr/bin/env python3
"""Regression-only: one verified photo, no activity/identity/archive mutation."""
import importlib.util
from pathlib import Path
import json
import tempfile
from unittest import TestCase,main
from unittest.mock import patch
ROOT=Path(__file__).resolve().parent
SOURCE=ROOT/"run-s9-yunet-one-snapshot-v129.py"
spec=importlib.util.spec_from_file_location("one_face_v129",SOURCE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
SHA="a"*64
CLIP="motion_1792200000000.mp4"
JPG="motion_1792200000000__r5full_unknown_00001__1000_0.jpg"
def document(**changes):
 item={"snapshot":JPG,"snapshot_sha256":SHA,
       "snapshot_size_bytes":15000,"face_crop_requires_manual_review":True}
 item.update(changes)
 return {"schema_version":"s9_native_archive_catalog_v1","records":{
  CLIP:{"name":CLIP,"manifest":{"face_candidates":[item]}}}}
class Tests(TestCase):
 def one(self,doc):
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory)/"catalog.json";path.write_text(json.dumps(doc))
   with patch.object(m,"CATALOG",path):
    return m.select()
 def test_one_valid_verified_snapshot_selected(self):
  selected,n=self.one(document())
  self.assertEqual(selected,(JPG,SHA));self.assertEqual(n,1)
 def test_padded_context_is_not_usable_as_alignment_source(self):
  with self.assertRaisesRegex(RuntimeError,"no_source_qualified"):
   self.one(document(face_crop_padded_context_only=True))
 def test_filename_cannot_escape_phone_face_folder(self):
  with self.assertRaisesRegex(RuntimeError,"no_source_qualified"):
   self.one(document(snapshot="../private.jpg"))
 def test_bad_or_unknown_sha_cannot_run(self):
  with self.assertRaisesRegex(RuntimeError,"no_source_qualified"):
   self.one(document(snapshot_sha256="0"))
 def test_mismatched_clip_does_not_mix_two_people(self):
  with self.assertRaisesRegex(RuntimeError,"no_source_qualified"):
   self.one(document(snapshot="motion_1792200000001__r5full_unknown_00001__1000_0.jpg"))
 def test_clipped_and_abnormally_large_file_excluded(self):
  for size in (-1,1,2200000,"50000"):
   with self.subTest(size=size),self.assertRaisesRegex(RuntimeError,"no_source_qualified"):
    self.one(document(snapshot_size_bytes=size))
 def test_byte_for_byte_readonly_commitment(self):
  src=SOURCE.read_text();java=(ROOT/"S9YuNetSingleSnapshotAudit.java").read_text()
  for expected in ("LOCK_EX|fcntl.LOCK_NB","camera_pid_changed_after_one_snapshot",
    "PhoneYuNetLandmarkDecoder.java","phone_face_snapshot_manifest_digest_mismatch",
    "candidate_image_tested","pixels_sent_to_hub","detector_valid_face_count"):
   self.assertIn(expected,src)
  for banned in ("pm install","am force-stop","adb install","delete_original",
    "review_decide","auto_assign_person","apply_assignment","write_image"):
   self.assertNotIn(banned,src)
  for banned in ("Bitmap.compress","FileOutputStream","new FileWriter",
    "knownFaces","assignPerson","FaceRecognizerSF","capture_session"):
   self.assertNotIn(banned,java)
  self.assertIn("image[i]=p&255;",java)
  self.assertIn("image[n*2+i]=(p>>>16)&255;",java)
  self.assertIn("model.getParent()",java)
 def test_java_snapshot_name_cannot_escape_directory(self):
  java=(ROOT/"S9YuNetSingleSnapshotAudit.java").read_text()
  self.assertIn("cleanName(args[1])",java)
  self.assertIn("snapshot_sha256_drift",java)
  self.assertIn("not_native_square_face_snapshot",java)
 def test_failed_android_launcher_exit_137_is_distinct_and_private(self):
  # Synthetic shell output must never leak into a failed one-face audit log.
  argv=["adb","-s","test-device","shell",
        "app_process /system/bin nl.kalenel.s9offline.S9YuNetSingleSnapshotAudit"]
  result=m.subprocess.CompletedProcess(argv,137,"Killed sensitive-info","private-details")
  with patch.object(m.subprocess,"run",return_value=result):
   with self.assertRaisesRegex(RuntimeError,"^android_app_process_terminated_without_face_evidence$") as got:
    m.call(argv,seconds=2)
  self.assertNotIn("sensitive-info",str(got.exception))
  self.assertNotIn("private-details",str(got.exception))
 def test_non_launcher_or_other_exit_keeps_generic_failure(self):
  cases=(
   (["adb","-s","test-device","shell","sha256sum /safe/model"],137),
   (["javac","-version"],137),
  )
  for argv,code in cases:
   with self.subTest(argv=argv[0],code=code):
    result=m.subprocess.CompletedProcess(argv,code,"output","stderr")
    with patch.object(m.subprocess,"run",return_value=result):
     with self.assertRaisesRegex(RuntimeError,"^separate_phone_operation_failed$"):
      m.call(argv,seconds=2)
 def test_android_nonzero_specific_reason_codes_are_private(self):
  name="motion_1792200000000__a_private_person__1000_0.jpg"
  argv=["adb","-s","test-device","shell",
        "export CLASSPATH=/safe/x; app_process -Djava.library.path=/safe /system/bin FaceAudit --audit-single "+name]
  cases=(
   ("java.lang.ClassNotFoundException: "+name,"face_app_process_missing_java_class_unverified"),
   ("java.lang.UnsatisfiedLinkError: "+name,"face_app_process_native_library_unavailable_unverified"),
   ("java.lang.SecurityException: "+name,"face_app_process_android_storage_denied_unverified"),
   ("java.lang.IllegalArgumentException: not_native_square_face_snapshot "+name,
    "face_app_process_bitmap_decoder_unavailable_unverified"),
   ("ai.onnxruntime.OrtException: "+name,"face_app_process_model_runtime_exception_unverified"),
   ("java.lang.IllegalArgumentException: unknown "+name,
    "face_app_process_java_uncategorized_exception_unverified"),
   ("random failure text "+name,"face_app_process_nonzero_unclassified_unverified"),
  )
  for output,expected in cases:
   with self.subTest(reason=expected):
    process=m.subprocess.CompletedProcess(argv,1,"",output)
    with patch.object(m.subprocess,"run",return_value=process),self.assertRaisesRegex(
       RuntimeError,"^"+expected+"$") as got:
     m.call(argv,seconds=5)
    self.assertNotIn(name,str(got.exception))
    self.assertNotIn("private_person",str(got.exception))
 def test_android_exit_137_sigkill_and_explicit_killed_are_not_face_evidence(self):
  from types import SimpleNamespace
  private="private_face_filename_must_not_be_logged.jpg"
  argv=["adb","-s","test-device","shell",
        "export CLASSPATH=/safe/model; app_process -Djava.library.path=/safe /system/bin Test "+private]
  for code,stdout,stderr in ((137,"",""),(-9,"",""),(1,"","Killed "+private)):
   with self.subTest(code=code):
    process=SimpleNamespace(returncode=code,stdout=stdout,stderr=stderr)
    with patch.object(m.subprocess,"run",return_value=process), \
         self.assertRaisesRegex(RuntimeError,"^android_app_process_terminated_without_face_evidence$") as raised:
     m.call(argv,seconds=5)
    self.assertNotIn(private,str(raised.exception))
  # sha256sum and non-Android failures cannot be mislabeled as detector errors.
  argv[-1]="sha256sum /safe/test-app_process.jar"
  with patch.object(m.subprocess,"run",return_value=SimpleNamespace(
       returncode=137,stdout="",stderr="Killed")):
   with self.assertRaisesRegex(RuntimeError,"^separate_phone_operation_failed$"):
    m.call(argv,seconds=5)

 def test_terminated_phone_worker_defers_only_after_4k_health_and_pid_verified(self):
  import io,sys,contextlib,tempfile
  health={"temperature_c":32.2,"continuous_4k_dropped_output_frames":0}
  with tempfile.TemporaryDirectory() as temp:
   lock=Path(temp)/"worker.lock"
   output=io.StringIO()
   with patch.object(m,"LOCK",lock),patch.object(m,"current_camera",side_effect=[health,health]) as probe, \
        patch.object(m,"select",return_value=(("private.jpg","a"*64),1)), \
        patch.object(m,"adb",return_value="123") as adb, \
        patch.object(m,"build",return_value=Path(temp)/"fake.jar"), \
        patch.object(m,"execute",side_effect=RuntimeError(
            "android_app_process_terminated_without_face_evidence")), \
        patch.object(sys,"argv",["worker","--apply"]),contextlib.redirect_stdout(output):
    m.main()
   self.assertEqual(probe.call_count,2)
   self.assertEqual(adb.call_count,2)
   result=output.getvalue()
   self.assertIn("S9_YUNET_REAL_ONE_SNAPSHOT_DEFERRED",result)
   self.assertIn('"detector_inference_verified": false',result)
   self.assertIn('"native_camera_ready_after": true',result)
   self.assertIn('"camera_dropped_output_frames_after": 0',result)
   self.assertNotIn("private.jpg",result)

 def test_termination_with_changed_camera_pid_cannot_claim_safe_defer(self):
  import io,sys,contextlib,tempfile
  health={"temperature_c":32.2,"continuous_4k_dropped_output_frames":0}
  with tempfile.TemporaryDirectory() as temp:
   out=io.StringIO()
   with patch.object(m,"LOCK",Path(temp)/"worker.lock"), \
        patch.object(m,"current_camera",return_value=health), \
        patch.object(m,"select",return_value=(("private.jpg","a"*64),1)), \
        patch.object(m,"adb",side_effect=["123","567"]), \
        patch.object(m,"build",return_value=Path(temp)/"fake.jar"), \
        patch.object(m,"execute",side_effect=RuntimeError(
            "android_app_process_terminated_without_face_evidence")), \
        patch.object(sys,"argv",["worker","--apply"]), \
        contextlib.redirect_stdout(out):
    with self.assertRaisesRegex(RuntimeError,"camera_pid_changed_after_yunet_termination"):
     m.main()
   self.assertNotIn("S9_YUNET_REAL_ONE_SNAPSHOT_DEFERRED",out.getvalue())
 def test_subprocess_timeout_never_exposes_snapshot_name_or_command(self):
  private="motion_1792200000000__private-name__1000_0.jpg"
  cmd=["adb","-s","test-device","shell","app_process --audit-single "+private]
  with patch.object(m.subprocess,"run",side_effect=m.subprocess.TimeoutExpired(cmd,5,output=private.encode())):
   with self.assertRaisesRegex(RuntimeError,"^phone_or_build_operation_timeout_no_private_detail$") as got:
    m.call(cmd,seconds=5)
  self.assertNotIn(private,str(got.exception))
  self.assertIsNone(got.exception.__cause__)
if __name__=="__main__":main(verbosity=2)
