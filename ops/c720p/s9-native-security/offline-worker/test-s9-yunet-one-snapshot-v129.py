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
   with self.assertRaisesRegex(RuntimeError,"^s9_yunet_phone_launcher_exit_137$") as got:
    m.call(argv,seconds=2)
  self.assertNotIn("sensitive-info",str(got.exception))
  self.assertNotIn("private-details",str(got.exception))
 def test_non_launcher_or_other_exit_keeps_generic_failure(self):
  cases=(
   (["adb","-s","test-device","shell","sha256sum /safe/model"],137),
   (["adb","-s","test-device","shell","app_process /system/bin Class"],1),
   (["javac","-version"],137),
  )
  for argv,code in cases:
   with self.subTest(argv=argv[0],code=code):
    result=m.subprocess.CompletedProcess(argv,code,"output","stderr")
    with patch.object(m.subprocess,"run",return_value=result):
     with self.assertRaisesRegex(RuntimeError,"^separate_phone_operation_failed$"):
      m.call(argv,seconds=2)
if __name__=="__main__":main(verbosity=2)
