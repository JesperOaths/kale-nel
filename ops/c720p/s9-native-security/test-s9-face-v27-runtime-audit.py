#!/usr/bin/env python3
from pathlib import Path
import importlib.util
import unittest
root=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("diagnostic",root/"audit-s9-face-v27-runtime.py")
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
class Tests(unittest.TestCase):
 def test_synthetic_counters(self):
  rows=[{"clip_no":"motion_1792012345678.mp4","face_deep_review_version":mod.ACTIVE_VERSION,
   "face_detector_raw_hits":5,"face_rejected_low_confidence":3,
   "face_snapshots_saved":1},
   {"clip_no":"motion_1792012345679.mp4","face_deep_review_version":mod.OLD_VERSION,
   "face_detector_raw_hits":3}]
  result=mod.report(rows,{"face_deep_errors":0,"mode":"watching"})
  self.assertEqual(result["archive_clips"],2)
  self.assertEqual(result["remaining_v27"],1)
  self.assertEqual(result["review_groups"][mod.ACTIVE_VERSION]["counters"]["face_detector_raw_hits"],5)
  self.assertEqual(result["review_groups"][mod.ACTIVE_VERSION]["with_saved_snapshot"],1)
 def test_invalid_metrics(self):
  self.assertEqual(mod.valid_int(True),0)
  self.assertEqual(mod.valid_int(-1),0)
  with self.assertRaises(ValueError):mod.report({}, {})
if __name__=="__main__":unittest.main(verbosity=2)
