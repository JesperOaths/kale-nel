#!/usr/bin/env python3
"""Offline regression coverage for S9 native anonymous metadata end-to-end."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
from unittest import mock

HERE=Path(__file__).resolve().parent
PHONE=HERE.parent/"s9-person-ml-v1"
sys.path.insert(0,str(PHONE))

def load(path,unique):
    spec=importlib.util.spec_from_file_location(unique,path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class Tests(unittest.TestCase):
    def setUp(self):
        self.catalog=load(PHONE/"local-sd-catalog.py","anonymous_sd_catalog")
        self.proxy=load(PHONE/"s9_sd_proxy_extension.py","anonymous_proxy_extension")
        self.ui=load(HERE/"patch-anonymous-tracks-ui.py","anonymous_security_ui")

    def manifest(self):
        return {
            "name":"motion_1791600000000.mp4","duration_ms":15000,
            "anonymous_tracking_version":"sampled_box_tracklets_v1",
            "anonymous_track_scope":"this_recording_only",
            "anonymous_track_count":2,
            "anonymous_tracks":[
                {"id":"Person 1","temporary_track_id":1,"first_sample_ms":1300,
                 "last_sample_ms":11900,"sample_count":7,"peak_detection_score":.933,
                 "upper_clothing_colour":"blue","cross_recording_identity":"not_attempted"},
                {"id":"Person 2","temporary_track_id":2,"first_sample_ms":2100,
                 "last_sample_ms":9300,"sample_count":3,"peak_detection_score":.79,
                 "upper_clothing_colour":"gray","cross_recording_identity":"not_attempted"}
            ],
            "appearance_vector":[.7]*48,"possible_same_outfit_clips":[{"clip":"other"}]
        }

    def test_metadata_accepts_anonymous_tracks_only(self):
        result=self.catalog.anonymous_clip_metadata(self.manifest())
        self.assertEqual(result["anonymous_tracking_status"],"sampled_tracks_available")
        self.assertEqual(result["anonymous_track_count"],2)
        self.assertEqual([t["id"] for t in result["anonymous_tracks"]],["Person 1","Person 2"])
        self.assertEqual(result["anonymous_tracks"][0]["upper_clothing_colour"],"blue")
        self.assertNotIn("appearance_vector",json.dumps(result))
        self.assertNotIn("possible_same_outfit_clips",json.dumps(result))
        self.assertNotIn("cross_recording_identity",json.dumps(result))
        self.assertNotIn("name",json.dumps(result))

    def test_old_recordings_distinguished_from_zero_person_samples(self):
        a=self.catalog.anonymous_clip_metadata({"duration_ms":12000})
        self.assertIsNone(a["anonymous_track_count"])
        self.assertEqual(a["anonymous_tracking_status"],"not_available_in_original_review")
        new=self.manifest();new["anonymous_tracks"]=[];new["anonymous_track_count"]=0
        b=self.catalog.anonymous_clip_metadata(new)
        self.assertEqual(b["anonymous_tracking_status"],"none_detected_in_sampled_frames")
        self.assertEqual(b["anonymous_track_count"],0)

    def test_bad_identifiers_and_counts_do_not_poison_recording(self):
        for key,val in (("anonymous_track_scope","all_recordings"),("anonymous_track_count",3)):
            m=self.manifest();m[key]=val
            r=self.catalog.anonymous_clip_metadata(m)
            self.assertEqual(r["anonymous_tracks"],[])
            self.assertIn("invalid_",r["anonymous_tracking_status"])
        m=self.manifest();m["anonymous_tracks"][0]["id"]="Known visitor"
        self.assertEqual(self.catalog.anonymous_clip_metadata(m)["anonymous_tracks"],[])
        m=self.manifest();m["anonymous_tracks"][1]["temporary_track_id"]=1
        self.assertEqual(self.catalog.anonymous_clip_metadata(m)["anonymous_tracks"],[])
        m=self.manifest();m["anonymous_tracks"][0]["upper_clothing_colour"]="unknown purple"
        result=self.catalog.anonymous_clip_metadata(m)
        self.assertEqual(result["anonymous_tracks"][0]["upper_clothing_colour"],"uncertain")

    def test_secure_saved_api_transports_only_clip_scoped_metadata(self):
        class Handler:
            def __init__(self,path):
                self.path=path;self.code=None;self.body=None
            def go(self):self.code=418
            def do_POST(self):self.code=418
            def js(self,status,body):self.code=status;self.body=body
        self.proxy.install_local_sd(Handler)
        key="motion_1791600000000.mp4"
        item={"name":key,"timestamp":"2026-10-10 09:20","size":200000,"sd_verified":True,
              "scene_category":"multiple_people","person_count":2,"content_categories":["person"],
              **self.catalog.anonymous_clip_metadata(self.manifest())}
        with mock.patch.object(self.proxy,"rows",return_value={key:item}),mock.patch.object(self.proxy,"preview_rows",return_value={}):
            h=Handler("/new/api/saved");h.go()
        self.assertEqual(h.code,200)
        self.assertEqual(h.body["archive_mode"],"S9-microSD-only")
        one=h.body["events"][0]
        self.assertEqual(one["anonymous_id_scope"],"clip_only_never_across_recordings")
        self.assertEqual(one["anonymous_track_count"],2)
        self.assertEqual(len(one["anonymous_tracks"]),2)
        self.assertEqual(one["person_count"],2)
        self.assertNotIn("appearance_vector",json.dumps(one))
        self.assertNotIn("verified_same_person",json.dumps(one))

    def test_ui_idempotence_and_refusal_on_unknown_page(self):
        original='<html><script id="c720p-s9-phone-clips-ui-v1"></script></body></html>'
        patched=self.ui.patch_text(original)
        self.assertIn("S9+ anonymous tracks & clothing colours",patched)
        self.assertIn("No names, face matching or IDs carried between recordings",patched)
        self.assertIn("C720PSecureRelay",patched)
        self.assertIn("Watch original recording",patched)
        self.assertEqual(self.ui.patch_text(patched),patched)
        with self.assertRaises(ValueError):
            self.ui.patch_text("<html><body></body></html>")
        with self.assertRaises(ValueError):
            self.ui.patch_text(patched.replace('id="s9-anonymous-clips-script-v1"','id="incomplete-script"'))

if __name__=="__main__":
    unittest.main(verbosity=2)
