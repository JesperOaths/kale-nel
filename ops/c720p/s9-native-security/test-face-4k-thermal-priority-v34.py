#!/usr/bin/env python3
"""Face inference must never delay native 4K thermal recovery."""
import pathlib,unittest
ROOT=pathlib.Path(__file__).resolve().parent
SERVICE=(ROOT/"src/nl/kalenel/s9security/CameraService.java").read_text()
class Thermal4KPriority(unittest.TestCase):
 def test_cooldown_pauses_all_background_face_work(self):
  logic=SERVICE.split("private boolean faceBackfillThermallyAllowed(){",1)[1].split("private void maybeFaceBackfill(){",1)[0]
  self.assertIn('getBoolean("continuous_4k_production_enabled",false)',logic)
  self.assertIn('!continuous4KTrial||continuous4K==null||!continuous4K.readyForEvent()',logic)
  self.assertIn('return batteryTenths<FACE_BACKFILL_WITH_4K_MAX_TENTHS_C;',logic)
  self.assertIn('FACE_BACKFILL_WITH_4K_MAX_TENTHS_C=360',SERVICE)
  self.assertIn('FACE_BACKFILL_MAX_TEMP_TENTHS_C=390',SERVICE)
  self.assertLess(360,395)
 def test_every_worker_gate_uses_dynamic_thermal_check(self):
  code=SERVICE.split("private void maybeFaceBackfill(){",1)[1].split("Offloaded archived-video retention review.",1)[0]
  self.assertEqual(code.count('!faceBackfillThermallyAllowed()'),3)
  self.assertIn('gardenPersonGateBusy',code)
  self.assertIn('folder.getUsableSpace()<20L*1024*1024*1024',code)
  self.assertIn('now-lastMovementAt<45000L',code)
  self.assertIn('reviewer.execute(new Runnable()',code)
 def test_camera_recovery_original_guard_preserved(self):
  s=SERVICE.split("private void maybeRestoreCool4K(){",1)[1].split("private void watchdog(){",1)[0]
  self.assertIn('now<continuous4KRetryAfterMs||temperature()>350',s)
  self.assertIn('continuous4KRecoveryAttempts>=3',s)
  self.assertIn('continuous4KLastResult="rearmed_after_thermal_cooldown"',s)
if __name__=="__main__":unittest.main(verbosity=2)
