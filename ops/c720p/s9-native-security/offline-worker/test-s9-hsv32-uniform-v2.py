#!/usr/bin/env python3
"""No-phone deterministic checks of disjoint V40 and approved crop provenance."""
import importlib.util
from pathlib import Path
import hashlib
import unittest
root=Path(__file__).resolve().parent
path=root/"backfill-s9-hsv32-uniform-v2.py"
spec=importlib.util.spec_from_file_location("v2unit",path)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Tests(unittest.TestCase):
    def test_same_method_for_all_cohorts_no_legacy_color_mix(self):
        s=path.read_text()
        self.assertIn("hue8_saturation2_value2_center_torso_v2",s)
        self.assertIn("s9_uniform_upper_torso_hsv32_v2",s)
        self.assertIn("backfill-v40-person-rois-on-s9.py",s)
        self.assertIn("backfill-s9-original-person-roi-osnet.py",s)
        self.assertIn("s9-torso-hsv-v2.jar",s)
        self.assertIn("safe_visual(",s)
        self.assertNotIn("rankings-v1.json",s)
        self.assertNotIn("rank-input-v1.jsonl",s)
        for forbidden in ("pm install","am force-stop","auto_assign_person",
                          "delete_original", "review/decide"):
            self.assertNotIn(forbidden,s)

    def test_refuses_invalid_l2_and_crop_hash(self):
        key="a"*64
        digest="b"*64
        original=m.phone_json
        try:
            m.phone_json=lambda path: {
               "source_qualified_key":key,
               "crop_sha256":digest,
               "model_sha256":m.VISUAL,
               "visual_embedding":[0.0]*512
            }
            with self.assertRaisesRegex(RuntimeError,"L2"):
                m.safe_visual(key,digest)
            m.phone_json=lambda path: {
               "source_qualified_key":key,
               "crop_sha256":digest,
               "model_sha256":m.VISUAL,
               "visual_embedding":[1.0]+[0.0]*511
            }
            self.assertTrue(m.safe_visual(key,digest))
            with self.assertRaisesRegex(RuntimeError,"provenance"):
                m.safe_visual(key,"c"*64)
        finally:m.phone_json=original

    def test_new_source_key_does_not_alias_v40(self):
        name="motion_1792000000000.mp4"
        crop="b"*64
        keynew=hashlib.sha256(("s9_sd\x00"+name).encode()).hexdigest()
        keyold=hashlib.sha256(("s9_sd\x00"+name+"\x00"+crop).encode()).hexdigest()
        self.assertNotEqual(keynew,keyold)
        self.assertTrue(m.HEX.fullmatch(keynew))
        self.assertTrue(m.HEX.fullmatch(keyold))

if __name__=="__main__":unittest.main(verbosity=2)
