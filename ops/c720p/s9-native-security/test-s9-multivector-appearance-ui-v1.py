#!/usr/bin/env python3
"""No-touch synthetic UI patch regressions for guarded S9+ appearance mode."""
import importlib.util
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parent
DEPLOY=ROOT/"deploy-s9-multivector-appearance-ui-v1.py"
HTML=ROOT/"security-face-folders-v22.html"
spec=importlib.util.spec_from_file_location("s9_mv_ui",DEPLOY)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TestUI(unittest.TestCase):
    def setUp(self):
        self.old=HTML.read_bytes()

    def test_adds_model_mode_and_preserves_legacy_features(self):
        after,changed=module.patch_html(self.old)
        self.assertEqual(changed,1)
        self.assertNotEqual(after,self.old)
        out=after.decode()
        old=self.old.decode()
        for identifier in ('appearanceTab','appearanceResults','casesSection',
                           'browseGrid','saveCaseButton(entry)','faceGallery'):
            self.assertEqual(out.count(identifier),old.count(identifier))
        self.assertIn('value="osnet_hsv" selected',out)
        self.assertIn('/new/api/appearance-multivector?',out)
        self.assertIn('/new/api/appearance-search?',out)
        self.assertIn('runVerifiedMultiVectorAppearance(',out)
        self.assertIn('verified_same_person===false',out)
        self.assertIn('human_review_required===true',out)
        self.assertIn('identity_probability!==false',out)
        self.assertIn('OSNet + clothing colour',out)
        self.assertIn('Same-person status: not verified',out)
        self.assertIn('no verified S9+ appearance vectors'.lower(),out.lower())

    def test_idempotent(self):
        first,changed=module.patch_html(self.old)
        second,changed2=module.patch_html(first)
        self.assertEqual(changed,1)
        self.assertEqual(changed2,0)
        self.assertEqual(first,second)

    def test_refuses_unknown_damaged_ui(self):
        with self.assertRaises(RuntimeError):
            module.patch_html(self.old.replace(b'async function runAppearanceSearch(){',
                                               b'function disappeared(){'))
        with self.assertRaises(RuntimeError):
            module.patch_html(self.old+b'<!-- S9_MULTIVECTOR_APPEARANCE_UI_V1 -->')


if __name__=="__main__":
    unittest.main(verbosity=2)
