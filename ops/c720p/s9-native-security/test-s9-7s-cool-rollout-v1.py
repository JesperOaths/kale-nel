#!/usr/bin/env python3
"""Fail-closed and no-regression tests for native 7s unattended cool rollout."""
from pathlib import Path
import importlib.util
import json
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent
PATH=ROOT/"s9_7s_cool_rollout_v1.py"
spec=importlib.util.spec_from_file_location("s9_7s_cool",PATH)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def safe():
 return {"ok":True,"mode":"watching","native_4k_enabled":True,
   "continuous_4k_ready":True,"continuous_4k_trial_active":True,
   "continuous_4k_production_persisted":True,"temperature_c":35.9,
   "continuous_4k_buffered_ms":6996,"continuous_4k_dropped_output_frames":0,
   "garden_person_gate_backend":"gpu","garden_person_gate_ready":True,
   "last_frame_age_ms":200,"sd_free_bytes":56*1024**3,"recorded":100}
class Tests(unittest.TestCase):
 def test_cool_four_k_and_person_gate(self):
  self.assertTrue(m.healthy(safe(),pre=True))
  self.assertEqual(m.TEMP_START_MAX,36.7)
  self.assertEqual(m.TEMP_POST_MAX,39.0)
  for k,v in (("mode","recording"),("temperature_c",37.0),
       ("continuous_4k_ready",False),("continuous_4k_buffered_ms",5100),
       ("continuous_4k_dropped_output_frames",1),
       ("garden_person_gate_backend","cpu"),("last_frame_age_ms",4000),
       ("sd_free_bytes",3*1024**3)):
   d=safe();d[k]=v
   self.assertFalse(m.healthy(d,pre=True),k)
 def test_thermal_deferral_never_calls_adb_or_signing(self):
  warm=safe();warm["temperature_c"]=40.0
  with patch.object(m,"result_state",return_value=None),\
       patch.object(m,"camera",return_value=warm),\
       patch.object(m,"check_approval") as approval,\
       patch.object(m,"adb") as adb:
   self.assertEqual(m.one_attempt(),"deferred")
   approval.assert_not_called();adb.assert_not_called()
 def test_never_retries_after_ambiguous_attempt_or_failed(self):
  for state in ("done","attempting","failed"):
   with patch.object(m,"result_state",return_value=state),\
        patch.object(m,"adb") as adb:
    self.assertEqual(m.one_attempt(),state);adb.assert_not_called()
 def test_attestation_pins_source_and_true_7s_apk(self):
  self.assertEqual(len(m.SOURCE_SHA),40)
  self.assertEqual(len(m.NEW_SHA),64)
  self.assertNotEqual(m.NEW_SHA,m.OLD_SHA)
  self.assertIn("3adf1c7c",m.SOURCE_SHA)
  txt=PATH.read_text()
  for x in ("main_java_source_has_not_changed()","current_apk_sha()!=OLD_SHA",
    "installed_apk_raced","check_health_after_upgrade()",
    "write_result(\"attempting\"","write_result(\"failed\"",
    "ROLLBACK","manual_person_reviews_intentionally_modified",
    "os.fchmod(f.fileno(),0o600)"):
   self.assertIn(x,txt)
 def test_no_evidence_deletion_or_auth_bypass(self):
  txt=PATH.read_text()
  for unsafe in ("--apply","deleteVideo","rm -rf","sudo ",
    "su -c","shutil.rmtree","CameraManager","review_decision_update"):
   self.assertNotIn(unsafe,txt)
  self.assertEqual(txt.count('adb("shell","am","force-stop"'),2)
 def test_unit_is_sparse_nonpersistent_and_user_scoped(self):
  timer=(ROOT/"c720p-s9-native-seven-second-rollout-v1.timer").read_text()
  service=(ROOT/"c720p-s9-native-seven-second-rollout-v1.service").read_text()
  for x in ("OnUnitInactiveSec=25min","RandomizedDelaySec=5min",
    "Persistent=false","OnBootSec=3h"):
   self.assertIn(x,timer)
  for x in ("NoNewPrivileges=yes","TimeoutStartSec=360","IOSchedulingClass=idle"):
   self.assertIn(x,service)
  self.assertNotIn("sudo",service)
if __name__=="__main__":unittest.main(verbosity=2)
