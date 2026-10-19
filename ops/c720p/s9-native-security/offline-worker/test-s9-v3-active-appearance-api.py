#!/usr/bin/env python3
"""Offline regressions for v3 active pointers and provisional comparison route."""
from pathlib import Path
import hashlib
import importlib.util
import json
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent
APISRC=ROOT.parent.parent/"s9-person-ml-v1"/"s9_multivector_appearance_api_v3.py"
RANKSRC=ROOT/"run-s9-uniform-appearance-rankings-v3.py"

def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    return m

a=module("v3_appearance_api_for_test",APISRC)
worker=module("v3_active_ranker_for_test",RANKSRC)

def encode(x):
    return (json.dumps(x,sort_keys=True,separators=(",",":"))+"\n").encode()

class V3Api(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.folder=Path(tmp.name)
        self.corpus="a"*16
        self.rows=[]
        for i in range(58):
            self.rows.append({
                "key":hashlib.sha256(("v3crop"+str(i)).encode()).hexdigest(),
                "clip":f"motion_{1800000000000+i*1000}.mp4",
                "source":"s9_sd",
                "crop_sha256":"1"*64,
                "visual_sidecar_sha256":"2"*64,
                "hsv_sidecar_sha256":"3"*64,
                "cohort":"v40" if i<51 else "approved_new" if i<57
                       else "archive_unassigned"
            })
        self.map={
            "schema":"s9_multivector_source_map_v3",
            "corpus_id":self.corpus,
            "visual_model_sha256":a.VISUAL_SHA,
            "color_histogram_schema":a.SCHEMA,
            "people_assigned_automatically":0,"rows":self.rows}
        self.index={
            "schema":"s9_appearance_rankings_v3","corpus_id":self.corpus,
            "count":58,"model_sha256":a.VISUAL_SHA,
            "color_histogram_schema":a.SCHEMA,
            "human_review_required":True,
            "automatically_assigned_people":0,"identity_probabilities":False,
            "rankings":[{"reference_key":row["key"],
                         "similar_appearance_only":[
                             {"candidate_key":self.rows[1]["key"],
                              "appearance_similarity_percent":86.25,
                              "method":"visual_75_color_25",
                              "verified_same_person":False,
                              "human_review_required":True}
                         ] if i==0 else []}
                        for i,row in enumerate(self.rows)]
        }
        self.original_state=worker.STATE_DIR
        self.original_api_state=a.STATE
        self.original_api_active=a.ACTIVE
        worker.STATE_DIR=self.folder
        a.STATE=self.folder
        a.ACTIVE=self.folder/"s9-multivector-v3-active.json"
        self.addCleanup(setattr,worker,"STATE_DIR",self.original_state)
        self.addCleanup(setattr,a,"STATE",self.original_api_state)
        self.addCleanup(setattr,a,"ACTIVE",self.original_api_active)
        self.install()
    def install(self):
        self.map_bytes=encode(self.map)
        self.rank_bytes=encode(self.index)
        (self.folder/f"s9-multivector-crop-map-v3-{self.corpus}.json").write_bytes(self.map_bytes)
        self.pointer={
            "schema":"s9_appearance_v3_active_v1",
            "corpus_id":self.corpus,
            "map_sha256":a.checksum(self.map_bytes),
            "rankings_sha256":a.checksum(self.rank_bytes),
            "verified_crops":58,
            "automatic_person_assignments":0,
            "human_review_required":True}
        a.ACTIVE.write_bytes(encode(self.pointer))
    def test_api_returns_appearance_only(self):
        with patch.object(a.subprocess,"run",return_value=SimpleNamespace(
            returncode=0,stdout=self.rank_bytes,stderr=b"")):
            status,body=a.report(self.rows[0]["clip"])
        self.assertEqual(status,200)
        self.assertEqual(body["corpus_id"],self.corpus)
        self.assertIs(body["identity_probability"],False)
        self.assertEqual(body["automatic_person_assignments"],0)
        self.assertEqual(body["coverage"]["real_person_crops"],58)
        self.assertEqual(body["results"][0]["similarity_percent"],86.25)
        self.assertNotIn("visual_embedding",json.dumps(body))
        with patch.object(a.subprocess,"run") as phone:
            self.assertEqual(a.report("motion_1800000999999.mp4")[0],404)
            phone.assert_not_called()

    def test_pointer_and_rankings_sha_guard(self):
        self.pointer["rankings_sha256"]="f"*64
        a.ACTIVE.write_bytes(encode(self.pointer))
        with patch.object(a.subprocess,"run",return_value=SimpleNamespace(
                returncode=0,stdout=self.rank_bytes,stderr=b"")):
            with self.assertRaisesRegex(ValueError,"sha_mismatch"):
                a.report(self.rows[0]["clip"])
        self.install()
        self.map["rows"][0]["source"]="gdrive_archive"
        self.map_bytes=encode(self.map)
        map_path=self.folder/f"s9-multivector-crop-map-v3-{self.corpus}.json"
        map_path.write_bytes(self.map_bytes)
        self.pointer["map_sha256"]=a.checksum(self.map_bytes)
        a.ACTIVE.write_bytes(encode(self.pointer))
        with self.assertRaisesRegex(ValueError,"unknown_v3_archive_source"):
            a.report(self.rows[0]["clip"])

    def test_identity_assertions_and_nan_rejected(self):
        for patch_values in (
            {"verified_same_person":True},
            {"appearance_similarity_percent":float("nan")},
            {"appearance_similarity_percent":True},
            {"method":"face_identity_probability"}):
            self.install()
            self.index["rankings"][0]["similar_appearance_only"][0].update(patch_values)
            self.rank_bytes=encode(self.index)
            self.pointer["rankings_sha256"]=a.checksum(self.rank_bytes)
            a.ACTIVE.write_bytes(encode(self.pointer))
            with patch.object(a.subprocess,"run",return_value=SimpleNamespace(
                    returncode=0,stdout=self.rank_bytes,stderr=b"")):
                with self.assertRaises(ValueError):
                    a.report(self.rows[0]["clip"])
            self.index["rankings"][0]["similar_appearance_only"][0]={
                "candidate_key":self.rows[1]["key"],
                "appearance_similarity_percent":86.25,
                "method":"visual_75_color_25",
                "verified_same_person":False,
                "human_review_required":True}

    def test_active_pointer_never_regresses_and_is_append_only(self):
        # Separate from live source maps; tests only temporary files.
        a.ACTIVE.unlink()
        ident="b"*16
        self.assertTrue(worker.publish_verified_active(
            ident,"2"*64,"3"*64,58))
        self.assertFalse(worker.publish_verified_active(
            ident,"2"*64,"3"*64,58))
        with self.assertRaisesRegex(RuntimeError,"Same-size"):
            worker.publish_verified_active("c"*16,"2"*64,"3"*64,58)
        self.assertTrue(worker.publish_verified_active(
            "c"*16,"4"*64,"5"*64,59))
        self.assertTrue(list(self.folder.glob("s9-multivector-v3-retired-*.json")))
        with self.assertRaisesRegex(RuntimeError,"regressive"):
            worker.publish_verified_active("d"*16,"5"*64,"6"*64,58)

if __name__=="__main__":unittest.main(verbosity=2)
