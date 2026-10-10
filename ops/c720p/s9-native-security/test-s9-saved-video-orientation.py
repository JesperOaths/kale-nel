#!/usr/bin/env python3
"""Regression checks for HTML-only per-clip orientation controls."""
import importlib.util
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

HERE=Path(__file__).resolve().parent
SRC=HERE/"patch-s9-saved-video-orientation.py"
spec=importlib.util.spec_from_file_location("s9_orientation",SRC)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Tests(unittest.TestCase):
    def page(self):
        return ('<html><head><script src="/local/c720p-secure-relay-client.js">'
                '</script></head><body><div id="list"></div>'
                '<video id="player" controls></video></body></html>')

    def test_idempotent_and_source_playback_unmodified(self):
        original=self.page()
        updated=module.patch(original)
        self.assertNotEqual(original,updated)
        self.assertEqual(module.patch(updated),updated)
        self.assertIn('id="player" controls',updated)
        self.assertIn('c720p-secure-relay-client.js',updated)
        self.assertIn('localStorage.setItem(PREFIX+name',updated)
        self.assertIn('decodeURIComponent(src)',updated)
        self.assertIn('rotate(',updated)
        self.assertIn('Reset',updated)
        self.assertIn('HTML5 MP4',SRC.read_text())
        self.assertNotIn('fetch(',module.SNIPPET)
        self.assertNotIn('XMLHttpRequest',module.SNIPPET)
        self.assertNotIn('MediaRecorder',module.SNIPPET)
        self.assertNotIn('removeAttribute(',module.SNIPPET)

    def test_refuses_unsafe_or_partial_html(self):
        with self.assertRaises(ValueError):
            module.patch('<html><body></body></html>')
        with self.assertRaises(ValueError):
            module.patch(self.page().replace('c720p-secure-relay-client.js','unsigned.js'))
        full=module.patch(self.page())
        with self.assertRaises(ValueError):
            module.patch(full.replace(module.SCRIPT,'id="orphaned-script"'))
        with self.assertRaises(ValueError):
            module.patch(full.replace("</body>",module.SNIPPET+"</body>"))

    def test_javascript_parses(self):
        node=shutil.which('node')
        if not node:
            self.skipTest("Node unavailable")
        result=module.patch(self.page())
        scripts=re.findall(r'<script id="s9-video-orientation-script-v1">([\s\S]*?)</script>',result)
        self.assertEqual(len(scripts),1)
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/"rotation.js"
            p.write_text(scripts[0])
            proc=subprocess.run([node,"--check",str(p)],capture_output=True,text=True,timeout=15)
            self.assertEqual(proc.returncode,0,proc.stderr)

if __name__=="__main__":
    unittest.main(verbosity=2)
