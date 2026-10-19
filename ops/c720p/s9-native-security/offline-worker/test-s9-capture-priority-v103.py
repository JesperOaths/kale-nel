#!/usr/bin/env python3
"""Source-only regression tests for private S9 camera-priority readiness."""
import importlib.util
from pathlib import Path
import unittest

P=Path(__file__).with_name("audit-s9-capture-priority-v103.py")
spec=importlib.util.spec_from_file_location("s9_capture_v103",P)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def healthy():
    return {"ok":True,"mode":"watching","native_4k_enabled":True,
       "continuous_4k_trial_active":True,"continuous_4k_ready":True,
       "continuous_4k_buffered_ms":6900,"continuous_4k_dropped_output_frames":0,
       "continuous_4k_error":"","continuous_4k_production_persisted":True}

class Tests(unittest.TestCase):
    def test_only_cool_live_ready_buffer_allows_backfill(self):
        out=m.classify(healthy(),38.8,True)
        self.assertTrue(out["background_processing_permitted"])
        self.assertEqual(out["defer_reason"],"ready")
        self.assertFalse(out["recordings_modified"])
    def test_thermal_fallback_never_counts_as_ready(self):
        x=healthy();x.update(continuous_4k_trial_active=False,
          continuous_4k_ready=False,continuous_4k_buffered_ms=0)
        out=m.classify(x,42.2,True)
        self.assertFalse(out["background_processing_permitted"])
        self.assertEqual(out["defer_reason"],"thermal_headroom_required")
        self.assertFalse(out["continuous_4k_ready"])
    def test_encoder_and_buffer_faults_fail_closed(self):
        mutations=[
            ({"mode":"recording"},"capture_not_idle"),
            ({"continuous_4k_ready":False},"continuous_4k_not_ready"),
            ({"continuous_4k_buffered_ms":1000},"pre_event_buffer_not_ready"),
            ({"continuous_4k_dropped_output_frames":2},"encoder_drops_detected_or_unknown"),
            ({"continuous_4k_error":"codec_error"},"encoder_error_detected_or_unknown"),
            ({"continuous_4k_error":None},"encoder_error_detected_or_unknown"),
        ]
        for patch,reason in mutations:
            with self.subTest(reason=reason):
                self.assertEqual(m.classify({**healthy(),**patch},38.8,True)["defer_reason"],reason)
    def test_missing_health_and_invalid_data_do_not_pass(self):
        self.assertEqual(m.classify({},None,False)["defer_reason"],"camera_health_unconfirmed")
        self.assertEqual(m.classify(healthy(),None,True)["defer_reason"],"temperature_unavailable")
        self.assertFalse(m.classify(healthy(),39.6,True)["background_processing_permitted"])
        self.assertEqual(m.classify({**healthy(),"continuous_4k_buffered_ms":True},38.2,True)["defer_reason"],"pre_event_buffer_not_ready")
    def test_no_phone_mutations_in_source(self):
        text=P.read_text()
        for forbidden in ("--apply","adb push","adb install","am force-stop",
                          "rm -f","os.replace(", "write_bytes(", "write_text(",
                          "assign_person", "delete_original"):
            self.assertNotIn(forbidden,text)
        self.assertIn("private_clip_names_disclosed",text)

if __name__=="__main__":unittest.main(verbosity=2)
