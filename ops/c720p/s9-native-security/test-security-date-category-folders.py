#!/usr/bin/env python3
"""Static and JS checks for non-destructive saved-clip date/category folders."""
import importlib.util
import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT=pathlib.Path(__file__).resolve().parent
SCRIPT=ROOT/"patch-security-date-category-folders.py"
spec=importlib.util.spec_from_file_location("s9_folders",SCRIPT)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class TestFolders(unittest.TestCase):
    def page(self):
        return ('<!doctype html><html><head><script src="/local/c720p-secure-relay-client.js"></script></head>'
                '<body><div id="list"></div><video id="player" controls></video>'
                '<script id="s9-video-orientation-script-v1"></script></body></html>')

    def test_installer_is_non_destructive_and_idempotent(self):
        original=self.page()
        updated=module.patch(original)
        self.assertNotEqual(updated,original)
        self.assertEqual(module.patch(updated),updated)
        self.assertEqual(updated.count(module.MARKER),1)
        self.assertEqual(updated.count(module.STYLE),1)
        self.assertIn('id="player"',updated)
        self.assertIn('s9-date-folders',updated)
        self.assertIn("Europe/Amsterdam",updated)
        self.assertIn('content_categories',updated)
        self.assertIn("C720PSecureRelay",updated)
        self.assertIn("onClick" if False else "addEventListener('click'",updated)
        self.assertIn('model estimates',updated)
        self.assertNotIn('DELETE',module.SNIPPET)
        self.assertNotIn('unlink(',module.SNIPPET)
        self.assertNotIn('localStorage.setItem',module.SNIPPET)
        self.assertNotIn('fetch("/new/saved/clip/',module.SNIPPET)

    def test_refuses_unknown_pages(self):
        with self.assertRaises(ValueError):module.patch("<body></body>")
        with self.assertRaises(ValueError):module.patch(self.page().replace('s9-video-orientation-script-v1','unknown'))
        with self.assertRaises(ValueError):module.patch(self.page().replace('c720p-secure-relay-client.js','missing'))
        with self.assertRaises(ValueError):module.patch(module.patch(self.page()).replace(module.STYLE,'id="partial"'))

    def test_javascript_syntax(self):
        node=shutil.which('node')
        if not node:self.skipTest('Node is unavailable')
        scripts=re.findall(r'<script id="s9-saved-virtual-folders-script-v1">([\s\S]*?)</script>',module.SNIPPET)
        self.assertEqual(len(scripts),1)
        with tempfile.TemporaryDirectory() as td:
            p=pathlib.Path(td)/"folders.js"
            p.write_text(scripts[0])
            result=subprocess.run([node,'--check',str(p)],capture_output=True,text=True,timeout=20)
            self.assertEqual(result.returncode,0,result.stderr)

if __name__=="__main__":
    unittest.main(verbosity=2)
