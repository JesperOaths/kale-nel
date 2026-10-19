#!/usr/bin/env python3
"""Check privacy, source baseline and 4K priority for read-only S9 V3 probe."""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

SRC=Path(__file__).with_name("run-s9-v3-partial-live-preflight-v105.py")
spec=importlib.util.spec_from_file_location("s9_partial_preflight_v105",SRC)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Reply:
    status=200
    def __init__(self,doc):self.raw=json.dumps(doc).encode()
    def __enter__(self):return self
    def __exit__(self,*args):return False
    def read(self,n):return self.raw[:n]

def healthy(**overrides):
    result={"ok":True,"mode":"watching",
       "continuous_4k_ready":True,
       "continuous_4k_production_persisted":True,
       "continuous_4k_buffered_ms":7000,
       "continuous_4k_dropped_output_frames":0,
       "continuous_4k_error":"",
       "temperature_c":40.0}
    result.update(overrides)
    return result

class Tests(unittest.TestCase):
    def test_true_58_subset_accepted_without_clips(self):
        result=m.accepted({
          "uniform_real_person_crop_records":58,
          "cohorts":{"v40":52,"approved_new":6},
          "v2_reference_baseline_preserved":True,
          "new_rankings_written":False,"old_rankings_modified":False})
        self.assertEqual(result["complete_descriptors"],58)
        self.assertTrue(result["original_57_v2_descriptors_preserved"])
        self.assertFalse(result["ranking_written"])
        self.assertNotIn("motion_",str(result))
    def test_no_identity_or_false_claims(self):
        original={"uniform_real_person_crop_records":58,
          "cohorts":{"v40":52,"approved_new":6},
          "v2_reference_baseline_preserved":True,
          "new_rankings_written":False,"old_rankings_modified":False}
        for item in (
            {"uniform_real_person_crop_records":57},
            {"cohorts":{"v40":51,"approved_new":6}},
            {"cohorts":{"v40":52,"approved_new":6,"foreign":1}},
            {"v2_reference_baseline_preserved":False},
            {"new_rankings_written":True},
            {"old_rankings_modified":True}):
            with self.subTest(item=item),self.assertRaises(RuntimeError):
                m.accepted({**original,**item})
    def test_warm_camera_defers_without_running_ranker(self):
        with patch.object(m.urllib.request,"urlopen",
             return_value=Reply(healthy(temperature_c=41.9))):
            result,reason=m.camera()
        self.assertIsNone(result)
        self.assertEqual(reason,"temperature_readonly_deferred")
    def test_known_good_4k_and_buffer(self):
        with patch.object(m.urllib.request,"urlopen",
             return_value=Reply(healthy(temperature_c=41.6))):
            result,reason=m.camera()
        self.assertIsNone(reason)
        self.assertEqual(result["continuous_4k_buffered_ms"],7000)
    def test_recording_unavailable_defers(self):
        with patch.object(m.urllib.request,"urlopen",
             return_value=Reply(healthy(continuous_4k_ready=False))):
            self.assertEqual(m.camera()[1],"camera_not_stably_ready")
    def test_source_has_no_write_or_identity_actions(self):
        s=SRC.read_text()
        for forbidden in ('"--apply"',"pm install","am force-stop",
                          ".write_bytes(",'.write_text(',"os.replace(",
                          "assign_person","modify_review","del_original"):
            self.assertNotIn(forbidden,s)
        self.assertIn("capture_output=True",s)
        self.assertIn("original_57_v2_descriptors_preserved",s)
        self.assertIn("source_identifiers_disclosed",s)
if __name__=="__main__":unittest.main(verbosity=2)
