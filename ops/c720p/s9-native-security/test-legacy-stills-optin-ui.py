#!/usr/bin/env python3
"""S9+ archived still images are opt-in; MP4 gallery always visible."""
import importlib.util
import pathlib
import tempfile
import shutil
import subprocess
import re
import unittest

ROOT=pathlib.Path(__file__).resolve().parent
SCRIPT=ROOT/'patch-legacy-stills-optin-ui.py'
spec=importlib.util.spec_from_file_location('s9_legacy_optin',SCRIPT)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Tests(unittest.TestCase):
    @staticmethod
    def html():
        return ('<html><head></head><body>'
                '<script src="/local/c720p-secure-relay-client.js"></script>'
                '<div id="list"><section id="s9-fallback-section"></section></div>'
                '<video id="player" controls></video>'
                '<script id="s9-fallback-gallery-script-v1"></script>'
                '<script id="s9-saved-virtual-folders-script-v1"></script>'
                '</body></html>')

    def test_hidden_by_default_visible_only_after_explicit_control(self):
        old=self.html()
        new=module.patch(old)
        self.assertEqual(module.patch(new),new)
        self.assertIn('#s9-fallback-section{display:none!important}',new)
        self.assertIn('body.s9-legacy-stills-visible #s9-fallback-section',new)
        self.assertIn("button.addEventListener('click'",new)
        self.assertIn('Show legacy motion photographs (not video clips)',new)
        self.assertIn('<video id="player" controls>',new)
        self.assertIn('id="s9-saved-virtual-folders-script-v1"',new)
        self.assertNotIn('unlink(',module.SCRIPT)
        self.assertNotIn('delete(',module.SCRIPT)
        self.assertNotIn('fetch(',module.SCRIPT)
        self.assertNotIn('localStorage',module.SCRIPT)

    def test_requires_expected_gallery_versions(self):
        for old,new in [
            ('s9-fallback-gallery-script-v1','unexpected'),
            ('s9-saved-virtual-folders-script-v1','unexpected'),
            ('c720p-secure-relay-client.js','unexpected'),
            ('id="player"','id="missing"')]:
            with self.assertRaises(ValueError):
                module.patch(self.html().replace(old,new))
        with self.assertRaises(ValueError):module.patch('<html><body></body></html>')

    def test_js_syntax(self):
        node=shutil.which('node')
        if not node:self.skipTest('node unavailable')
        code=re.search(r'<script id="s9-legacy-stills-optin-script-v1">([\s\S]*?)</script>',module.SCRIPT)
        self.assertIsNotNone(code)
        with tempfile.TemporaryDirectory() as td:
            script=pathlib.Path(td)/'optin.js'
            script.write_text(code.group(1))
            process=subprocess.run([node,'--check',str(script)],capture_output=True,text=True,timeout=9)
            self.assertEqual(process.returncode,0,process.stderr)

if __name__=='__main__':
    unittest.main(verbosity=2)
