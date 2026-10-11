#!/usr/bin/env python3
"""Integration tests for safe Security V4 two-page HTML installation."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

HERE=Path(__file__).resolve().parent
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,HERE/file)
 mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
 return mod
deploy=load('ui4deploy','deploy-security-ui-v4.py')
orientation=load('ui4rotation','patch-s9-saved-video-orientation.py')
folders=load('ui4folders','patch-security-date-category-folders.py')
compact=load('ui4compact','patch-security-compact-layout.py')

def saved_page():
 plain=('<html><head><script src="/local/c720p-secure-relay-client.js"></script></head>'
  '<body><main><div id="list"><button>Legacy archive row</button></div>'
  '<video id="player" controls></video></main></body></html>')
 return orientation.patch(plain)

def live_page():
 return ('<html><head></head><body>'
  '<section class="panel" id="panel-live"><div class="c720p-s9-live-only">'
  '<div class="cam"><img id="cameraLive"></div></div></section>'
  '<section class="panel" id="panel-saved">Keep historical archive</section>'
  '</body></html>')

class DeploymentTests(unittest.TestCase):
 def setup_pages(self,temp):
  root=Path(temp)/'www';(root/'frontyard-security-new').mkdir(parents=True)
  saved=root/'frontyard-security-new/clips.html'
  live=root/'c720p-surveillance.html'
  saved.write_text(saved_page());live.write_text(live_page())
  return root,saved,live

 def test_transactional_install_backups_and_preserves_originals(self):
  with tempfile.TemporaryDirectory() as td:
   root,saved,live=self.setup_pages(td)
   sb,lb=saved.read_text(),live.read_text()
   updates=deploy.plan(HERE,root)
   self.assertEqual(len(updates),2)
   report=deploy.install(updates,Path(td)/'backups')
   self.assertFalse(report['recordings_modified'])
   self.assertFalse(report['camera_app_modified'])
   self.assertTrue(report['changed'][str(saved)])
   self.assertTrue(report['changed'][str(live)])
   self.assertEqual(deploy.plan(HERE,root)[saved][0],deploy.plan(HERE,root)[saved][1])
   self.assertEqual(deploy.plan(HERE,root)[live][0],deploy.plan(HERE,root)[live][1])
   files=list(Path(report['backup']).glob('*'))
   self.assertEqual(len(files),2)
   self.assertIn(sb,[p.read_text() for p in files])
   self.assertIn(lb,[p.read_text() for p in files])
   self.assertIn('s9-v4-legend',saved.read_text())
   self.assertIn('s9-compact-layout',saved.read_text())
   self.assertIn('max-height:70dvh',live.read_text())
   self.assertIn('Keep historical archive',live.read_text())

 def test_fail_closed_before_write_on_unknown_live_page(self):
  with tempfile.TemporaryDirectory() as td:
   root,saved,live=self.setup_pages(td)
   original=saved.read_text()
   live.write_text(live.read_text().replace('id="cameraLive"','id="unknown"'))
   with self.assertRaises(ValueError):deploy.plan(HERE,root)
   self.assertEqual(saved.read_text(),original)

 def test_upgrade_old_compact_css_instead_of_skipping_existing_marker(self):
  old=folders.patch(saved_page())
  old=compact.patch(old,'saved')
  regressed=old.replace('max-width:360px!important','max-width:950px!important')
  self.assertNotEqual(old,regressed)
  upgraded=compact.patch(regressed,'saved')
  self.assertEqual(upgraded,old)
  self.assertEqual(compact.patch(upgraded,'saved'),upgraded)
  older=compact.patch(live_page(),'live')
  oversized=older.replace('max-height:70dvh','max-height:105dvh')
  self.assertEqual(compact.patch(oversized,'live'),older)

 def test_no_media_or_privilege_mutations_in_ui_installer(self):
  code=(HERE/'deploy-security-ui-v4.py').read_text()
  for unsafe in ('adb shell','adb install','unlink(','.delete(','.mp4.recording','delete from','DROP TABLE'):
   self.assertNotIn(unsafe,code)
  self.assertIn('REQUIRED_ORIGINAL_SAVED',code)
  self.assertIn('REQUIRED_ORIGINAL_LIVE',code)

if __name__=='__main__':unittest.main(verbosity=2)
