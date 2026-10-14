#!/usr/bin/env python3
"""Release gates: S9+ integrated pedestrian and 5s/10s 4K recording."""
import ast
import pathlib
import unittest
ROOT=pathlib.Path(__file__).resolve().parent
BUILDER=(ROOT/'build-s9-unified-4k-person-v11.py').read_text()
DEPLOY=(ROOT/'deploy-s9-unified-4k-person-v11.py').read_text()
class UnifiedReleaseSafety(unittest.TestCase):
 def test_both_scripts_parse(self):
  ast.parse(BUILDER)
  ast.parse(DEPLOY)
 def test_pinned_model_preservation(self):
  for needle in ('S9_UNIFIED_V11_REF','person_spatiotemporal_transport_v9',
       'transportDominates','garden_person_transport_conflicts_total',
       'QUIET_MS=10000,MAX_MS=120000','TARGET_US=5000000L',
       'MIN_VALID_US=4400000L','changed_model_manifest_or_native_lib',
       'models_native_and_manifest_preserved','APK_SIGNER_CHANGED'):
   self.assertIn(needle,BUILDER,needle)
  self.assertIn('s9-unified-4k-person-v11.apk',BUILDER)
  self.assertIn('mediacodec_presentation_timestamp_v10',BUILDER)
  self.assertIn('lastAcceptedEncodedPtsUs',BUILDER)
  self.assertIn('3L*(1000000L/Encoded4KRing.FPS)',BUILDER)
  self.assertIn('hub_disk_below_280MiB_refuse_build',BUILDER)
 def test_current_apk_backup_and_fail_closed(self):
  for needle in ('9b8ee341ce5db74f8fdffd293ff718068f8433b3423c9778f6886d7891c46b2e',
   'models_native_and_manifest_preserved','person_gate_version',
   'compiled_person_v9_gate_not_running','pedestrian_gate_v9_not_persistent_after_restart',
   'installed_4k_assets_or_libraries_changed','installed_apk_asset_mismatch_',
   'native_4k_production_promotion_failed','SIGNER',
   'S9_UNIFIED_4K_PERSON_V11_DEPLOYMENT_VERIFIED',
   'baseline_backup_hash_mismatch','REAL_4K_PRE5_POST10_MP4_VERIFIED',
   'S9_5S10S_V9_ROLLBACK_CONFIRMED'):
   self.assertIn(needle,DEPLOY,needle)
  self.assertLess(DEPLOY.index('oldpaths=adb('),DEPLOY.index('changed=True'))
  self.assertLess(DEPLOY.index('signer(old)'),DEPLOY.index('changed=True'))
  self.assertNotIn('control("continuous_4k_trial","disable")',DEPLOY)
  self.assertNotIn('adb("uninstall"',DEPLOY)
  self.assertIn('regressed_encoder_pts_stop_clock',DEPLOY)
  self.assertIn('if not 14<=duration<=23:',DEPLOY)
 def test_runner_remote_timer_variable_escaped_once(self):
  workflow=(ROOT.parents[2]/'.github/workflows/deploy-s9-unified-4k-person-v11.yml').read_text()
  line=next(x for x in workflow.splitlines() if 'OBSOLETE_TIMERS_DISARMED' in x)
  self.assertIn(chr(92)+'$u',line)
  self.assertNotIn(chr(92)*2+'$u',line)
  self.assertIn('set -euo pipefail',workflow)
 def test_no_implicit_camera_install_in_builder(self):
  self.assertNotIn('adb("install"',BUILDER)
  self.assertNotIn('am force-stop',BUILDER)
if __name__=='__main__': unittest.main(verbosity=2)
