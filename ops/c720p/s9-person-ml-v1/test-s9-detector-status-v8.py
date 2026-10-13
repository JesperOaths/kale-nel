"""Exact live detector compatibility; preserve unavailable and optional telemetry semantics."""
import importlib.util
from pathlib import Path
import unittest

SOURCE=Path(__file__).with_name("s9_phone_garden_status.py")


def reporter():
    spec=importlib.util.spec_from_file_location("s9_detector_status_v8",SOURCE)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


def phone():
    return {"ok":True,"mode":"watching","motion_detector":"person_multiscale_threeframe_static_v8",
            "last_frame_age_ms":23,"garden_person_gate_checked":234,"garden_person_gate_matches":7,
            "garden_person_gate_rejected":227,"garden_person_gate_errors":0,"garden_person_gate_backend":"gpu",
            "garden_person_gate_ready":True,"temperature_c":29.7,"sd_free_bytes":75823972352,
            "sensor_result_fps":30.02}


class DetectorStatusV8(unittest.TestCase):
    def setUp(self):self.module=reporter()

    def test_measured_live_v8_is_available_without_changing_old_versions(self):
        value=self.module.from_phone(phone(),now_ms=1791866400000)
        self.assertTrue(value["ok"]);self.assertEqual(value["camera_mode"],"watching")
        self.assertTrue(value["person_inference_ready"]);self.assertEqual(value["person_inference_backend"],"gpu")
        self.assertEqual(value["camera_sensor"]["fps"],30.02);self.assertFalse(value["hub_frame_decoding"])
        legacy=phone();legacy["motion_detector"]="person_spatial_motion_corroborated_v7"
        self.assertTrue(self.module.from_phone(legacy)["ok"])

    def test_missing_or_invalid_readiness_never_claims_an_active_detector(self):
        for candidate in (None,"true",1):
            value=phone();value["garden_person_gate_ready"]=candidate
            self.assertIsNone(self.module.from_phone(value)["person_inference_ready"])
        value=phone();del value["garden_person_gate_ready"]
        self.assertIsNone(self.module.from_phone(value)["person_inference_ready"])
        value["garden_person_gate_ready"]=False
        self.assertFalse(self.module.from_phone(value)["person_inference_ready"])

    def test_unknown_version_stale_sensor_and_bad_counters_still_rejected(self):
        for key,candidate in (("motion_detector","person_multiscale_threeframe_static_v999"),
                              ("last_frame_age_ms",9001),("ok",False),("mode","stopped"),
                              ("garden_person_gate_matches",235)):
            with self.subTest(key=key):
                value=phone();value[key]=candidate
                with self.assertRaises(ValueError):self.module.from_phone(value)


if __name__=="__main__":unittest.main()
