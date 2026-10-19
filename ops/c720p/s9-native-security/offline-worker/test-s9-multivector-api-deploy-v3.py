#!/usr/bin/env python3
"""No-device S9 V3 rollout contract, rollback and immutable source tests."""
import importlib.util
from pathlib import Path
from unittest.mock import patch
import hashlib
import json
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent
SRC=ROOT/"deploy-s9-multivector-api-v3.py"
API=ROOT.parent.parent/"s9-person-ml-v1"/"s9_multivector_appearance_api_v3.py"
spec=importlib.util.spec_from_file_location("s9_v3_guarded_deploy",SRC)
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)

class V3Deploy(unittest.TestCase):
    def test_immutable_pinned_module_and_separate_route(self):
        self.assertEqual(d.github_blob_sha(API.read_bytes()),d.BLOB)
        self.assertIn("/81bab2ddaee3dc63b94ad4736fca026c6b05570d/",d.SOURCE)
        self.assertEqual(d.HOOK.count("s9_multivector_appearance_api.install(H)"),1)
        self.assertIn("s9_multivector_appearance_api_v3.install(H)",d.ADD)
        self.assertIn(d.HOOK,d.ADD)
        self.assertNotIn("s9_multivector_appearance_api_v2.install(H)",d.ADD)
        code=SRC.read_text()
        for forbidden in ("pm install","am force-stop","delete_original",
                          "review_decide","camera.apk"):
            self.assertNotIn(forbidden,code)

    def test_deployment_accepts_unbuilt_v3_only_when_route_is_present(self):
        def response(path,limit=3000000):
            if "invalid.mp4" in path:
                return 400,{"ok":False,"error":"invalid_clip"}
            return 503,{"ok":False,"error":"v3_appearance_index_not_ready"}
        with patch.object(d,"request",side_effect=response):
            self.assertEqual(d.accept(None),
                             "route_available_waiting_for_verified_v3")
        with patch.object(d,"request",return_value=(404,{"error":"not_found"})):
            with self.assertRaises(RuntimeError):d.accept(None)

    def test_pointer_sample_requires_real_source_map_sha(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            prior=d.HOME,d.STATE
            d.HOME=folder
            d.STATE=folder/"state/s9-multivector-v3-active.json"
            self.addCleanup(setattr,d,"HOME",prior[0])
            self.addCleanup(setattr,d,"STATE",prior[1])
            d.STATE.parent.mkdir()
            self.assertIsNone(d.sample_from_verified_pointer())
            clip="motion_1800000000000.mp4"
            data=json.dumps({"rows":[{"clip":clip}]*58}).encode()
            file=d.STATE.parent/("s9-multivector-crop-map-v3-"+"a"*16+".json")
            file.write_bytes(data)
            doc={"corpus_id":"a"*16,"map_sha256":hashlib.sha256(data).hexdigest()}
            d.STATE.write_text(json.dumps(doc))
            self.assertEqual(d.sample_from_verified_pointer(),clip)
            file.write_bytes(data+b"changed")
            with self.assertRaisesRegex(RuntimeError,"checksum"):
                d.sample_from_verified_pointer()

if __name__=="__main__":unittest.main(verbosity=2)
