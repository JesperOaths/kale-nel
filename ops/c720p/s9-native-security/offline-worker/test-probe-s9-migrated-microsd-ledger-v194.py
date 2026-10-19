#!/usr/bin/env python3
"""Synthetic offline guards for non-destructive one-shot microSD ledger test."""
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
SPEC=importlib.util.spec_from_file_location(
    "s9_microsd_ledger_v194",HERE/"probe-s9-migrated-microsd-ledger-v194.py")
m=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(m)

def response(**changes):
 d={"status":"micro_sd_two_decisions_reloaded","metadata_actions":2,
    "nonce_replay_refused":True,"delete_is_only_tombstone":True,
    "journal_readback_verified":True,"only_synthetic_directory_written":True,
    "synthetic_key_persisted":False,"originals_removed":0,
    "real_clips_opened":0,"real_save_delete_enabled":False,
    "actual_person_reviews_modified":False,"camera_apk_modified":False}
 d.update(changes)
 return SimpleNamespace(returncode=0,
   stdout=m.RESULT_MARK+json.dumps(d,separators=(",",":")),stderr="")

class LedgerSmoke(unittest.TestCase):
 def test_launch_touches_no_actual_video_or_review(self):
  with patch.object(m,"CLASS","nl.kalenel.s9offline.S9MigratedLedgerMicroSdSmokeV194"):
   guard=SimpleNamespace(
      adb=lambda *a,**kw:response(),
      Stop=RuntimeError)
   result=m.launch(guard,"/data/local/tmp/s9_worker/checked_hash.jar")
  self.assertEqual(result["metadata_actions"],2)
  self.assertFalse(result["real_save_delete_enabled"])
  self.assertEqual(result["originals_removed"],0)

 def test_launch_is_single_command_with_disposable_class(self):
  observed=[]
  def phone(*args,**kwargs):
   observed.append((args,kwargs));return response()
  guard=SimpleNamespace(adb=phone,Stop=RuntimeError)
  m.launch(guard,"/data/local/tmp/s9_worker/checked_hash.jar")
  self.assertEqual(len(observed),1)
  self.assertEqual(observed[0][0][0],"shell")
  command=observed[0][0][1]
  self.assertIn("--synthetic-microsd-once",command)
  self.assertIn("S9MigratedLedgerMicroSdSmokeV194",command)
  for forbidden in ("--model","--face","/C720PMigrated/","rm -","pm install"):
   self.assertNotIn(forbidden,command)

 def test_fake_or_partial_phone_receipt_refused(self):
  for bad in ({"nonce_replay_refused":False},
              {"only_synthetic_directory_written":False},
              {"synthetic_key_persisted":True},
              {"originals_removed":1},
              {"real_clips_opened":1},
              {"real_save_delete_enabled":True},
              {"actual_person_reviews_modified":True},
              {"camera_apk_modified":True},
              {"metadata_actions":3},
              {"journal_readback_verified":False}):
   with self.subTest(bad=bad):
    guard=SimpleNamespace(adb=lambda *a,**kw:response(**bad),
                          Stop=RuntimeError)
    with self.assertRaisesRegex(RuntimeError,
              "synthetic_phone_result_untrusted"):
     m.launch(guard,"/data/local/tmp/s9_worker/checked_hash.jar")

 def test_busy_backfill_blocks_phone_before_staging(self):
  with tempfile.TemporaryDirectory() as tmp:
   lock=Path(tmp)/"lock";lock.write_text("")
   class Busy(Exception): pass
   guard=SimpleNamespace(LOCK=lock,Stop=Busy,
     require=lambda ok,why:None if ok else (_ for _ in ()).throw(Busy(why)),
     current_camera=lambda:(_ for _ in ()).throw(Busy("native_4k_temperature_guard")))
   with self.assertRaisesRegex(Busy,"native_4k_temperature_guard"):
    m.run(guard)

 def test_source_does_not_expose_model_person_or_unlink(self):
  script=(HERE/"probe-s9-migrated-microsd-ledger-v194.py").read_text()
  java=(HERE/"S9MigratedLedgerMicroSdSmokeV194.java").read_text()
  for forbidden in ("Files.delete(", "Files.move(","MediaCodec",
    "OrtEnvironment","ClipClassifier","MediaRecorder","PersonEvidence",
    "CameraManager","import android.hardware"):
   self.assertNotIn(forbidden,java)
  for forbidden in ("adb shell rm","os.unlink(","os.remove(",
                    "shutil.rmtree(","--real-media"):
   self.assertNotIn(forbidden,script)
  self.assertIn("getFD().sync()", (HERE/"S9MigratedMetadataLedgerV193.java").read_text())
  self.assertIn("fcntl.LOCK_EX|fcntl.LOCK_NB",script)
  self.assertIn("C720PMigratedLedgerSyntheticV194",java)
  self.assertIn("SecureRandom().nextBytes(key)",java)
  self.assertIn("Arrays.fill(key,(byte)0)",java)
  self.assertIn("only_synthetic_directory_written",java)

if __name__=="__main__":unittest.main(verbosity=2)
