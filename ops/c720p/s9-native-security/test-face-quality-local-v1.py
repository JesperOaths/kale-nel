#!/usr/bin/env python3
"""Offline, no-image tests for in-memory S9 face-image quality audit."""
import hashlib
import importlib.util
from pathlib import Path
import unittest
P=Path(__file__).with_name("audit-face-quality-local-v1.py")
spec=importlib.util.spec_from_file_location("s9_face_quality",P)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
CLIP="motion_1792338420826.mp4"
NAME="motion_1792338420826__pending_1__2000_0.jpg"
BODY=b"\xff\xd8"+b"A"*321+b"\xff\xd9"
def catalog(sha=None):
 return {"archive_mode":"S9-microSD-only","events":[{
   "clip_no":CLIP,"face_candidates":[{
     "snapshot_name":NAME,
     "snapshot_sha256":sha or hashlib.sha256(BODY).hexdigest()}]}]}
class Quality(unittest.TestCase):
 def test_valid_hash_and_bounded_bytes_yield_only_aggregate(self):
  src=m.sources(catalog())
  seen=[]
  def reader(uri,limit,timeout):
   seen.append(uri);return BODY
  q=m.analyse(src,reader,lambda raw:(96,110,65,30,80))
  self.assertEqual(q["status"],"complete")
  self.assertEqual(q["native_side_bins"]["under_112px_model_input"],1)
  self.assertEqual(q["edge_variance_bins"]["medium_edge_variance"],1)
  self.assertEqual(q["brightness_bins"]["dim"],1)
  self.assertFalse(q["recognition_accuracy_validated"])
  self.assertFalse(q["raw_frames_written"])
  self.assertFalse(any(NAME in str(item) for item in q.values()))
  self.assertTrue(seen[0].startswith(m.PREFIX))
 def test_reject_mismatched_sha_without_blurring_provenance(self):
  src=m.sources(catalog("c"*64))
  q=m.analyse(src,lambda *a:BODY,lambda raw:(120,120,90,50,140))
  self.assertEqual(q["source_errors"]["jpeg_source_sha_mismatch"],1)
  self.assertEqual(q["decoded_verified"],0)
 def test_catalog_rejects_wrong_clip_and_duplicate_face(self):
  a=catalog();a["events"][0]["face_candidates"][0]["snapshot_name"]="other.jpg"
  with self.assertRaises(ValueError):m.sources(a)
  a=catalog();a["events"][0]["face_candidates"].append(
     dict(a["events"][0]["face_candidates"][0]))
  with self.assertRaises(ValueError):m.sources(a)
 def test_unknown_catalog_disallowed(self):
  with self.assertRaisesRegex(ValueError,"verified_archive"):
   m.sources({"archive_mode":"other","events":[]})
 def test_quality_bins_are_descriptive_not_biometric_thresholds(self):
  self.assertEqual(m.quality_bins(110,35,11,20),
                  ("under_112px_model_input","very_dark","low_edge_variance","low_contrast"))
  self.assertEqual(m.quality_bins(240,221,40,140),
                  ("at_least_240px","very_bright","high_edge_variance","normal_contrast"))
 def test_script_never_writes_photos_or_identifies_people(self):
  s=P.read_text()
  for forbidden in ("cv2.imwrite","open('wb'","'ab'","face_embedding","identify_person",
                    "adb install","/data/app/","auto_identity_status="):
   self.assertNotIn(forbidden,s)
if __name__=="__main__":unittest.main(verbosity=2)
