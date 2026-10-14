#!/usr/bin/env python3
"""Static safety tests for Visual Search, guarded release, and historical index."""
import ast
import importlib.util
import pathlib
import unittest

HERE=pathlib.Path(__file__).resolve().parent
JAVA=HERE/"src/nl/kalenel/s9security"

class HsvIntegration(unittest.TestCase):
    def test_historical_index_non_destructive(self):
        classifier=(JAVA/"ClipClassifier.java").read_text()
        camera=(JAVA/"CameraService.java").read_text()
        self.assertIn("backfillAppearanceIndex",classifier)
        self.assertIn('getFrameAtTime(offset*1000',classifier)
        self.assertIn("samples.isEmpty()",classifier)
        self.assertIn("writeJson(new File(archive,name+\".verified.json\"),manifest)",classifier)
        self.assertIn("maybeAppearanceBackfill()",camera)
        self.assertIn("lastAppearanceBackfillScan<120000L",camera)
        self.assertIn("appearanceBackfillRetries",camera)
        self.assertIn('"watching".equals(mode)',camera)
        self.assertIn('folder.getUsableSpace()<20L*1024*1024*1024',camera)
        self.assertIn('index.hasClip(name)',camera)
    def test_authenticated_proxy_only(self):
        proxy=(HERE.parent/"s9-person-ml-v1/s9_sd_proxy_extension.py").read_text()
        self.assertIn('path=="/new/api/appearance-search"',proxy)
        self.assertIn('self.command!="GET"',proxy)
        self.assertIn('clip not in data',proxy)
        self.assertIn('127.0.0.1:18808/appearance/search?',proxy)
        self.assertIn('"verified_same_person":False',proxy)
        self.assertNotIn('0.0.0.0:18808',proxy)
        ast.parse(proxy)
    def test_ui_does_not_claim_identity(self):
        page=(HERE/"security-hsv-search-v1.html").read_text()
        self.assertIn('C720PSecureRelay',page)
        self.assertIn('/new/api/appearance-search?',page)
        self.assertIn('/new/saved/clip/',page)
        self.assertIn('/new/saved/snap/',page)
        self.assertIn('not identity probabilities',page)
        self.assertIn('verified_same_person===false',page)
        self.assertNotIn('face_embedding',page)
    def test_ui_deploy_preserves_both_old_and_new_recording_headers(self):
        path=HERE/"deploy-s9-hsv-ui-v1.py"
        spec=importlib.util.spec_from_file_location("hsv_deployer",path)
        module=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        source=(HERE.parent/"s9-person-ml-v1/s9_sd_proxy_extension.py").read_text()
        beginning=source.index(module.MARKER)
        ending=source.index(module.ANCHOR,beginning)
        original=source[:beginning]+source[ending:]
        for header in ('<header><h1>Tracks & clothing</h1>',
                       '<header><div><h1>Recording review</h1><p>Original 4K</p></div>'):
            page="<html><head><style>"+"*"*2200+"</style></head><body>"+header+"</body></html>"
            proxy,html=module.patch(original,page,source)
            self.assertIn(module.LINK,html)
            self.assertEqual(proxy.count(module.MARKER),1)
            self.assertEqual((proxy,html),module.patch(proxy,html,source))
            ast.parse(proxy)

    def test_guarded_apk_release_contract(self):
        build=(HERE/"build-s9-hsv-v1.py").read_text()
        deploy=(HERE/"deploy-s9-hsv-v1.py").read_text()
        ast.parse(build);ast.parse(deploy)
        self.assertIn('AppearanceSearchIndex',build)
        self.assertIn('installed-before.apk',build)
        self.assertIn('baseline_apk_sha256',build)
        self.assertIn('changed_model_manifest_or_native_lib',build)
        self.assertIn('S9_HSV_V1_DEPLOYMENT_VERIFIED',deploy)
        self.assertIn('S9_HSV_V1_ROLLBACK_VERIFIED',deploy)
        self.assertIn('running_apk_changed_after_build',deploy)
        self.assertIn('continuous_4k_buffered_ms',deploy)
        self.assertIn('archive_clips_missing_after_upgrade',deploy)

    def test_deploy_is_narrow_and_reversible(self):
        script=(HERE/"deploy-s9-hsv-ui-v1.py").read_text()
        ast.parse(script)
        self.assertIn('backups/s9-hsv-search-v1',script)
        self.assertIn('existing_camera_clips_disappeared',script)
        self.assertIn('for target in reversed(changed)',script)
        self.assertIn('original_mp4_changed',script)
        self.assertIn('appearance_route_not_active',script)

if __name__=="__main__":
    unittest.main(verbosity=2)
