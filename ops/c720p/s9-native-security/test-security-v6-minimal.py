#!/usr/bin/env python3
"""Offline contract checks for Security V6 UI-only patch."""
import importlib.util, pathlib, re, shutil, subprocess, tempfile, unittest
HERE=pathlib.Path(__file__).resolve().parent
def module(name,filename):
 s=importlib.util.spec_from_file_location(name,HERE/filename)
 m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
v5=module("security_v5","patch-security-command-center-v5.py")
sec=module("security_v5_extras","patch-security-secondary-pages-v5.py")
fixtures=module("security_v5_fixtures","test-security-command-center-v5.py")
v6=module("minimal_v6","deploy-security-v6-minimal.py")
class MinimalTests(unittest.TestCase):
 def prepared(self,root):
  (root/"frontyard-security-new").mkdir(parents=True)
  pages={
   "security":v5.patch_security(fixtures.security()),
   "recordings":v5.patch_clips(fixtures.clips()),
   "faces":sec.face(fixtures.face().replace("</body>","<script>C720PSecureRelay</script></body>")),
   "archive":sec.archive(fixtures.archive()),
  }
  for key,path in v6.TARGETS.items():
   (root/path).write_text(pages[key]+"\n"+("padding "*140))
  return pages
 def test_idempotence_and_required_ui(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp)/"www";self.prepared(root)
   for path,(before,after) in v6.build(root).items():
    key=next(k for k,v in v6.TARGETS.items() if path==root/v)
    self.assertNotEqual(before,after)
    self.assertEqual(v6.upgrade(after,key),after)
    self.assertEqual(after.count('id="s9v6-'+key+'-style"'),1)
    self.assertEqual(after.count('id="s9v6-'+key+'-script"'),1)
    self.assertEqual(before.count("<video"),after.count("<video"))
  self.assertIn('data-view="overview"',v6.SCRIPTS['security'])
  self.assertIn('grid-template-rows:192px',v6.STYLE['recordings'])
  self.assertIn('face_candidates',v6.SCRIPTS['faces'])
  self.assertIn('No face captured',v6.SCRIPTS['faces'])
  self.assertIn("details.open=expanded",v6.SCRIPTS['archive'])
 def test_script_syntax(self):
  if not shutil.which("node"):self.skipTest("Node unavailable")
  for name,body in v6.SCRIPTS.items():
   script=re.search(r'<script[^>]*>([\s\S]*?)</script>',body)
   self.assertIsNotNone(script,name)
   with tempfile.TemporaryDirectory() as tmp:
    p=pathlib.Path(tmp)/"source.js";p.write_text(script.group(1))
    result=subprocess.run(["node","--check",str(p)],capture_output=True,text=True,timeout=15)
    self.assertEqual(result.returncode,0,name+": "+result.stderr)
 def test_atomic_install_and_stable_rerun(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp)/"www";self.prepared(root)
   before={key:(root/file).read_bytes() for key,file in v6.TARGETS.items()}
   status=v6.deploy(root,pathlib.Path(tmp)/"backup",apply=True)
   self.assertTrue(status['deployed'])
   self.assertFalse(status['media_modified'])
   self.assertFalse(status['apk_modified'])
   self.assertEqual(len(list(pathlib.Path(status['backup']).iterdir())),4)
   self.assertTrue(all((root/p).read_bytes()!=before[k] for k,p in v6.TARGETS.items()))
   self.assertTrue(v6.deploy(root,pathlib.Path(tmp)/"backup",apply=True)['already_installed'])
 def test_unknown_target_rejected_before_mutation(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp)/"www";self.prepared(root)
   page=root/v6.TARGETS['faces'];page.write_text("not a known page")
   initial=(root/v6.TARGETS['security']).read_bytes()
   with self.assertRaises(ValueError):v6.deploy(root,pathlib.Path(tmp)/"backup",apply=True)
   self.assertEqual(initial,(root/v6.TARGETS['security']).read_bytes())
if __name__=="__main__":unittest.main(verbosity=2)
