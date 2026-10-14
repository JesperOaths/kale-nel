#!/usr/bin/env python3
"""Static guarantees for the guarded v9 native person-detector rollout."""
from pathlib import Path
import ast
import importlib.util
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
  for phrase in ("free_bytes()<320*1024**2","healthy(baseline,require_continuous=continuous_before,preflight=True)",
    'apk_signer_does_not_match_production','def pull_current_apk():',
    'snap.get("recorded")!=previous.get("recorded")',
    'if not healthy(status(),require_continuous=continuous_before,preflight=True)','adb("shell","am","force-stop"',
    'adb("install","-r","-g",str(backup)',"S9_PEDESTRIAN_V9_ROLLBACK_START"):
   self.assertIn(phrase,S,phrase)
  self.assertLess(S.index("backup=pull_current_apk()"),S.index("changed=True"))
  self.assertLess(S.index("if not healthy(status(),require_continuous=continuous_before,preflight=True)"),S.index("changed=True"))
  for banned in ('adb("uninstall"','shutil.rmtree','rm -rf','--ez","disable_native_camera"',
                'service_role','/api/saved/delete'):
   self.assertNotIn(banned,S,banned)
 def test_production_4k_buffer_is_not_mistaken_for_missing_preroll(self):
  spec=importlib.util.spec_from_file_location("s9_v9_upgrade_fixture",P)
  m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
  common={"ok":True,"mode":"watching","native_4k_enabled":True,
    "garden_zone":"near","garden_roi_mask_version":"owner_drawn_sloped_garden_v6",
    "garden_person_gate_backend":"gpu","garden_person_gate_ready":True,
    "temperature_c":35.0,"sd_free_bytes":75*1024**3,"last_frame_age_ms":50}
  legacy={**common,"preroll_ready":True}
  self.assertTrue(m.healthy(legacy,preflight=True))
  self.assertFalse(m.healthy(legacy,require_continuous=True,preflight=True))
  continuous={**common,"preroll_ready":False,"continuous_4k_trial_active":True,
    "continuous_4k_production_persisted":True,"continuous_4k_ready":True,
    "continuous_4k_buffered_ms":8995,"continuous_4k_dropped_output_frames":0,
    "continuous_4k_error":""}
  self.assertTrue(m.using_continuous_4k(continuous))
  self.assertTrue(m.healthy(continuous,require_continuous=True,preflight=True))
  self.assertFalse(m.healthy({**continuous,"temperature_c":38.7},
    require_continuous=True,preflight=True))
  self.assertFalse(m.healthy({**continuous,"continuous_4k_buffered_ms":1000},
    require_continuous=True,preflight=True))
  self.assertFalse(m.healthy({**continuous,"continuous_4k_production_persisted":False},
    require_continuous=True,preflight=True))
  self.assertFalse(m.healthy({**continuous,"continuous_4k_dropped_output_frames":2},
    require_continuous=True,preflight=True))
  self.assertTrue(m.healthy({**continuous,"motion_detector":"person_spatiotemporal_transport_v9"},
    "person_spatiotemporal_transport_v9",require_continuous=True))
  self.assertFalse(m.healthy({**continuous,"motion_detector":"person_multiscale_threeframe_static_v8"},
    "person_spatiotemporal_transport_v9",require_continuous=True))
 def test_pinned_build_pipeline_never_uses_mutable_main(self):
  self.assertIn('raw.githubusercontent.com/JesperOaths/kale-nel/"+ref',S)
  self.assertIn('not re.fullmatch("[0-9a-f]{40}",ref)',S)
  self.assertIn('"fetch-source.sh","compile-only.sh","package-only.sh"',S)
  self.assertNotIn('"repo/ops/',S)
if __name__=="__main__":unittest.main(verbosity=2)
