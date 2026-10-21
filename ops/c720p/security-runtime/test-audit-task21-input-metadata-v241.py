import importlib.util
from pathlib import Path
import tempfile, unittest
P=Path(__file__).with_name("audit-task21-input-metadata-v241.py")
spec=importlib.util.spec_from_file_location("metadata_v241",P)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Safety(unittest.TestCase):
 def test_private_0600_and_readonly_catalog_0644(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/"meta"
   p.write_text("synthetic"*30)
   p.chmod(0o600)
   self.assertEqual(m.classify(p,4000,True)["reason"],"eligible_metadata")
   p.chmod(0o644)
   self.assertEqual(m.classify(p,4000,True)["reason"],"mode_not_admitted")
   self.assertEqual(m.classify(p,4000,False)["reason"],"eligible_metadata")
   self.assertTrue(m.classify(p,4000,False)["file_owned_by_current_agent"])
   p.chmod(0o666)
   verdict=m.classify(p,4000,False)
   self.assertEqual(verdict["reason"],"mode_not_admitted")
   self.assertTrue(verdict["group_writable"])
   self.assertTrue(verdict["world_writable"])
   alias=Path(d)/"alias";alias.symlink_to(p)
   self.assertEqual(m.classify(alias,4000,False)["reason"],"symlink")
 def test_no_file_contents_or_mutators(self):
  s=P.read_text()
  for banned in (".read_bytes(",".read_text(",".write_bytes(",".write_text(",
     ".chmod(",".chown(",".unlink(",".replace(","subprocess","os.system",
     "CameraManager","adb "):
   self.assertNotIn(banned,s)
  self.assertIn('"manual_review_state_changed":False',s)
if __name__=="__main__":unittest.main()
