#!/usr/bin/env python3
"""Static guarantees for the guarded v9 native person-detector rollout."""
from pathlib import Path
import ast
import unittest
P=Path(__file__).with_name("deploy-person-motion-v9.py")
S=P.read_text()
class UpgradeSafety(unittest.TestCase):
 def test_python_is_valid(self):
  ast.parse(S)
 def test_signed_apk_model_and_preroll_parity(self):
  for phrase in ("EXPECTED_CERT","REQUIRED_MODEL",
    'embedded_sha(backup,name)!=embedded_sha(apk,name)',
    'b"Continuous4KEncoder"', 'b"Encoded4KRing"', 'b"GardenPreRoll"',
    '"S9_SECURITY_REF":ref', '".source-commit",".compiled-commit","s9-native-security.apk.source-commit"',
    'new_camera_not_healthy_or_wrong_gate','garden_motion_strong_only_extends_recording',
    'S9_PEDESTRIAN_V9_LIVE_HEALTH_PASS'):
   self.assertIn(phrase,S,phrase)
 def test_device_write_is_guarded_and_rollback_available(self):
  for phrase in ("free_bytes()<320*1024**2","healthy(baseline)",
    'apk_signer_does_not_match_production','def pull_current_apk():',
    'snap.get("recorded")!=previous.get("recorded")',
    'if not healthy(status())','adb("shell","am","force-stop"',
    'adb("install","-r","-g",str(backup)',"S9_PEDESTRIAN_V9_ROLLBACK_START"):
   self.assertIn(phrase,S,phrase)
  self.assertLess(S.index("backup=pull_current_apk()"),S.index("changed=True"))
  self.assertLess(S.index("if not healthy(status())"),S.index("changed=True"))
  for banned in ('adb("uninstall"','shutil.rmtree','rm -rf','--ez","disable_native_camera"',
                'service_role','/api/saved/delete'):
   self.assertNotIn(banned,S,banned)
 def test_pinned_build_pipeline_never_uses_mutable_main(self):
  self.assertIn('raw.githubusercontent.com/JesperOaths/kale-nel/"+ref',S)
  self.assertIn('not re.fullmatch("[0-9a-f]{40}",ref)',S)
  self.assertIn('"fetch-source.sh","compile-only.sh","package-only.sh"',S)
  self.assertNotIn('"repo/ops/',S)
if __name__=="__main__":unittest.main(verbosity=2)
