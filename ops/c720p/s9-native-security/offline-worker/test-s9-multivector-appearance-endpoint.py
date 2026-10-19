#!/usr/bin/env python3
"""Synthetic privacy and source-resolution tests; no S9 or archive access."""
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest

HERE=Path(__file__).resolve().parent
MODULE=HERE.parent.parent/"s9-person-ml-v1"/"s9_multivector_appearance_api.py"
spec=importlib.util.spec_from_file_location("s9_multivector",MODULE)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.t=tempfile.TemporaryDirectory()
        self.addCleanup(self.t.cleanup)
        self.map=Path(self.t.name)/"map.json"
        self.keys=("a"*64,"b"*64)
        self.clips=("motion_1792211111111.mp4","motion_1792222222222.mp4")
        self.map.write_text(json.dumps({
            "schema":"s9_v40_multivector_map_v1",
            "visual_model_sha256":m.VISUAL_SHA,
            "rows":[{"key":k,"clip":c,"source":"s9_sd"}
                    for k,c in zip(self.keys,self.clips)]
        }))
        self.original_path=m.STATE
        m.STATE=self.map
        self.addCleanup(setattr,m,"STATE",self.original_path)
        self.original_run=m.subprocess.run
        self.addCleanup(setattr,m.subprocess,"run",self.original_run)
        self.rank_doc={
            "schema":"s9_appearance_rankings_v1",
            "identity_probabilities":False,
            "automatically_assigned_people":0,
            "rankings":[
                {"reference_key":self.keys[0],
                 "similar_appearance_only":[
                    {"candidate_key":self.keys[1],
                     "appearance_similarity_percent":76.34,
                     "method":"visual_75_color_25",
                     "verified_same_person":False,
                     "human_review_required":True}]},
                {"reference_key":self.keys[1],
                 "similar_appearance_only":[
                    {"candidate_key":self.keys[0],
                     "appearance_similarity_percent":76.34,
                     "method":"visual_75_color_25",
                     "verified_same_person":False,
                     "human_review_required":True}]},
            ],
        }
        def fake(argv,**kw):
            self.assertTrue("exec-out" in argv)
            return SimpleNamespace(returncode=0,
                stdout=json.dumps(self.rank_doc).encode(),stderr=b"")
        m.subprocess.run=fake

    def test_returns_real_scores_without_identity_or_raw_vectors(self):
        status,response=m.report(self.clips[0])
        self.assertEqual(status,200)
        self.assertEqual(response["coverage"]["real_person_crops"],2)
        self.assertEqual(response["automatic_person_assignments"],0)
        self.assertFalse(response["identity_probability"])
        self.assertTrue(response["human_review_required"])
        self.assertEqual(len(response["results"]),1)
        found=response["results"][0]
        self.assertEqual(found["clip_name"],self.clips[1])
        self.assertAlmostEqual(found["similarity_percent"],76.34)
        self.assertFalse(found["verified_same_person"])
        self.assertNotIn("embedding",json.dumps(response))
        self.assertEqual(m.report("motion_1792233333333.mp4")[0],404)

    def test_malformed_score_and_identity_claim_refused(self):
        target=self.rank_doc["rankings"][0]["similar_appearance_only"][0]
        target["appearance_similarity_percent"]=101
        with self.assertRaises(ValueError):m.report(self.clips[0])
        target["appearance_similarity_percent"]=50
        target["verified_same_person"]=True
        with self.assertRaises(ValueError):m.report(self.clips[0])

    def test_cross_source_and_bad_provenance_refused(self):
        doc=json.loads(self.map.read_text())
        doc["rows"][1]["source"]="gdrive_archive"
        self.map.write_text(json.dumps(doc))
        with self.assertRaises(ValueError):m.report(self.clips[0])
        doc["rows"][1]["source"]="s9_sd"
        doc["visual_model_sha256"]="0"*64
        self.map.write_text(json.dumps(doc))
        with self.assertRaises(ValueError):m.report(self.clips[0])


if __name__=="__main__":unittest.main(verbosity=2)
