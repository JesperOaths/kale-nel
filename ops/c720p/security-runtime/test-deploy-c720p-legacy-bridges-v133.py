#!/usr/bin/env python3
"""No-device transactional legacy player migration regressions."""
from contextlib import ExitStack
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

DIR=Path(__file__).resolve().parent
def load(filename,name):
 spec=importlib.util.spec_from_file_location(name,DIR/filename)
 mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
 return mod
D=load("deploy-c720p-legacy-bridges-v133.py","c720p_deploy")
P=load("patch-c720p-legacy-s9-migrated-player-v1.py","c720p_player")
I=load("patch-c720p-legacy-index-s9-v1.py","c720p_index")
PT=load("test-patch-c720p-legacy-s9-migrated-player-v1.py","player_fixture")
IT=load("test-c720p-legacy-index-s9-v1.py","index_fixture")
JS=(DIR/"c720p-migrated-index-playback-v1.js").read_bytes()
class Tests(unittest.TestCase):
 def make(self,root):
  page=root/"clips.html";page.write_text(PT.fixture())
  index=root/"index.html";index.write_text(IT.page())
  generator=root/"generator.py";generator.write_text(IT.gen())
  bridge=root/"c720p-migrated-index-playback-v1.js"
  return page,index,generator,bridge
 def fixture(self,root):
  page,index,generator,bridge=self.make(root)
  expected={p:D.sha(p.read_bytes()) for p in (page,index,generator)}
  stack=ExitStack()
  for attr,value in (("PAGE",page),("INDEX",index),("GENERATOR",generator),
                     ("JS",bridge),("LOCK",root/"lock"),("BACKUPS",root/"backups"),
                     ("EXPECTED_OLD",expected)):
   stack.enter_context(patch.object(D,attr,value))
  stack.enter_context(patch.object(I,"SOURCE",generator))
  stack.enter_context(patch.object(I,"INDEX",index))
  stack.enter_context(patch.object(I,"LIVE_JS",bridge))
  stack.enter_context(patch.object(D,"check_camera",return_value={
    "temperature_c":35.4}))
  stack.enter_context(patch.object(D,"load",side_effect=lambda name,path:{
    "player":P,"index":I,"js":JS}[name]))
  return stack,(page,index,generator,bridge)
 def test_hashes_pinned_to_repository_blobs(self):
  for name,filename in (
      ("player","patch-c720p-legacy-s9-migrated-player-v1.py"),
      ("index","patch-c720p-legacy-index-s9-v1.py"),
      ("js","c720p-migrated-index-playback-v1.js")):
   self.assertEqual(D.git_blob((DIR/filename).read_bytes()),D.SCRIPT_SHA[name])
 def test_preflight_is_strictly_read_only(self):
  with tempfile.TemporaryDirectory() as folder:
   with self.fixture(Path(folder))[0] as ctx:
    p,idx,gen,js=D.PAGE,D.INDEX,D.GENERATOR,D.JS
    snapshot={f:f.read_bytes() for f in (p,idx,gen)}
    D.main(Path("p"),Path("i"),Path("j"),False)
    self.assertEqual(snapshot,{f:f.read_bytes() for f in snapshot})
    self.assertFalse(js.exists())
 def test_transaction_installs_three_preserved_files_and_new_js(self):
  with tempfile.TemporaryDirectory() as folder:
   with self.fixture(Path(folder))[0]:
    p,idx,gen,js=D.PAGE,D.INDEX,D.GENERATOR,D.JS
    before={f:f.read_bytes() for f in (p,idx,gen)}
    D.main(Path("p"),Path("i"),Path("j"),True)
    self.assertIn(b"C720P_MIGRATED_S9_LEGACY_PLAYER_V1",p.read_bytes())
    self.assertIn(b"saveClip(",idx.read_bytes())
    self.assertIn(b"c720p-migrated-index-playback-v1.js",idx.read_bytes())
    self.assertIn(b"def write_html(events):",gen.read_bytes())
    self.assertIn(b"c720p-migrated-index-playback-v1.js",gen.read_bytes())
    self.assertEqual(js.read_bytes(),JS)
    backups=list((Path(folder)/"backups").rglob("original-*"))
    self.assertEqual(len(backups),3)
    self.assertEqual(set(x.read_bytes() for x in backups),set(before.values()))
 def test_unknown_live_source_blocks_before_writes(self):
  with tempfile.TemporaryDirectory() as folder:
   with self.fixture(Path(folder))[0]:
    D.PAGE.write_text(D.PAGE.read_text()+"DRIFT")
    with self.assertRaisesRegex(RuntimeError,"live_legacy_page_or_generator_changed"):
     D.main(Path("p"),Path("i"),Path("j"),True)
    self.assertFalse(D.JS.exists())
 def test_mid_transaction_failure_restores_known_previous_files(self):
  with tempfile.TemporaryDirectory() as folder:
   with self.fixture(Path(folder))[0]:
    originals={f:f.read_bytes() for f in (D.PAGE,D.INDEX,D.GENERATOR)}
    real_atomic=D.atomic
    def fail_at_generator(p,data,mode=None):
     if p==D.GENERATOR:raise OSError("simulated generator filesystem fault")
     return real_atomic(p,data,mode)
    with patch.object(D,"atomic",side_effect=fail_at_generator):
     with self.assertRaisesRegex(OSError,"simulated generator"):
      D.main(Path("p"),Path("i"),Path("j"),True)
    self.assertEqual(originals,{f:f.read_bytes() for f in originals})
    self.assertFalse(D.JS.exists())
 def test_no_media_operations_or_camera_restart(self):
  source=(DIR/"deploy-c720p-legacy-bridges-v133.py").read_text()
  for forbidden in ("sudo ","pm install","adb install","am force-stop",
       "os.system(","ffmpeg","shutil.rmtree(","/Security4K/motion_",
       "review_decide","subprocess.run("):
   self.assertNotIn(forbidden,source)
  self.assertIn('"safe_to_delete_c720p_mp4s":False',source)
if __name__=="__main__":unittest.main(verbosity=2)
