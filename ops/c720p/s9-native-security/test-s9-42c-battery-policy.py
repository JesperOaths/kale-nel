#!/usr/bin/env python3
"""Contract: S9 battery 42 C application maximum, guarded warm V5 rollout."""
from pathlib import Path
import importlib.util
import unittest
P=Path(__file__).resolve().parent
SERVICE=(P/"src/nl/kalenel/s9security/CameraService.java").read_text()
WORKER=(P/"s9-v5-cool-window-worker.py").read_text()
INSTALL=(P/"deploy-s9-face-recall-v27.py").read_text()
def module(name,path):
 spec=importlib.util.spec_from_file_location(name,P/path)
 mod=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(mod)
 return mod
w=module("s9_42_worker","s9-v5-cool-window-worker.py")
d=module("s9_42_install","deploy-s9-face-recall-v27.py")

def status(temp=39.5,mode="watching"):
 return dict(ok=True,mode=mode,native_4k_enabled=True,
   garden_person_gate_backend="gpu",
   continuous_4k_ready=False,
   continuous_4k_production_persisted=True,
   continuous_4k_last_result="fallback_thermal_guard",
   preroll_ready=True,preroll_buffered_ms=6800,preroll_last_error="",
   person_last_accepted_motion_age_ms=120000,
   sd_free_bytes=85*1024**3,last_frame_age_ms=38,
   temperature_c=temp)

class S9BatteryPolicy42(unittest.TestCase):
 def test_42c_is_hard_app_max_not_no_limit(self):
  self.assertIn('boolean tooHot=temperature()>=420;',SERVICE)
  self.assertIn('FACE_BACKFILL_MAX_TEMP_TENTHS_C=420',SERVICE)
  self.assertIn('FACE_BACKFILL_WITH_4K_MAX_TENTHS_C=415',SERVICE)
  self.assertIn('temperature()>=420||folder.getUsableSpace()',SERVICE)
  self.assertIn('return battery==null?420:battery.getIntExtra("temperature",420);',SERVICE)
 def test_4k_restart_hysteresis(self):
  self.assertIn('now<continuous4KRetryAfterMs||temperature()>=405',SERVICE)
  self.assertIn('d.put("continuous_4k_rearm_temperature_below_c",40.5);',SERVICE)
  self.assertIn('d.put("application_battery_temperature_max_c",42.0);',SERVICE)
  self.assertIn('d.put("face_review_4k_temperature_below_c",41.5);',SERVICE)
  self.assertLess(w.MAX_RESTART_TEMP_C,42.0)
  self.assertEqual(w.MAX_RESTART_TEMP_C,40.5)
 def test_valid_stable_fallback_can_install_without_weakened_rollback(self):
  s=status()
  self.assertTrue(w.safe_fallback_for_install(s))
  self.assertTrue(d.safe_preflight(s))
  self.assertFalse(d.healthy(s)) # 4K proof still required AFTER upgrade
  self.assertIn('current.get("application_battery_temperature_max_c")!=42.0',INSTALL)
  self.assertIn('installed_s9_42c_battery_policy_not_verified',INSTALL)
  self.assertIn('rollback_microSD_final_checksum_mismatch',INSTALL)
  self.assertIn('if not originals.issubset(nowclips)',INSTALL)
  self.assertIn('wait(VERSION,seconds=170)',INSTALL)
 def test_motion_or_invalid_fallback_does_not_install(self):
  for delta in [
    {"mode":"recording"},
    {"continuous_4k_last_result":"fallback_codec_health_guard"},
    {"preroll_buffered_ms":0},
    {"person_last_accepted_motion_age_ms":100},
    {"temperature_c":41.9},
    {"sd_free_bytes":0},
  ]:
   s=status();s.update(delta)
   self.assertFalse(w.safe_fallback_for_install(s),delta)
   self.assertFalse(d.safe_preflight(s),delta)
 def test_no_bypass_after_success_or_inexact_s9_upgrade(self):
  self.assertIn('if not healthy(current) or current.get("face_deep_rescue_version")!=VERSION:',INSTALL)
  self.assertIn('if not (healthy(latest) or safe_fallback_for_install(latest)) or not idle(latest):',WORKER)
  self.assertIn('if not isinstance(temperature,(float,int)) or temperature>MAX_RESTART_TEMP_C:',WORKER)
  self.assertIn('st.update(status="installing",attempted_at=utc())',WORKER)
  self.assertIn('("complete","needs_manual_recovery","installing")',WORKER)
if __name__=="__main__":unittest.main(verbosity=2)
