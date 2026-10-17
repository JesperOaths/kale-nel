#!/usr/bin/env python3
"""Offline behavioral contracts for the C720P-local S9 V5 cool-window worker."""
from pathlib import Path
import ast
import importlib.util
import json
import tempfile
import unittest
from unittest import mock

HERE=Path(__file__).resolve().parent
WORKER=HERE/"s9-v5-cool-window-worker.py"
INSTALLER=HERE/"install-s9-v5-cool-window-v1.py"
MODULE=importlib.util.spec_from_file_location("s9_v5_local_cool",WORKER)
m=importlib.util.module_from_spec(MODULE)
MODULE.loader.exec_module(m)

def phone(temp,version="s9_onphone_36_samples_person_or_tile_v4"):
 return dict(ok=True,mode="watching",native_4k_enabled=True,
    continuous_4k_ready=True,continuous_4k_buffered_ms=6996,
    continuous_4k_dropped_output_frames=0,continuous_4k_error="",
    garden_person_gate_backend="gpu",sd_free_bytes=80*1024**3,
    last_frame_age_ms=30,person_last_accepted_motion_age_ms=120000,
    face_deep_rescue_version=version,temperature_c=temp,
    face_backfill_queued=False,
    continuous_4k_production_persisted=True,
    preroll_ready=True,preroll_buffered_ms=6900,preroll_last_error="")

