#!/usr/bin/env python3
"""Fail-closed and no-regression tests for native 7s unattended cool rollout."""
from pathlib import Path
import importlib.util
import json
import importlib.util
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
 def test_success_schema_and_original_timing_proof_consumer(self):
  # Both branches must hand downstream timing proof the same validated
  # installed=True candidate provenance, never implying a second install.
  for already in (True,False):
   with self.subTest(already_installed=already):
    fields=m.verified_success_fields(safe(),already_installed=already)
    self.assertIs(fields["installed"],True)
    self.assertIs(fields["already_installed"],already)
    self.assertFalse(fields["original_videos_intentionally_modified"])
    self.assertFalse(fields["manual_person_reviews_intentionally_modified"])
    with tempfile.TemporaryDirectory() as root:
     state=Path(root)
     result=state/"rollout.json"
     with patch.object(m,"STATE",state),patch.object(m,"RESULT",result):
      m.write_result("done",fields)
     consumer_path=ROOT.parent/"security-runtime"/"s9_7s_saved_timing_proof_v1.py"
     spec=importlib.util.spec_from_file_location("real_saved_timing_consumer",consumer_path)
     reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
     self.assertTrue(reader.verified_new_rollout(result))
     self.assertIsInstance(reader.verified_rollout_epoch_ms(result),int)
     doc=json.loads(result.read_text())
     self.assertEqual(doc["candidate_sha256"],m.NEW_SHA)
     self.assertEqual(doc["schema_version"],m.SCHEMA)

 def test_already_installed_branch_never_force_stops_or_installs(self):
  with tempfile.TemporaryDirectory() as root:
   state=Path(root)
   result=state/"rollout.json"
   with patch.object(m,"STATE",state),patch.object(m,"RESULT",result),\
        patch.object(m,"result_state",return_value=None),\
        patch.object(m,"camera",return_value=safe()),\
        patch.object(m,"competing",return_value=None),\
        patch.object(m,"check_approval"),\
        patch.object(m,"current_apk_sha",return_value=m.NEW_SHA) as sha,\\
        patch.object(m,"adb") as adb,\\
        patch.object(m,"launch_camera") as launch,\\
        patch.object(m,"check_health_after_upgrade") as upgrade:
    self.assertEqual(m.one_attempt(),"done")
    sha.assert_called_once()
    adb.assert_not_called();launch.assert_not_called()
    upgrade.assert_not_called()
    doc=json.loads(result.read_text())
    self.assertEqual(doc["state"],"done")
    self.assertIs(doc["installed"],True)
    self.assertIs(doc["already_installed"],True)
    self.assertTrue(doc["continuous_4k_buffered_ms"]>=6500)

 def test_both_successes_refuse_unhealthy_camera(self):
  cold=safe();cold["continuous_4k_dropped_output_frames"]=3
  with self.assertRaisesRegex(RuntimeError,"verified_success_requires_healthy_candidate"):
   m.verified_success_fields(cold,already_installed=True)
  with self.assertRaisesRegex(RuntimeError,"verified_success_requires_healthy_candidate"):
   m.verified_success_fields(cold,already_installed=False)

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
