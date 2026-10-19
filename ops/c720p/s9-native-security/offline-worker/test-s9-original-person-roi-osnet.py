#!/usr/bin/env python3
"""Local-only source/provenance/selection contracts: no ADB or HTTP writes."""
import contextlib
import importlib.util
import io
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parent
P=ROOT/"backfill-s9-original-person-roi-osnet.py"
spec=importlib.util.spec_from_file_location("s9_person_backfill_test",P)
module=importlib.util.module_from_spec(spec)
sys.modules[spec.name]=module
spec.loader.exec_module(module)

class Checks(unittest.TestCase):
    def setUp(self):
        self.c1="motion_1792200000000.mp4"
        self.c2="motion_1792200010000.mp4"
        self.c3="motion_1792200020000.mp4"
        self.events={
         self.c1:{"clip_no":self.c1,"person_count":1,
                  "frames_with_distinct_multiple_person_boxes":0},
         self.c2:{"clip_no":self.c2,"person_count":2,
                  "frames_with_distinct_multiple_person_boxes":2},
         self.c3:{"clip_no":self.c3,"person_count":1,
                  "frames_with_distinct_multiple_person_boxes":0},
        }

    def test_approved_references_first_but_multi_person_excluded(self):
        rows=module.candidates(self.events,{self.c1,self.c2},"approved")
        self.assertEqual([x[1] for x in rows],[self.c1])
        allrows=module.candidates(self.events,{self.c1,self.c2},"all")
        self.assertEqual([x[1] for x in allrows],[self.c1,self.c3])

    def test_person_mode_excludes_unverified_counts(self):
        self.events[self.c3]["person_count"]="1"
        self.assertEqual([x[1] for x in module.candidates(self.events,set(),"person")],[self.c1])
        self.events[self.c1]["frames_with_distinct_multiple_person_boxes"]=1
        self.assertEqual(module.candidates(self.events,set(),"person"),[])

    def test_approved_index_is_source_qualified_and_paged(self):
        prior=module.request
        try:
            def fake(uri,limit=6_000_000):
                if uri.startswith("/new/api/s9-manual-recording-links"):
                    return {"manual_links_only":True,"items":{
                        "sd:"+self.c1:{"folder":"G1"},
                        "drive:"+self.c2:{"folder":"G1"}}}
                if "tab=all" in uri:
                    return {"folders":[{"id":"G1"}]}
                if "tab=approved" in uri:
                    return {"items":[{"clip":self.c3}],"total":1}
                raise RuntimeError("Unexpected API route")
            module.request=fake
            self.assertEqual(module.approved_names(),{self.c1,self.c3})
        finally:module.request=prior

    def test_model_and_detector_sha_are_immutable(self):
        java=(ROOT/"S9StandalonePersonRoi.java").read_text()
        self.assertIn(module.DETECT_SHA,java)
        self.assertIn(module.OSNET_SHA,(ROOT/"S9OnnxCropWorker.java").read_text())
        self.assertIn("S9_OFFLINE_SINGLE_PERSON_ROI_STAGED",java)
        self.assertIn("frames=3",java)
        self.assertIn("person_count",P.read_text())
        for banned in ("pm install", "am force-stop", "review/review",
                       "delete_original", "rmtree", "automatic_person_assign"):
            self.assertNotIn(banned,P.read_text())
            self.assertNotIn(banned,java)

if __name__=="__main__":
    unittest.main(verbosity=2)
