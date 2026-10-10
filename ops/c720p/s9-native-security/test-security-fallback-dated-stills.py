#!/usr/bin/env python3
"""Regression tests for dated, non-destructive fallback motion evidence."""
import importlib.util
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent
P=ROOT/'patch-security-fallback-dated-stills.py'
spec=importlib.util.spec_from_file_location('s9_fallback_dates',P)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class TestFallbackDates(unittest.TestCase):
    def page(self):
        return ('<!doctype html><html><body><section id="list"></section>'
                '<script id="s9-video-orientation-script-v1"></script>'
                '<style id="s9-fallback-gallery-v1"></style>'
                '<script id="s9-fallback-gallery-script-v1">'
                "const SECTION_ID='s9-fallback-section';"
                "const route='/new/saved/still/';"
                "const evidence=body.fallback_previews;"
                '</script></body></html>')

    def test_upgrade_is_idempotent_and_preserves_other_widgets(self):
        source=self.page()
        updated=m.patch(source)
        self.assertNotEqual(updated,source)
        self.assertEqual(m.patch(updated),updated)
        self.assertEqual(updated.count(m.SCRIPT_OPEN),1)
        self.assertEqual(updated.count(m.MARKER),1)
        self.assertIn('s9-video-orientation-script-v1',updated)
        self.assertIn('fallback_previews',updated)
        self.assertIn('Europe/Amsterdam',updated)
        self.assertIn('recording_budget_rejected',updated)
        self.assertIn('cooldown_motion',updated)
        self.assertIn('next+16',updated)
        self.assertIn('person identity',updated)
        self.assertIn("'/new/saved/still/'",updated)
        self.assertNotIn('unlink(',m.SCRIPT)
        self.assertNotIn('DELETE',m.SCRIPT)
        self.assertNotIn('localStorage',m.SCRIPT)

    def test_refuses_unknown_or_duplicate_widgets(self):
        for source in ('<html><body></body></html>',
                       self.page().replace('fallback_previews','not_known_data'),
                       self.page().replace('s9-fallback-gallery-script-v1','other-script'),
                       self.page().replace('id="s9-fallback-gallery-v1"','id="missing"')):
            with self.assertRaises(ValueError):m.patch(source)
        with self.assertRaises(ValueError):
            m.patch(self.page().replace('</body>','<script id="s9-fallback-gallery-script-v1"></script></body>'))

    def test_javascript_parses(self):
        node=shutil.which('node')
        if not node:self.skipTest('Node not installed')
        content=m.script_from(m.SCRIPT)
        js=content.split(m.SCRIPT_OPEN,1)[1].split(m.SCRIPT_CLOSE,1)[0]
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'fallback.js';p.write_text(js)
            result=subprocess.run([node,'--check',str(p)],capture_output=True,text=True,timeout=15)
            self.assertEqual(result.returncode,0,result.stderr)

if __name__=='__main__':
    unittest.main(verbosity=2)
