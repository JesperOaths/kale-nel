#!/usr/bin/env python3
"""Prevent regression of exact-APK rollback after an S9 4K thermal cooldown."""
from pathlib import Path
import unittest

HERE=Path(__file__).resolve().parent
INSTALL=(HERE/"deploy-s9-face-recall-v27.py").read_text()

class FaceDeployRecoveryV35(unittest.TestCase):
 def test_hot_restart_defers_before_camera_force_stop(self):
  before=INSTALL.split('changed=False',1)[1].split('changed=True',1)[0]
  self.assertIn('float(latest.get("temperature_c",100))>40.5',before)
  self.assertIn('DEFERRED_4K_RESTART_THERMAL_GUARD',before)
  self.assertIn('if not safe_preflight(latest)',before)
  self.assertIn('if not safe_preflight(settle)',INSTALL)
 def test_rollback_uses_actual_onphone_apk_checksum(self):
  rollback=INSTALL.split('except BaseException as err:',1)[1]
  self.assertIn('sha(baseline)!=installed',rollback)
  self.assertIn('adb("shell","sha256sum",old',rollback)
  self.assertIn('adb("shell","sha256sum",restored[0]',rollback)
  self.assertIn('if len(restored)!=1',rollback)
  self.assertIn('"restored_sha256":restored_sha',rollback)
  self.assertNotIn('sha(old)',rollback) # old is a remote Android path
  self.assertIn('rollback_apk_digest_mismatch',rollback)
  self.assertIn('"original_apk_restored":True',rollback)
 def test_no_archive_or_face_identity_modifications(self):
  self.assertNotIn('os.unlink(',INSTALL)
  self.assertNotIn('shutil.rmtree(',INSTALL)
  self.assertIn('originals.issubset(nowclips)',INSTALL)
  self.assertIn('BACK="/storage/9C33-6BBD/',INSTALL)
  self.assertIn('source_sha',INSTALL)

if __name__=="__main__":unittest.main(verbosity=2)