class LocalCoolWindow(unittest.TestCase):
 def test_scripts_are_valid_and_do_not_send_images(self):
  for p in (WORKER,INSTALLER):
   ast.parse(p.read_text(),filename=str(p))
  script=WORKER.read_text()
  for unsafe in ('"/new/api/saved"','/shot.jpg','/new/saved/face/','upload_face',
                 "face_embedding_vector","delete_original_video"):
   self.assertNotIn(unsafe,script)
  self.assertIn("MAX_RESTART_TEMP_C=40.5",script)
  self.assertIn("if not (healthy(latest) or safe_fallback_for_install(latest)) or not idle(latest):",script)
  self.assertIn("fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)",script)
  self.assertIn('("complete","needs_manual_recovery","installing")',script)
 def setup_mocks(self,tempdir,temp,stage_ready=True,version=None):
  d=dict(ref="a"*40,build_sha256="b"*64,install_sha256="c"*64)
  patches=[
   mock.patch.object(m,"ROOT",Path(tempdir)),
   mock.patch.object(m,"STATE",Path(tempdir)/"state.json"),
   mock.patch.object(m,"LOCK",Path(tempdir)/"state.lock"),
   mock.patch.object(m,"config",return_value=d),
   mock.patch.object(m,"camera_status",return_value=phone(temp,version or "s9_onphone_36_samples_person_or_tile_v4")),
   mock.patch.object(m,"prepared",return_value=stage_ready),
   mock.patch.object(m,"report"),
  ]
  mocks=[p.start() for p in patches]
  self.addCleanup(lambda: [p.stop() for p in reversed(patches)])
  return d,mocks
 def test_hot_camera_must_not_install_or_restart(self):
  with tempfile.TemporaryDirectory() as tmp:
   _,_mocks=self.setup_mocks(tmp,42.0)
   with mock.patch.object(m,"run_release_script",side_effect=AssertionError("installer_called")):
    m.tick()
   self.assertFalse(m.STATE.exists())
 def test_stage_only_allowed_during_4k_thermal_fallback_never_installs(self):
  with tempfile.TemporaryDirectory() as tmp:
   _,mocks=self.setup_mocks(tmp,39.0,stage_ready=False)
   fallback=phone(39.0)
   fallback["continuous_4k_ready"]=False
   fallback["continuous_4k_last_result"]="fallback_thermal_guard"
   with mock.patch.object(m,"camera_status",return_value=fallback),mock.patch.object(
       m,"prepared",side_effect=[False,True]),mock.patch.object(
       m,"run_release_script",return_value="S9_FACE_RECALL_V27_SIGNED_STAGED") as scripts:
    m.tick(stage_only=True)
   self.assertEqual([c.args[1] for c in scripts.call_args_list],["build"])
   self.assertFalse(m.STATE.exists())
 def test_local_timer_stages_during_fallback_but_never_installs(self):
  with tempfile.TemporaryDirectory() as tmp:
   self.setup_mocks(tmp,35.4,stage_ready=False)
   fallback=phone(35.4)
   fallback["continuous_4k_ready"]=False
   fallback["preroll_ready"]=False  # incomplete fallback must never install
   with mock.patch.object(m,"camera_status",return_value=fallback), mock.patch.object(
       m,"prepared",side_effect=[False,True]), mock.patch.object(
       m,"run_release_script",return_value="S9_FACE_RECALL_V27_SIGNED_STAGED") as runner:
    m.tick(stage_only=False)
   self.assertEqual([c.args[1] for c in runner.call_args_list],["build"])
   self.assertFalse(m.STATE.exists())
 def test_verified_idle_thermal_fallback_under_40_5_can_install(self):
  with tempfile.TemporaryDirectory() as tmp:
   self.setup_mocks(tmp,39.5)
   before=phone(39.5);before["continuous_4k_ready"]=False
   before["continuous_4k_last_result"]="fallback_thermal_guard"
   after=phone(40.8,version=m.VERSION)
   with mock.patch.object(m,"camera_status",side_effect=[before,before,after]), mock.patch.object(
       m,"run_release_script",return_value="S9_FACE_RECALL_V27_DEVICE_VERIFIED") as run:
    m.tick()
   self.assertEqual([c.args[1] for c in run.call_args_list],["install"])
   self.assertEqual(json.loads(m.STATE.read_text())["status"],"complete")
 def test_person_motion_refuses_fallback_install(self):
  with tempfile.TemporaryDirectory() as tmp:
   self.setup_mocks(tmp,39.0)
   fallback=phone(39.0)
   fallback["continuous_4k_ready"]=False
   fallback["continuous_4k_last_result"]="fallback_thermal_guard"
   fallback["person_last_accepted_motion_age_ms"]=32000
   with mock.patch.object(m,"camera_status",return_value=fallback),mock.patch.object(
       m,"run_release_script",side_effect=AssertionError("must_not_install")):
    m.tick()
   self.assertFalse(m.STATE.exists())
 def test_real_motion_defers_even_when_cool(self):
  with tempfile.TemporaryDirectory() as tmp:
   self.setup_mocks(tmp,34.1)
   with mock.patch.object(m,"idle",return_value=False), mock.patch.object(
       m,"run_release_script",side_effect=AssertionError("installer_called")):
    m.tick()
   self.assertFalse(m.STATE.exists())
 def test_pending_install_state_never_retries_after_crash(self):
  with tempfile.TemporaryDirectory() as tmp:
   self.setup_mocks(tmp,33.9)
   m.STATE.write_text(json.dumps(dict(ref="a"*40,status="installing")))
   with mock.patch.object(m,"run_release_script",side_effect=AssertionError("retry_attempted")):
    m.tick()
   self.assertEqual(json.loads(m.STATE.read_text())["status"],"installing")
 def test_signed_install_receipt_still_requires_live_v5(self):
  with tempfile.TemporaryDirectory() as tmp:
   self.setup_mocks(tmp,34.0)
   with mock.patch.object(m,"run_release_script",return_value="S9_FACE_RECALL_V27_DEVICE_VERIFIED"):
    m.tick()
   self.assertEqual(json.loads(m.STATE.read_text())["status"],"needs_manual_recovery")
 def test_true_live_v5_short_circuits_install(self):
  with tempfile.TemporaryDirectory() as tmp:
   self.setup_mocks(tmp,33.8,version=m.VERSION)
   with mock.patch.object(m,"installed_release_matches",return_value=True),mock.patch.object(
       m,"run_release_script",side_effect=AssertionError("already_v5")):
    m.tick()
   self.assertEqual(json.loads(m.STATE.read_text())["status"],"complete")
 def test_old_v5_version_alone_does_not_prove_new_signed_apk(self):
  with tempfile.TemporaryDirectory() as tmp:
   self.setup_mocks(tmp,34.0,version=m.VERSION)
   with mock.patch.object(m,"installed_release_matches",return_value=False),mock.patch.object(
       m,"run_release_script",return_value="S9_V27_FACE_RESCUE_DEFERRED_IDLE") as runner:
    m.tick()
   self.assertEqual([x.args[1] for x in runner.call_args_list],["install"])
   self.assertEqual(json.loads(m.STATE.read_text())["status"],"waiting")
 def test_guarded_original_installer_hard_limits(self):
  s=(HERE/"deploy-s9-face-recall-v27.py").read_text()
  self.assertIn('DEFERRED_4K_RESTART_THERMAL_GUARD',s)
  self.assertIn('float(latest.get("temperature_c",100))>40.5',s)
  self.assertIn('S9_FACE_RECALL_V27_DEVICE_VERIFIED',s)
  self.assertIn('"original_apk_restored":True',s)
  self.assertIn('rollback_microSD_final_checksum_mismatch',s)
 def test_c720p_timer_is_local_not_chatgpt_task(self):
  src=INSTALLER.read_text()
  for mark in ('systemctl","--user","enable","--now"',
               'OnUnitInactiveSec=20min','Persistent=true',
               'NoNewPrivileges=yes','S9_V5_LOCAL_TIMER_VERIFIED'):
   self.assertIn(mark,src)

if __name__=="__main__":
 unittest.main(verbosity=2)
