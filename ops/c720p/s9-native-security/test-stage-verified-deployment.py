#!/usr/bin/env python3
"""No-network tests for pinned Camera2 release staging; does not contact phones."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
SCRIPT=HERE/"stage-verified-deployment.py"
spec=importlib.util.spec_from_file_location("s9stageverified",SCRIPT)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
REV="649d7de90d33ac7e2136c76e019cbb40a741dd5e"

class Tests(unittest.TestCase):
 def test_matching_source_and_apk_revision(self):
  with tempfile.TemporaryDirectory() as root:
   build=Path(root)
   for n in [".source-commit",".compiled-commit","s9-native-security.apk.source-commit"]:
    (build/n).write_text(REV+"\n")
   (build/"s9-native-security.apk").write_bytes(b"0"*4_000_001)
   self.assertEqual(module.revision(build)[0],REV)
   (build/".compiled-commit").write_text("0"*40)
   with self.assertRaisesRegex(RuntimeError,"versions_differ"):
    module.revision(build)
   (build/".compiled-commit").write_text(REV)
   (build/"s9-native-security.apk").write_bytes(b"invalid")
   with self.assertRaisesRegex(RuntimeError,"signed_apk_not_present"):
    module.revision(build)

 def test_reject_non_immutable_fetch(self):
  for ref in ["main","HEAD","../branch","0"*7,"https://example.com"]:
   with self.assertRaises(RuntimeError):module.fetch(ref,"s9-native-security/x.java")
  with self.assertRaises(RuntimeError):
   module.fetch(REV,"../../secrets.txt")

 def test_full_bounded_file_manifest_idempotence(self):
  self.assertIn("deploy-drive-person-catalog.py",module.NATIVE)
  self.assertIn("s9_appearance_review.py",module.NATIVE)
  self.assertIn("test-appearance-review.py",module.NATIVE)
  self.assertIn("CameraControls.java",module.ANDROID)
  self.assertIn("OutfitEvidence.java",module.ANDROID)
  self.assertIn("ClipClassifier.java",module.ANDROID)
  self.assertIn("s9_native_camera_controls.py",module.PROXY)
  self.assertIn("s9_drive_visitor_review.py",module.PROXY)
  with tempfile.TemporaryDirectory() as root:
   build=Path(root)/"build"
   cls=build/"src/nl/kalenel/s9security"
   cls.mkdir(parents=True)
   for name in module.ANDROID:
    (cls/name).write_bytes(b"package nl.kalenel.s9security;\n")
   def fake_fetch(sha,name):
    self.assertEqual(sha,REV)
    if name.endswith(".java"):return b"package nl.kalenel.s9security;\n"
    return b"# Test synthetic pinned file not executable.\n"
   with patch.object(module,"fetch",side_effect=fake_fetch):
    path,count=module.commit_to_stage(REV,base=Path(root)/"stage",build=build)
    self.assertEqual(count,len(module.NATIVE)+len(module.PROXY)+len(module.ANDROID))
    self.assertTrue((path/"s9-native-security/deploy-drive-person-catalog.py").exists())
    self.assertEqual(module.commit_to_stage(REV,base=Path(root)/"stage",build=build)[1],count)
    (path/"s9-native-security/deploy-drive-person-catalog.py").write_text("tampered")
    with self.assertRaisesRegex(RuntimeError,"immutable_stage_existing_file_mismatch"):
     module.commit_to_stage(REV,base=Path(root)/"stage",build=build)

 def test_no_device_or_live_service_side_effects(self):
  source=SCRIPT.read_text()
  for forbidden in ('adb install','adb shell','systemctl --user',
                    'force-stop','delete from','rclone delete','killall','sudo '):
   self.assertNotIn(forbidden,source)

if __name__=="__main__":unittest.main(verbosity=2)
