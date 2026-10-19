#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location("light_audit",Path(__file__).with_name("camera-light-contract-audit-v1.py"))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def fixture():
    return '''
- id: c720p_frontcam_motion_living_lamp_v1
  action:
    - condition: state
      entity_id: input_boolean.c720p_living_camera_owned
    - delay:
        duration: "00:10:00"
    - wait_for_trigger:
        duration: "00:10:00"
# END C720P_FRONTCAM_MOTION_LIVING_LAMP_V1
- id: c720p_s3_bedroom_spots_v1
  action:
    - condition: state
      entity_id: input_boolean.c720p_s3_bedroom_camera_owned
    - delay:
        duration: "00:05:00"
    - wait_for_trigger:
        duration: "00:05:00"
# END C720P_S3_BEDROOM_SPOTS_V1
'''
class Tests(unittest.TestCase):
    def test_expected_independent_room_contracts(self):
        result=m.audit(fixture())
        self.assertTrue(result["ok"])
        self.assertEqual(result["bedroom_timeout_seconds"],300)
        self.assertEqual(result["living_room_timeout_seconds"],600)
        self.assertFalse(result["physical_walk_test_completed"])
        self.assertFalse(result["light_state_changed"])
    def test_reject_old_living_timeout_and_no_manual_owner(self):
        with self.assertRaisesRegex(ValueError,"living_timer"):
            m.audit(fixture().replace('duration: "00:10:00"','duration: "00:05:00"'))
        with self.assertRaisesRegex(ValueError,"bedroom_manual"):
            m.audit(fixture().replace("input_boolean.c720p_s3_bedroom_camera_owned","input_boolean.not_owner"))
    def test_reject_duplicate_automation_sections(self):
        source=fixture()
        with self.assertRaisesRegex(ValueError,"markers_missing_or_duplicated"):
            m.audit(source+source)
if __name__=="__main__":
    unittest.main(verbosity=2)
