#!/usr/bin/env python3
"""Synthetic Security Appearance Search V3 UI patch contracts."""
from pathlib import Path
import importlib.util
import unittest

ROOT=Path(__file__).resolve().parent

def source(alias,name):
    spec=importlib.util.spec_from_file_location(alias,ROOT/name)
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    return mod

v3=source("security_v3_ui","deploy-s9-appearance-v3-ui.py")
v1=source("security_v1_ui","deploy-s9-multivector-appearance-ui-v1.py")
BASE=(ROOT/"security-face-folders-v22.html").read_bytes()

class TestAppearanceV3(unittest.TestCase):
    def test_stock_page_preserved_and_new_opt_in_mode(self):
        changed,state=v3.patch(BASE)
        self.assertTrue(state)
        html=changed.decode("utf-8")
        older=BASE.decode("utf-8")
        self.assertEqual(html.count(v3.OPTION),1)
        self.assertIn("/new/api/appearance-multivector-v3?",html)
        for marker in ('id="caseFolders"','id="appearanceResults"',
                       'id="browseGrid"','id="appearanceGo"',
                       'async function runAppearanceSearch(){',
                       '/new/api/appearance-search?'):
            self.assertEqual(older.count(marker),html.count(marker))
        self.assertIn("doc.automatic_person_assignments!==0",html)
        self.assertIn("doc.identity_probability!==false",html)
        self.assertIn("doc.human_review_required!==true",html)
        self.assertIn("hit.verified_same_person!==false",html)
        self.assertIn("Review original clip",html)
        self.assertIn("runV3ArchiveAppearance(clip,zone,run,status,host,button)",html)
        self.assertLess(html.index("if(category==='osnet_hsv_v3')"),
                        html.index("if(!clipOK.test(clip)",html.index("async function runAppearanceSearch(){")))
        self.assertEqual(v3.patch(changed),(changed,False))

    def test_existing_v1_mode_is_retained(self):
        with_v1,changed_v1=v1.patch_html(BASE)
        self.assertTrue(changed_v1)
        merged,changed_v3=v3.patch(with_v1)
        self.assertTrue(changed_v3)
        out=merged.decode()
        for marker in ("S9_MULTIVECTOR_APPEARANCE_UI_V1",
                       '/new/api/appearance-multivector?',
                       "runVerifiedMultiVectorAppearance(clip,zone,run,status,host,button)",
                       "value=\"osnet_hsv\" selected",
                       '/new/api/appearance-search?',
                       'id="caseFolders"'):
            self.assertIn(marker,out)
        self.assertEqual(out.count(v3.OPTION),1)
        self.assertEqual(v3.patch(merged),(merged,False))

    def test_partial_or_concurrent_patch_fails_closed(self):
        bad=BASE.replace(b'async function runAppearanceSearch(){',
                         b'function changedWithoutReview(){')
        with self.assertRaisesRegex(RuntimeError,"anchor"):
            v3.patch(bad)
        with self.assertRaisesRegex(RuntimeError,"Partially"):
            v3.patch(BASE+b"<!-- S9_V3_APPEARANCE_SEARCH_UI_20261019 -->")
        with self.assertRaisesRegex(RuntimeError,"anchor"):
            v3.patch(BASE.replace(
                b'<option value="upper_clothing">Upper clothing colour</option>',
                b'<option value="other">Other</option>'))

if __name__=="__main__":unittest.main(verbosity=2)
