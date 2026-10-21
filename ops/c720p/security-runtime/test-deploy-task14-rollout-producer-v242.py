#!/usr/bin/env python3
"""Offline synthetic deployment/rollback/regression; never reaches S9+ or HA."""
import hashlib,importlib.util,json,stat
from pathlib import Path
import tempfile,unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parent
SCRIPT=ROOT/"deploy-task14-rollout-producer-v242.py"
PRODUCER=ROOT.parent/"s9-native-security"/"s9_7s_cool_rollout_v1.py"
spec=importlib.util.spec_from_file_location("task14_producer_installer_v242",SCRIPT)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Cases(unittest.TestCase):
 def fixture(self,folder):
  dir=Path(folder);(dir/"bin").mkdir();(dir/"state").mkdir()
  target=dir/"bin/s9_7s_cool_rollout_v1.py"
  old=b"# valid synthetic old production producer\\nprint('not executed')\\n"
  target.write_bytes(old);target.chmod(0o600)
  terminal=dir/"state/rollout.json"
  state={"state":"done","installed":True,
   "schema_version":"s9_native_7s_cool_rollout_v1",
   "candidate_sha256":m.CANDIDATE,"updated_utc":"2026-10-20T00:00:00Z"}
  terminal.write_text(json.dumps(state));terminal.chmod(0o600)
  return target,terminal,old,state
 def test_success_source_only_updates_and_preserves_terminal(self):
  blob=PRODUCER.read_bytes()
  with tempfile.TemporaryDirectory() as tmp:
   target,terminal,old,state=self.fixture(tmp)
   with patch.object(m,"HOME",Path(tmp)),\
        patch.object(m,"TARGET",target),\
        patch.object(m,"LOCK",Path(tmp)/"state/lock"),\
        patch.object(m,"TERMINAL",terminal),\
        patch.object(m,"BACKUP",Path(tmp)/"backups"),\
        patch.object(m,"ORIGINAL_SHA",hashlib.sha256(old).hexdigest()),\
        patch.object(m,"APPROVED_SHA",hashlib.sha256(blob).hexdigest()),\
        patch.object(m,"healthy",return_value={"temperature_c":30.0}):
    m.install(blob)
    self.assertEqual(target.read_bytes(),blob)
    self.assertEqual(json.loads(terminal.read_text()),state)
    backups=list((Path(tmp)/"backups").glob("before-*.py"))
    self.assertEqual(len(backups),1)
    self.assertEqual(backups[0].read_bytes(),old)
    m.install(blob)
    self.assertEqual(len(list((Path(tmp)/"backups").glob("before-*.py"))),1)
 def test_unknown_concurrent_source_not_replaced(self):
  blob=PRODUCER.read_bytes()
  with tempfile.TemporaryDirectory() as tmp:
   target,terminal,old,state=self.fixture(tmp)
   target.write_text("malicious unexpected source"*4)
   original=target.read_bytes()
   with patch.object(m,"TARGET",target),\
        patch.object(m,"LOCK",Path(tmp)/"state/lock"),\
        patch.object(m,"TERMINAL",terminal),\
        patch.object(m,"BACKUP",Path(tmp)/"backups"),\
        patch.object(m,"healthy",return_value={"temperature_c":30.0}),\
        patch.object(m,"APPROVED_SHA",hashlib.sha256(blob).hexdigest()):
    with self.assertRaisesRegex(RuntimeError,"unknown_concurrent_rollout_source"):
     m.install(blob)
    self.assertEqual(target.read_bytes(),original)
    self.assertEqual(json.loads(terminal.read_text()),state)
 def test_source_only_has_no_phone_mutator(self):
  source=SCRIPT.read_text()
  for bad in ('adb("install"','am force-stop','launch_camera()',
     'subprocess.run(', 'KeyStore', 'review_decision_update',
     'http://localhost:8123/api/'):
   self.assertNotIn(bad,source)
  self.assertIn('"no_camera_reinstall_or_restart":True',source)
if __name__=="__main__":unittest.main(verbosity=2)
