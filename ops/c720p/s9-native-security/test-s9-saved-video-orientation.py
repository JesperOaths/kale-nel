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

    def test_native_auto_rotation_scoped_and_upgradable(self):
        updated=module.patch(self.page())
        self.assertIn('const autoAngle=',updated)
        self.assertIn("button('Auto'",updated)
        self.assertIn("loadedmetadata",updated)
        self.assertIn("state.auto?autoAngle",updated)
        self.assertIn("if(state.label.textContent!==label)",updated)
        # A previously installed version-one widget must be upgradeable
        # without duplicating styles, controls, or rewriting its parent page.
        stale=updated.replace("const autoAngle=", "const oldAutoAngle=", 1)
        repaired=module.patch(stale)
        self.assertEqual(repaired,updated)
        self.assertEqual(repaired.count(module.STYLE),1)
        self.assertEqual(repaired.count(module.SCRIPT),1)
        node=shutil.which('node')
        if node:
            match=re.search(r'(const autoAngle=[\\s\\S]*?\\? 90 : 0;)',updated)
            self.assertIsNotNone(match)
            checks="""
const v=(w,h)=>({videoWidth:w,videoHeight:h});
if(autoAngle('motion_1791600000000.mp4',v(2160,3840))!==90)throw Error('native portrait');
if(autoAngle('motion_1791600000000.mp4',v(3840,2160))!==0)throw Error('native landscape');
if(autoAngle('rec_2026-10-09_16-25.mp4',v(1080,1920))!==0)throw Error('legacy never automatically rotated');
if(autoAngle('motion_1791600000000.mp4',v(0,0))!==0)throw Error('before metadata');
"""
            result=subprocess.run([node,'-e',match.group(1)+'\\n'+checks],
                                  capture_output=True,text=True,timeout=15)
            self.assertEqual(result.returncode,0,result.stderr)

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
