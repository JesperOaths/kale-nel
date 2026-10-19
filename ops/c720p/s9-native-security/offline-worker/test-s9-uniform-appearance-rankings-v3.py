#!/usr/bin/env python3
"""Offline-only versioned ranking source and accepted model provenance guards."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
ROOT=Path(__file__).resolve().parent
p=ROOT/"run-s9-uniform-appearance-rankings-v3.py"
spec=importlib.util.spec_from_file_location("s9rankv2",p)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
class V3(unittest.TestCase):
    def test_model_color_schema_and_v1_separation(self):
        java=(ROOT/"S9AppearanceRankingWorkerV3.java").read_text()
        for marker in ("s9_appearance_rankings_v3",
                       "s9_uniform_upper_torso_hsv32_v2",
                       "hue8_saturation2_value2_center_torso_v2",
                       'key+"-hsv-v2.json"',
                       'cropSha.equals(h.optString("crop_sha256"))',
                       "PhoneOfflineSimilarity.compare",
                       "human_review_required"):
            self.assertIn(marker,java,marker)
        self.assertNotIn("rank-input-v1.jsonl",java)
        self.assertNotIn("rankings-v1.json",java)
        self.assertIn("corpusId",java)
        self.assertIn("rankings-v3-",java)
        self.assertIn("MessageDigest",java)
        py=p.read_text()
        for marker in ("v1_v2_indices_sha256_unchanged","source_inventory",
                       "approved_new", "S9_V3_MODEL_BACKED_RANKINGS_PRODUCED",
                       "write_private_map", "human_review_required"):
            self.assertIn(marker,py,marker)

    def test_private_mapping_sha(self):
        self.assertEqual(m.digest(b"abc"),
           "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        self.assertTrue(m.HEX.fullmatch("a"*64))

    def test_new_pinned_release_never_installs_or_controls_camera(self):
        js=(ROOT/"S9AppearanceRankingWorkerV3.java").read_text()
        script=p.read_text()
        for code in (js,script):
            for banned in ("pm install","am force-stop","CameraService.java",
                           "person_approve", "delete_original", "review_decide"):
                self.assertNotIn(banned,code,banned)

if __name__=="__main__":unittest.main(verbosity=2)
