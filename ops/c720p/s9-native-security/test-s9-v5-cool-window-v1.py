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
   mock.patch.object(m,"poll_idle",side_effect=lambda first:first),
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
 def test_stage_only_prepares_during_busy_archive_review_never_installs(self):
  with tempfile.TemporaryDirectory() as tmp:
   self.setup_mocks(tmp,38.2,stage_ready=False)
   busy=phone(38.2)
   busy["face_backfill_queued"]=True
   busy["historical_import_queued"]=True
   self.assertFalse(m.idle(busy))
   with mock.patch.object(m,"camera_status",return_value=busy),mock.patch.object(
       m,"prepared",side_effect=[False,True]),mock.patch.object(
       m,"run_release_script",return_value="S9_FACE_RECALL_V27_SIGNED_STAGED") as jobs:
    m.tick(stage_only=True)
   self.assertEqual([c.args[1] for c in jobs.call_args_list],["build"])
   self.assertFalse(m.STATE.exists())

 def test_natural_idle_probe_only_reads_status_and_stops_when_clear(self):
  busy=phone(38.0);busy["face_backfill_queued"]=True
  free=phone(38.0)
  with mock.patch.object(m,"camera_status",side_effect=[busy,free]) as readings, \
       mock.patch.object(m.time,"sleep") as sleeper:
   self.assertTrue(m.idle(m.poll_idle(busy)))
  self.assertEqual(readings.call_count,2)
  self.assertEqual(sleeper.call_count,2)
 def test_idle_probe_never_clears_a_busy_archive_flag(self):
  busy=phone(38.0);busy["historical_import_queued"]=True
  with mock.patch.object(m,"camera_status",return_value=busy), \
       mock.patch.object(m.time,"sleep") as sleeper:
   result=m.poll_idle(busy)
  self.assertFalse(m.idle(result))
  self.assertEqual(sleeper.call_count,9)
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
 def test_all_archive_workers_block_an_apk_restart(self):
  # No bypass when face, movement, historical, appearance or triage work owns SD.
  for flag in ("face_backfill_queued","movement_4k_backfill_queued",
               "historical_import_queued","appearance_backfill_queued",
               "garden_archive_triage_queued"):
   with self.subTest(worker=flag), tempfile.TemporaryDirectory() as tmp:
    self.setup_mocks(tmp,34.2)
    busy=phone(34.2);busy[flag]=True
    self.assertFalse(m.idle(busy))
    with mock.patch.object(m,"camera_status",return_value=busy),mock.patch.object(
         m,"run_release_script",side_effect=AssertionError("must_not_install")):
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
 def test_owned_timer_dropin_replaces_legacy_trigger_reset(self):
  source=INSTALLER.read_text()
  tree=ast.parse(source)
  definitions=[n for n in ast.walk(tree) if isinstance(n,ast.Assign) and
               any(isinstance(t,ast.Name) and t.id=="override" for t in n.targets)]
  self.assertEqual(len(definitions),1)
  expression=definitions[0].value
  self.assertIsInstance(expression,ast.Call)
  text=ast.literal_eval(expression.func.value)
  self.assertEqual(text.splitlines(),[
      "[Timer]","OnUnitInactiveSec=","OnActiveSec=2min",
      "OnUnitActiveSec=5min","OnCalendar=*:0/5"])
  self.assertIn('stage_atomic(OVERLAY,override,0o644)',source)
  self.assertIn('for p in (BIN,CONF,SERVICE,TIMER,OVERLAY)',source)
  self.assertIn('OVERLAY.parent.is_symlink()',source)
  self.assertIn('unowned_existing_timer_schedule_override',source)
  self.assertIn('value not in ("infinity","n/a","0","-")',source)
  self.assertIn('loaded_recurrence',source)
 def test_timer_restart_accepts_real_first_worker_but_not_elapsed_timer(self):
  from importlib.util import spec_from_file_location,module_from_spec
  spec=spec_from_file_location("s9_timer_rearm",str(INSTALLER))
  module=module_from_spec(spec);spec.loader.exec_module(module)
  self.assertTrue(module.timer_armed("running",False,True,"activating"))
  self.assertTrue(module.timer_armed("running",False,True,"active"))
  self.assertTrue(module.timer_armed("waiting",True,True,"inactive"))
  for timer_state,deadline,loaded,service in (
     ("elapsed",False,True,"inactive"),
     ("running",False,False,"activating"),
     ("running",False,True,"inactive"),
     ("waiting",False,True,"inactive"),
     ("waiting",True,False,"inactive")):
   with self.subTest(timer_state=timer_state,service=service):
    self.assertFalse(module.timer_armed(timer_state,deadline,loaded,service))
 def test_c720p_timer_is_local_not_chatgpt_task(self):
  src=INSTALLER.read_text()
  for mark in ('systemctl","--user","enable","--now"',
               'OnCalendar=*:0/5','OnActiveSec=2min','OnUnitActiveSec=5min','Persistent=true',
               'NoNewPrivileges=yes','S9_V5_LOCAL_TIMER_VERIFIED',
               'run("systemctl","--user","restart",UNIT+".timer")',
               'timer_rearm_failed_','TimersMonotonic','TimersCalendar','NextElapseUSecMonotonic'):
   self.assertIn(mark,src)
  self.assertNotIn('OnUnitInactiveSec=5min',src)
  self.assertNotIn('run("systemctl","--user","restart",UNIT+".service")',src)
  self.assertNotIn('run("systemctl","--user","start",UNIT+".service")',src)

if __name__=="__main__":
 unittest.main(verbosity=2)
