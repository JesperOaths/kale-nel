#!/usr/bin/env python3
"""Regression safety checks for signed S9+ Live MJPEG UI."""
import importlib.util
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent
FILE=ROOT/"patch-security-live-fetch-fallback.py"
spec=importlib.util.spec_from_file_location('s9_live_v4',FILE)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def fixture():
    return ('<html><head></head><body><img id="cameraLive">'
            '<div id="cameraStatus"></div><script>'
            '/* S9_NATIVE_RELAY_MAIN_STREAM_V2: private signed LAN relay for standalone Camera2. */'
            'let s9LiveGeneration=0;/* S9_NATIVE_RELAY_MAIN_STREAM_V3_RETAIN_MJPEG */'
            'async function streams(on){const url="/new/live.mjpg";}'
            'function refreshPhoneBatteries(){}'
            '</script></body></html>')

class Tests(unittest.TestCase):
    def test_preserves_other_tabs_and_is_idempotent(self):
        old=fixture()
        new=module.patch(old)
        self.assertNotEqual(new,old)
        self.assertEqual(module.patch(new),new)
        self.assertEqual(new.count(module.MARKER),1)
        self.assertIn("function refreshPhoneBatteries(){}",new)
        self.assertIn("cameraLive",new)
        self.assertIn("relay.fetch('/new/live.mjpg'",new)
        self.assertIn("C720PSecureRelay.url('/new/live.mjpg'",new)
        self.assertIn('AbortController',new)
        self.assertIn('multipart/x-mixed-replace',new)
        self.assertIn('s9LiveRetry',new)
        self.assertNotIn('startHA(n,',module.JS)
        self.assertNotIn('camera.s9_direct',module.JS)
        self.assertNotIn('serviceWorker',module.JS)
        self.assertNotIn('window.location',module.JS)

    def test_unknown_layout_rejected(self):
        for html in ['<html></html>',
                     fixture().replace('cameraStatus','bad-status'),
                     fixture().replace('S9_NATIVE_RELAY_MAIN_STREAM_V2','other-stream')]:
            with self.assertRaises(ValueError):module.patch(html)

    def test_javascript_parses(self):
        node=shutil.which('node')
        if not node:self.skipTest('Node.js unavailable')
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'live.js'
            p.write_text(module.JS)
            result=subprocess.run([node,'--check',str(p)],capture_output=True,text=True,timeout=15)
            self.assertEqual(result.returncode,0,result.stderr)

if __name__=='__main__':
    unittest.main(verbosity=2)
