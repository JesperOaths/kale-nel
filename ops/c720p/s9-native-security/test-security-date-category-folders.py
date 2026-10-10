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

    def test_upgrade_previous_live_folder_widget_and_keep_all_clips(self):
        updated=module.patch(self.page())
        self.assertIn('(?:motion|native4k)_',updated)
        stale=updated.replace(
            'const native=/^(?:motion|native4k)_([0-9]{13})[.]mp4$/;',
            'const native=/^motion_([0-9]{13})[.]mp4$/;',1)
        stale=stale.replace(
            'const safe=/^(?:(?:motion|native4k)_[0-9]{13}|',
            'const safe=/^(?:motion_[0-9]{13}|',1)
        self.assertNotEqual(stale,updated)
        repaired=module.patch(stale)
        self.assertEqual(repaired,updated)
        self.assertEqual(repaired.count(module.MARKER),1)
        self.assertEqual(module.patch(repaired),repaired)

    def test_native4k_and_legacy_filenames_accepted_in_actual_js(self):
        node=shutil.which('node')
        if not node:self.skipTest('Node unavailable')
        js=module.SNIPPET.split('<script id="s9-saved-virtual-folders-script-v1">',1)[1].split('</script>',1)[0]
        native=next(x.strip() for x in js.splitlines() if x.strip().startswith('const native='))
        safe=next(x.strip() for x in js.splitlines() if x.strip().startswith('const safe='))
        checks="""
for(const name of ['motion_1791653043670.mp4','native4k_1791576078307.mp4','rec_2026-10-09_22-40.mp4'])
 if(!safe.test(name))throw Error('missing clip '+name);
for(const name of ['../../etc/passwd','native4k_bad.mp4','motion_123.mp4'])
 if(safe.test(name))throw Error('unsafe clip '+name);
if(!native.test('native4k_1791576078307.mp4'))throw Error('native4k date grouping');
"""
        result=subprocess.run([node,'-e',native+chr(10)+safe+chr(10)+checks],
            capture_output=True,text=True,timeout=15)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_possible_person_evidence_is_visible_but_not_automatically_confirmed(self):
        node=shutil.which('node')
        if not node:self.skipTest('Node unavailable')
        source=module.SNIPPET
        start=source.index(' const category=r=>{')
        end=source.index(' const tag=',start)
        body=source[start:end]
        checks="""
const possible={scene_category:'motion_other',person_count:0,
 person_event_category:'possible_person_below_standard_threshold',
 content_categories:['vehicle']};
if(category(possible)!=='possible')throw Error('low-confidence person hidden by vehicle');
if(category({scene_category:'one_person',person_count:1})!=='person')throw Error('strong person label');
if(category({scene_category:'motion_other',content_categories:['vehicle'],person_event_category:'no_person_model_detection'})!=='vehicle')throw Error('vehicle label');
if(category({scene_category:'unreviewed'})!=='unreviewed')throw Error('unknown recording label');
"""
        result=subprocess.run([node,'-e',body+chr(10)+checks],
            capture_output=True,text=True,timeout=15)
        self.assertEqual(result.returncode,0,result.stderr)

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
