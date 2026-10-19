#!/usr/bin/env python3
"""Offline patch preservation and real-JavaScript lifecycle regression tests."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE=Path(__file__).resolve().parent
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('review_lifecycle',HERE/'patch-security-review-lifecycle-v1.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
FIXTURES=HERE/'tests/fixtures/security-review-lifecycle-v1'
TEMP_ROOT=os.environ.get('C720P_TEST_TMPDIR')

def fixture_path(name):
 return FIXTURES/(name+'.fixture' if name.endswith('.html') else name)

class LifecycleTests(unittest.TestCase):
 def test_narrow_changes_preserve_migration_review_and_other_scripts(self):
  for name in p.FILES:
   original=fixture_path(name).read_text(encoding='utf-8')
   for newline in ('\n','\r\n'):
    with self.subTest(name=name,newline=repr(newline)):
     before='/* OTHER_CHAT_FEATURE_KEEP */\n'+original
     before=before.replace('\n',newline)
     after=p.patch_asset(name,before)
     self.assertNotEqual(before,after)
     self.assertEqual(after,p.patch_asset(name,after))
     self.assertTrue(after.startswith('/* OTHER_CHAT_FEATURE_KEEP */'+newline))
     if newline=='\r\n':self.assertNotIn('\n',after.replace('\r\n',''))
     if name=='security-review-v8.html':
      marker='<script id="c720p-migrated-recordings-ui">'
      self.assertIn(marker,before)
      self.assertEqual(before[before.index(marker):],after[after.index(marker):])

 def test_partial_or_unknown_source_is_rejected(self):
  for name,marker in zip(p.FILES,(p.OUTFIT_MARKER,p.REVIEW_MARKER,p.NIGHT_MARKER)):
   original=fixture_path(name).read_text(encoding='utf-8')
   with self.subTest(name=name):
    with self.assertRaises(ValueError):p.patch_asset(name,marker+'\n'+original)
    with self.assertRaises(ValueError):p.patch_asset(name,'unknown concurrent rewrite')

 def test_older_canonical_hsv_path_is_patched_without_inserting_a_model_pipeline(self):
  original=fixture_path('security-people-v45.js').read_text(encoding='utf-8')
  start=original.index(p.OUTFIT_ANCHOR)
  end=original.index('async function searchClothingMatches(force=false){',start)
  canonical=original[:start]+original[end:]
  after=p.patch_asset('security-people-v45.js',canonical)
  self.assertNotIn('async function addReviewedOsnetMatches(',after)
  self.assertEqual(after.count(p.OUTFIT_NEW),1)
  self.assertEqual(after,p.patch_asset('security-people-v45.js',after))

 def test_stage_is_separate_and_does_not_write_on_an_invalid_later_asset(self):
  with tempfile.TemporaryDirectory(dir=TEMP_ROOT) as folder:
   source=Path(folder)/'source';source.mkdir();output=Path(folder)/'output'
   for name in p.FILES:(source/name).write_bytes(fixture_path(name).read_bytes())
   with self.assertRaises(ValueError):p.stage(source,source)
   with self.assertRaises(ValueError):p.stage(source,source/'nested')
   night=source/p.FILES[-1]
   night.write_text('unknown night source',encoding='utf-8')
   with self.assertRaises(ValueError):p.stage(source,output)
   self.assertFalse(output.exists())
   night.write_bytes(fixture_path(night.name).read_bytes())
   before={name:(source/name).read_bytes() for name in p.FILES}
   manifest=p.stage(source,output)
   self.assertEqual(before,{name:(source/name).read_bytes() for name in p.FILES})
   self.assertTrue(all(row['changed'] for row in manifest['files'].values()))
   self.assertEqual(manifest,json.loads((output/'review-lifecycle-manifest.json').read_text()))
   with self.assertRaises(ValueError):p.stage(source,output)

 def test_real_js_outfit_decisions_visibility_protocol_and_night_polling(self):
  with tempfile.TemporaryDirectory(dir=TEMP_ROOT) as folder:
   source=Path(folder)/'source';source.mkdir()
   for name in p.FILES:(source/name).write_bytes(fixture_path(name).read_bytes())
   output=Path(folder)/'stage';p.stage(source,output)
   result=subprocess.run([os.environ.get('C720P_TEST_NODE','node'),
    str(HERE/'test-security-review-lifecycle-runtime-v1.mjs'),str(output)],
    capture_output=True,text=True,timeout=30)
   self.assertEqual(result.returncode,0,result.stdout+result.stderr)
   self.assertIn('SECURITY_REVIEW_LIFECYCLE_RUNTIME_PASS',result.stdout)

if __name__=='__main__':unittest.main(verbosity=2)
