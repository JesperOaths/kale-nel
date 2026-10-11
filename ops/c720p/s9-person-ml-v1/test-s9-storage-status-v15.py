#!/usr/bin/env python3
"""Read-only S9+ storage telemetry contracts; no device or media access."""
import importlib.util
from pathlib import Path
import unittest

SOURCE=Path(__file__).with_name("s9_phone_garden_status.py")
spec=importlib.util.spec_from_file_location("s9_status_v15",SOURCE)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def phone(sd):
    return {"ok":True,"mode":"watching","motion_detector":"person_spatial_motion_corroborated_v7",
            "last_frame_age_ms":400,"garden_person_gate_checked":5,
            "garden_person_gate_matches":1,"garden_person_gate_rejected":4,
            "garden_person_gate_errors":0,"garden_person_gate_backend":"gpu",
            "garden_person_gate_ready":True,"temperature_c":24.6,
            "sd_free_bytes":sd,"sensor_result_fps":14.27}

class NativeStorageTelemetryV15(unittest.TestCase):
    def test_native_measured_storage_and_existing_values(self):
        report=module.from_phone(phone(79461744640),now_ms=1791759000000)
        self.assertTrue(report["ok"])
        self.assertEqual(report["sd_free_bytes"],79461744640)
        self.assertEqual(report["camera_temperature_c"],24.6)
        self.assertEqual(report["camera_sensor"]["fps"],14.27)
        self.assertEqual(report["camera_mode"],"watching")
        self.assertFalse(report["hub_frame_decoding"])
    def test_invalid_or_missing_storage_never_fabricated(self):
        for invalid in [None,-1,float("nan"),True,10**17,"70000000"]:
            with self.subTest(invalid=str(invalid)):
                report=module.from_phone(phone(invalid),now_ms=1791759000000)
                self.assertIsNone(report["sd_free_bytes"])
    def test_zero_capacity_is_real_value_not_missing(self):
        self.assertEqual(module.from_phone(phone(0),now_ms=1791759000000)["sd_free_bytes"],0)

if __name__=="__main__":
    unittest.main()
