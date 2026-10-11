#!/usr/bin/env python3
"""Security UI must continue showing current phone detection after APK upgrades."""
import importlib.util
import unittest
from pathlib import Path
FILE=Path(__file__).resolve().parent.parent/"s9-person-ml-v1"/"s9_phone_garden_status.py"
spec=importlib.util.spec_from_file_location("s9_watch_versions",FILE)
adapter=importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)

def healthy(version):
 return {"ok":True,"mode":"watching","motion_detector":version,
   "last_frame_age_ms":95,"garden_person_gate_checked":3,
   "garden_person_gate_matches":2,"garden_person_gate_rejected":1,
   "garden_person_gate_errors":0,"garden_person_gate_last_score":.449,
   "garden_person_gate_backend":"gpu","garden_person_gate_ready":True,
   "garden_zone":"near","garden_roi_mask_version":"owner_drawn_sloped_garden_v6",
   "garden_person_spatial_gate":version.endswith("_v7"),
   "garden_person_motion_corroboration":version.endswith("_v7"),
   "garden_person_unrelated_boxes":1,"garden_person_no_local_motion":2,
   "garden_person_last_local_motion_cells":4}

class Versions(unittest.TestCase):
 def test_all_live_detector_revisions_supported(self):
  for version in ("garden_roi_gpu_person_gate_v1",
                  "garden_roi_gpu_two_frame_person_gate_v2",
                  "person_spatial_motion_corroborated_v7"):
   with self.subTest(version=version):
    adapter._LAST_COUNT=None;adapter._LAST_CHANGED_AT=0
    info=adapter.from_phone(healthy(version),now_ms=12345000)
    self.assertTrue(info["ok"])
    self.assertEqual(info["detector_version"],version)
    self.assertEqual(info["status"]["motion_events_since_service_start"],0)
    self.assertEqual(info["on_phone_gpu_inference"],True)
    self.assertEqual(info["roi_mask_version"],"owner_drawn_sloped_garden_v6")
 def test_unknown_detector_fails_closed(self):
  with self.assertRaises(ValueError):
   adapter.from_phone(healthy("future_unverified_gate"),now_ms=12345000)
if __name__=="__main__":unittest.main(verbosity=2)
