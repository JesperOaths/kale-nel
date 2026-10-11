#!/usr/bin/env python3
"""Security V7 release checks; no camera access required."""
import importlib.util,re,shutil,subprocess,tempfile,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("s9_security_v7",HERE/"deploy-security-v7.py")
v7=importlib.util.module_from_spec(spec);spec.loader.exec_module(v7)
def root_fixture():
 return '''<!doctype html><html><head></head><body>
 <section class="panel" id="panel-saved"><iframe id="cameraSavedFrame" data-src="/local/c720p-drive-saved.html"></iframe>
 <iframe id="s9SavedFolderFrame"></iframe></section>
 <script id="s9v5-command-script"></script><script id="s9v6-security-script"></script>
 <style id="s9v6-security-style"></style></body></html>'''
def clips_fixture():
 return '''<!doctype html><html><head><style id="s9-anonymous-clips-style-v1">x</style></head>
 <body><main id="list"></main><script id="s9v5-browser-script"></script>
 <style id="s9v6-recordings-style"></style>
 <script id="s9-saved-virtual-folders-script-v1"></script>
 <script id="s9-anonymous-clips-script-v1">const x = "S9+ anonymous tracks & clothing colours";</script>
 </body></html>'''
class V7Tests(unittest.TestCase):
 def test_navigation_patches_idempotent(self):
  for fn,original in [(v7.patch_root,root_fixture()),(v7.patch_recordings,clips_fixture())]:
   updated=fn(original);self.assertNotEqual(updated,original);self.assertEqual(fn(updated),updated)
   self.assertEqual(original.count("</body>"),updated.count("</body>"))
  new=v7.patch_recordings(clips_fixture())
  self.assertNotIn('id="s9-anonymous-clips-script-v1"',new)
  self.assertNotIn('id="s9-anonymous-clips-style-v1"',new)
  self.assertIn('scrollbar-gutter:stable',new)
  self.assertIn('flex:1 1 0%',new)
 def test_new_navigation_and_archive_link(self):
  self.assertIn('dataset.view=',v7.ROOT_JS)
  self.assertIn('s9v7-tracks-pane',v7.ROOT_JS)
  self.assertIn('cameraSavedFrame',v7.ROOT_JS)
  self.assertIn('security-archive-v7.html',v7.ROOT_JS)
 def test_drive_and_micro_sd_are_both_available_in_archive(self):
  page=(HERE/'security-archive-v7.html').read_text()
  self.assertIn('id="driveTab"',page)
  self.assertIn('<script src="/gejast-auth-gate.js?v817"></script>',page)
  self.assertIn('id="localTab"',page)
  self.assertIn('role="tablist"',page)
  self.assertIn('aria-selected="true" aria-controls="driveLibrary"',page)
  self.assertIn('data-src="/local/c720p-drive-saved.html?camera=camera&amp;',page)
  self.assertIn("showSource('drive');",page)
  self.assertIn('window.parent.C720PSecureRelay',page)
  self.assertIn("if(!localLoaded){localLoaded=true;refresh();}",page)
  self.assertIn("a.fetch('/new/api/saved'",page)
  self.assertIn("a.url('/new/saved/clip/'",page)
  self.assertIn("a.url('/new/saved/snap/'",page)
  # Video bytes remain on their existing storage services.
  self.assertNotIn('drive.google.com/uc',page)
  self.assertNotIn('drive.google.com/file',page)

 def test_js_syntax(self):
  if not shutil.which("node"):self.skipTest("Node unavailable")
  sources=[v7.ROOT_JS]
  for target in ('security-archive-v7.html','security-tracks-v7.html'):
   sources.append((HERE/target).read_text())
  for i,source in enumerate(sources):
   found=re.findall(r'<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)</script>',source)
   self.assertEqual(len(found),1,str(i))
   with tempfile.TemporaryDirectory() as tmp:
    p=Path(tmp)/"test.js";p.write_text(found[0])
    check=subprocess.run(['node','--check',str(p)],text=True,capture_output=True,timeout=15)
    self.assertEqual(check.returncode,0,str(i)+":"+check.stderr)
 def test_templates_validation(self):
  for kind in ('archive','tracks'):
   v7.validate_template((HERE/('security-'+kind+'-v7.html')).read_text(),kind)
 def test_atomic_install_and_readback(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp)/"www";(root/'frontyard-security-new').mkdir(parents=True)
   (root/'c720p-surveillance.html').write_text(root_fixture()+("pad "*300))
   (root/'frontyard-security-new/clips.html').write_text(clips_fixture()+("pad "*300))
   first=v7.deploy(root,HERE,Path(tmp)/"backup",apply=False)
   self.assertTrue(first['dry_run']);self.assertEqual(len(first['changed']),4)
   result=v7.deploy(root,HERE,Path(tmp)/"backup",apply=True)
   self.assertTrue(result['installed']);self.assertFalse(result['media_changed'])
   self.assertEqual(len(list(Path(result['backup']).iterdir())),2)
   self.assertTrue(v7.deploy(root,HERE,Path(tmp)/"backup",apply=True)['already_installed'])
if __name__=='__main__':unittest.main(verbosity=2)
