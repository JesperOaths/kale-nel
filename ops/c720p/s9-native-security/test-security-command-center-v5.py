#!/usr/bin/env python3
"""Security V5 UI redesign contract, JavaScript and transactional safety."""
import importlib.util
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

HERE=Path(__file__).resolve().parent
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,HERE/file)
 mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
 return mod
layout=load('v5_layout','patch-security-command-center-v5.py')
extras=load('v5_extras','patch-security-secondary-pages-v5.py')
deploy=load('v5_deploy','deploy-security-command-center-v5.py')

def security():
 return ('<!doctype html><html><head><style>body{background:#111}</style></head><body>'
         '<nav><button data-tab="camera">Camera</button><button data-tab="live">Live</button>'
         '<button data-tab="saved">Saved</button><button data-tab="faces">Faces</button></nav>'
         '<section class="panel" id="panel-camera">Existing camera settings</section>'
         '<section class="panel" id="panel-live"><div class="c720p-s9-live-only"><div class="cam">'
         '<img id="cameraLive"></div><div id="cameraStatus">Existing relay</div></div></section>'
         '<section class="panel" id="panel-faces"><iframe id="s9FacesGalleryFrame" '
         'data-src="/local/frontyard-security-new/face-appearances.html"></iframe></section>'
         '<section class="panel" id="panel-saved"><div class="s9-saved-subnav">'
         '<button data-s9-saved="microSD">microSD</button><button data-s9-saved="drive">Drive</button></div>'
         '<iframe id="s9SavedFolderFrame" data-src="/local/frontyard-security-new/clips.html"></iframe>'
         '<iframe id="cameraSavedFrame" data-src="/local/c720p-drive-saved.html"></iframe></section>'
         '<script>window.C720PSecureRelay={fetch(){},url(){}}</script></body></html>')

def clips():
 return ('<!doctype html><html><head><style id="s9-compact-recordings-v1"></style></head>'
         '<body><section id="s9-compact-layout"><div class="s9-playback-pane">'
         '<video id="player"></video></div><div class="s9-selector-pane">'
         '<div id="list">C720PSecureRelay /new/saved/clip/</div></div></section>'
         '<script id="s9-saved-virtual-folders-script-v1"></script></body></html>')

def face():
 return ('<!doctype html><html><head></head><body><section class="stats">Stats</section>'
         '<div id="filters"></div><main id="gallery"></main>'
         '<dialog id="playerDialog"><video id="player"></video></dialog>'
         '<p>Face metadata and recordings</p></body></html>')

def archive():
 return ('<!doctype html><html><head></head><body><div id="list"></div>'
         '<script>C720PSecureRelay.fetch("/api/saved")</script>'
         '<video controls></video></body></html>')

