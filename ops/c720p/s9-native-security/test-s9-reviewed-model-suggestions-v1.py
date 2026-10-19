#!/usr/bin/env python3
"""Offline regression tests for guarded optional S9 appearance evidence UI."""
import importlib.util
from pathlib import Path
import subprocess
import unittest

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("s9_feature_ui",ROOT/"deploy-s9-reviewed-model-suggestions-v1.py")
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Tests(unittest.TestCase):
    def setUp(self):
        self.base=(ROOT/"security-people-v45.js").read_bytes()
        self.page=(ROOT/"security-people-v50.html").read_bytes()

    def test_patch_parses_and_retains_functions(self):
        new,changed=m.patch(self.base)
        self.assertTrue(changed)
        text=new.decode()
        for marker in (
            "addReviewedOsnetMatches(ref,person,matches)",
            "scoreSource:'osnet_hsv'",
            "scoreSource:'hsv_two_piece'",
            "other.scoreSource===match.scoreSource",
            "human_review_required!==true",
            "automatic_person_assignments!==0",
            "/new/api/appearance-search?",
            "/new/api/automatic-person",
            "human_confirmed:true",
            "state.clipEvidence.get(clip)",
            "Math.abs(recorded_ms-ref.recorded_ms)>72*60*60*1000",
        ):
            self.assertIn(marker,text,marker)
        self.assertEqual(text.count(m.MARK),1)
        self.assertNotIn("innerHTML=",text)
        parsed=subprocess.run(["node","--check"],input=text,text=True,
                              capture_output=True,timeout=25)
        self.assertEqual(parsed.returncode,0,parsed.stderr[-450:])

    def test_html_cache_bust_and_idempotence(self):
        page,changed=m.patch_page(self.page)
        self.assertTrue(changed)
        self.assertEqual(page.count(m.JS_ROUTE.encode()),1)
        self.assertEqual(m.patch_page(page),(page,False))
        js,changed=m.patch(self.base)
        self.assertTrue(changed)
        self.assertEqual(m.patch(js),(js,False))

    def test_refuses_changed_anchors(self):
        with self.assertRaises(RuntimeError):
            m.patch(self.base.replace(b"async function searchClothingMatches(force=false){",
                                      b"function missing(){"))
        with self.assertRaises(RuntimeError):
            m.patch(self.base+b"// "+m.MARK.encode())

if __name__=="__main__":
    unittest.main(verbosity=2)
