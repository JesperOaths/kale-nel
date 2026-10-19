#!/usr/bin/env python3
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("s9_real_snapshot_v129",ROOT/"run-s9-yunet-one-snapshot-v129.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def test_separate_from_camera_and_recording(self):
  s=(ROOT/"run-s9-yunet-one-snapshot-v129.py").read_text()
  for forbidden in ("am force-stop","pm install","adb install","delete_original","assign_person","review_decide"):
   self.assertNotIn(forbidden,s)
  for required in ("s9-v3-archive-backfill.lock","face_crop_padded_context_only",
                   "snapshot_sha256","S9_YUNET_REAL_ONE_SNAPSHOT_SCREENED","originals_modified"):
   self.assertIn(required,s)
 def test_native_onnx_image_only_no_identity(self):
  j=(ROOT/"S9YuNetOneSnapshotMeasure.java").read_text()
  for required in ("BitmapFactory.decodeFile","PhoneYuNetLandmarkDecoder.decode",
                   "sha(img).equals(checksum)","new long[]{1,3,640,640}",
                   "identity_assigned","images_written"):
   self.assertIn(required,j)
  self.assertNotIn("FileOutputStream",j)
 def test_untrusted_filename_is_rejected(self):
  self.assertFalse(m.FILE.fullmatch("../face.jpg"))
  self.assertTrue(m.FILE.fullmatch("motion_1792000000000__r5full_pending__123_0.jpg"))
  self.assertFalse(m.FILE.fullmatch("motion_1792000000000__x__123_8.jpg"))
if __name__=="__main__":unittest.main(verbosity=2)