class V5Tests(unittest.TestCase):
 def test_all_pages_patch_and_upgrade_without_duplication(self):
  for patch,original,style,script in [
   (layout.patch_security,security(),'s9v5-command-style','s9v5-command-script'),
   (layout.patch_clips,clips(),'s9v5-browser-style','s9v5-browser-script'),
   (extras.face,face(),'s9v5-face-style',None),
   (extras.archive,archive(),'s9v5-drive-style',None)
  ]:
   p=patch(original)
   self.assertNotEqual(p,original)
   self.assertEqual(patch(p),p)
   self.assertEqual(p.count('id="'+style+'"'),1)
   if script:self.assertEqual(p.count('id="'+script+'"'),1)
   self.assertIn('</body>',p)
   self.assertIn('</head>',p)
   self.assertEqual(p.count('<video'),original.count('<video'))
   # Re-style earlier version in-place, not by overlaying another CSS block.
   replacement=p.replace('border-radius:16px','border-radius:97px')
   self.assertEqual(patch(replacement),p)

 def test_structural_screen_contract(self):
  js=layout.ROOT_JS
  for needle in ["['overview','Overview'","['live','Live camera'","['saved','Recordings'",
                 "['faces','People & faces'","['archive','Archive'","['camera','Camera settings'",
                 "source.click()","s9SavedFolderFrame","cameraSavedFrame",
                 "s9FacesGalleryFrame","showPanel(id)","aria-current",
                 "new Intl.DateTimeFormat","lastData?.live"]:
   self.assertIn(needle,js)
  self.assertIn("grid-template-columns:224px",layout.ROOT_CSS)
  self.assertIn("grid-template-rows:minmax(0,1fr) 72px",layout.ROOT_CSS)
  self.assertIn("max-height:260px",layout.CLIPS_CSS)
  self.assertIn(".s9v5-live-stage",layout.ROOT_CSS)
  self.assertIn("max-height:69dvh",layout.ROOT_CSS)
  self.assertIn("object-fit:contain",layout.ROOT_CSS)
  self.assertIn("70",layout.ROOT_CSS)
  self.assertIn("Person candidates",layout.ROOT_JS)
  self.assertIn("unverified",layout.ROOT_JS.lower())

 def test_guards_do_not_mutate_unknown_pages(self):
  with self.assertRaises(ValueError):layout.patch_security('<html><head></head><body>incomplete</body></html>')
  with self.assertRaises(ValueError):layout.patch_clips('<html><head></head><body>incomplete</body></html>')
  with self.assertRaises(ValueError):extras.face('<html><head></head><body>blank</body></html>')
  with self.assertRaises(ValueError):extras.archive('<html><head></head><body>blank</body></html>')
  invalid=security().replace('id="panel-live"','id="unknown"')
  with self.assertRaises(ValueError):layout.patch_security(invalid)

 def test_js_parses(self):
  node=shutil.which('node')
  if not node:self.skipTest('Node missing')
  for name,block in [('command',layout.ROOT_JS),('browser',layout.CLIPS_JS)]:
   found=re.findall(r'<script[^>]+>([\s\S]*?)</script>',block)
   self.assertEqual(len(found),1)
   with tempfile.TemporaryDirectory() as td:
    fn=Path(td)/(name+'.js');fn.write_text(found[0])
    p=subprocess.run([node,'--check',str(fn)],capture_output=True,text=True,timeout=20)
    self.assertEqual(p.returncode,0,p.stderr)

 def test_transaction_four_files_and_no_media(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td)/'www'
   (root/'frontyard-security-new').mkdir(parents=True)
   fixtures={'c720p-surveillance.html':security(),
             'frontyard-security-new/clips.html':clips(),
             'frontyard-security-new/face-appearances.html':face(),
             'c720p-drive-saved.html':archive()}
   for p,contents in fixtures.items():(root/p).write_text(contents+'\n<!-- '+('test-padding-'*75)+' -->')
   originals={p:(root/p).read_bytes() for p in fixtures}
   changes=deploy.build(root,HERE)
   self.assertEqual(len(changes),4)
   self.assertTrue(all(o!=n for o,n in changes.values()))
   result=deploy.deploy(changes,Path(td)/'backups')
   self.assertFalse(result['apk_modified'])
   self.assertFalse(result['recordings_modified'])
   self.assertEqual(len(list(Path(result['backup']).glob('*'))),4)
   for p in fixtures:
    self.assertNotEqual((root/p).read_bytes(),originals[p])
   stable=deploy.build(root,HERE)
   self.assertTrue(all(o==n for o,n in stable.values()))

 def test_dry_run_refuses_missing_page_before_any_write(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td)/'www'
   (root/'frontyard-security-new').mkdir(parents=True)
   (root/'c720p-surveillance.html').write_text(security()*8)
   before=(root/'c720p-surveillance.html').read_bytes()
   with self.assertRaises((RuntimeError,ValueError)):deploy.build(root,HERE)
   self.assertEqual((root/'c720p-surveillance.html').read_bytes(),before)

if __name__=='__main__':unittest.main(verbosity=2)
