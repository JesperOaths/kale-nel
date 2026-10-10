#!/usr/bin/env python3
"""Regression tests for JPEG preview orientation correction."""
import importlib.util
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
import unittest

HERE=Path(__file__).resolve().parent
SRC=HERE/"patch-s9-thumb-upright-ui.py"
spec=importlib.util.spec_from_file_location("thumb_upright",SRC)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Tests(unittest.TestCase):
    def page(self):
        return ('''<!DOCTYPE html><html><head><script src="/local/c720p-secure-relay-client.js"></script></head>'''
                '''<body><div id="list"></div><script id="s9-video-orientation-script-v1"></script>'''
                '''<div id="s9-human-review"><div class="review-card"></div></div></body></html>''')

    def test_safely_adds_and_is_idempotent(self):
        src=self.page()
        new=module.patch(src)
        self.assertNotEqual(src,new)
        self.assertEqual(module.patch(new),new)
        self.assertIn('s9-native-thumb-upright-script-v1',new)
        self.assertIn('s9-native-thumb-upright-style-v1',new)
        self.assertIn('s9-human-review',new)
        self.assertIn('c720p-secure-relay-client.js',new)
        self.assertEqual(new.count(module.STYLE_ID),1)
        self.assertEqual(new.count(module.SCRIPT_ID),1)
        self.assertIn('s9-phone-thumbs',new)
        self.assertIn('naturalHeight<=img.naturalWidth*1.3',new)
        self.assertIn('.s9phone-item img',new)
        self.assertIn('#s9-human-review .review-card img',new)
        self.assertIn('transform:translate(-50%,-50%) rotate(90deg)',new)
        self.assertNotIn('fetch(',module.SNIPPET)
        self.assertNotIn('XMLHttpRequest',module.SNIPPET)
        self.assertNotIn('localStorage',module.SNIPPET)

    def test_refuses_unknown_pages_and_partial_widgets(self):
        with self.assertRaises(ValueError):
            module.patch('<html><body></body></html>')
        with self.assertRaises(ValueError):
            module.patch(self.page().replace('s9-video-orientation-script-v1','no-video-widget'))
        with self.assertRaises(ValueError):
            module.patch(self.page().replace('c720p-secure-relay-client.js','unsafe.js'))
        with self.assertRaises(ValueError):
            module.patch(module.patch(self.page()).replace(module.SCRIPT_ID,'id="orphaned"'))

    def test_script_parses_and_classification_is_strict(self):
        node=shutil.which("node")
        if not node:self.skipTest("Node.js not installed")
        script=re.findall(r'<script id="s9-native-thumb-upright-script-v1">([\s\S]*?)</script>',module.SNIPPET)
        self.assertEqual(len(script),1)
        with tempfile.TemporaryDirectory() as temp:
            f=Path(temp)/"thumb.js"
            f.write_text(script[0])
            p=subprocess.run([node,"--check",str(f)],capture_output=True,text=True,timeout=15)
            self.assertEqual(p.returncode,0,p.stderr)
        regexline=next(line for line in script[0].splitlines() if line.strip().startswith('const match='))
        assertions = r'''
const accepts=(name)=>match.test(name);
if(!accepts('/local/frontyard-security-new/s9-phone-thumbs/motion_1791634574261.mp4.thumb.jpg'))throw Error('native not matched');
for(const path of [
 '/local/frontyard-security-new/s9-phone-thumbs/rec_2026-10-09_21-29.mp4.thumb.jpg',
 '/local/frontyard-security-new/stills/preview_motion_1791634574261.jpg',
 '/new/saved/still/motion_1791634574261.jpg',
 '/new/saved/clip/motion_1791634574261.mp4'
])if(accepts(path))throw Error('inappropriate image '+path);
'''
        result=subprocess.run([node,"-e",regexline+chr(10)+assertions],
                              capture_output=True,text=True,timeout=15)
        self.assertEqual(result.returncode,0,result.stderr)

if __name__=="__main__":
    unittest.main(verbosity=2)
