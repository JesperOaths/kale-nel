#!/usr/bin/env python3
"""No-device tests for the immutable installed S9 APK readback."""
import importlib.util
from pathlib import Path
from unittest import TestCase,main,mock
P=Path(__file__).with_name("report-s9-release-proof.py")
spec=importlib.util.spec_from_file_location("report_s9_release",P)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class ReleaseProofTests(TestCase):
 def test_exact_sha_separates_two_v5_packages(self):
  p={"ok":True,"mode":"watching","continuous_4k_ready":True}
  with mock.patch.object(m,"deployment_state",return_value={
      "timer_enabled":True,"worker_state":"waiting",
      "signed_stage":m.CANDIDATE}):
   new=m.summary(m.CANDIDATE,p)
   old=m.summary(m.PREVIOUS,p)
  self.assertEqual(old["deployment"]["worker_state"],"waiting")
  self.assertTrue(new["matches_current_pinned_signed_release"])
  self.assertFalse(old["matches_current_pinned_signed_release"])
  self.assertTrue(new["current_pinned_signed_release_verified"])
  self.assertTrue(new["matches_full_archive_v5_candidate"])
  self.assertFalse(old["matches_full_archive_v5_candidate"])
  self.assertTrue(old["matches_previous_v2_diagnostic_candidate"])
  self.assertTrue(new["read_only"])
  with mock.patch.object(m,"deployment_state",return_value={"signed_stage":"not_verified"}):
   self.assertFalse(m.summary(m.CANDIDATE,p)["matches_current_pinned_signed_release"])
 def test_readback_uses_package_manager_and_sha_only(self):
  with mock.patch.object(m,"read_command",side_effect=[
   "package:/data/app/one/base.apk\n",
   m.CANDIDATE+"  /data/app/one/base.apk\n"]) as command:
   self.assertEqual(m.apk_sha(),m.CANDIDATE)
  self.assertEqual(command.call_count,2)
  self.assertEqual(command.call_args_list[0].args[:3],("shell","pm","path"))
  self.assertEqual(command.call_args_list[1].args[:2],("shell","sha256sum"))
 def test_reject_ambiguous_package(self):
  with mock.patch.object(m,"read_command",
   return_value="package:/data/app/a/base.apk\npackage:/data/app/b/base.apk\n"):
   with self.assertRaisesRegex(RuntimeError,"unverified"):m.apk_sha()
 def test_stale_completed_release_never_claims_current_install_is_complete(self):
  old="c188e5603ebd"+"0"*28
  current="c4908e4505d3"+"1"*28
  self.assertEqual(len(old),40)
  state={"ref":old,"status":"complete"}
  result=m.state_summary(current,state)
  self.assertEqual(result["worker_state"],"stale_other_revision")
  self.assertEqual(result["previous_worker_state"],"complete")
  self.assertFalse(result["worker_ref_matches_pin"])
  self.assertEqual(result["worker_state_source_ref"],old[:12])
  matching=m.state_summary(current,{"ref":current,"status":"complete"})
  self.assertEqual(matching["worker_state"],"complete")
  self.assertTrue(matching["worker_ref_matches_pin"])
 def test_no_prior_state_or_untrusted_state_does_not_claim_install(self):
  self.assertEqual(m.state_summary("a"*40,{})["worker_state"],"unavailable")
  self.assertEqual(m.state_summary("a"*40,{"ref":"a"*40,
                "status":"hacked"} )["worker_state"],"unavailable")

 def test_timer_readback_reports_scheduled_firing_and_service_failure_without_actions(self):
  timer="ActiveState=active\nSubState=waiting\nLastTriggerUSec=Sun 2026-10-18 02:34:00 CEST\nNextElapseUSecRealtime=Sun 2026-10-18 02:40:00 CEST\n"
  service="ActiveState=failed\nSubState=failed\nResult=exit-code\nExecMainStatus=1\nExecMainStartTimestamp=Sun 2026-10-18 02:34:00 CEST\nExecMainExitTimestamp=Sun 2026-10-18 02:34:01 CEST\n"
  with mock.patch.object(m.subprocess,"run",side_effect=[
    mock.Mock(returncode=0,stdout=timer),
    mock.Mock(returncode=0,stdout=service)]) as proc:
   data=m.timer_service_readback()
  self.assertEqual(data["timer_SubState"],"waiting")
  self.assertEqual(data["service_Result"],"exit-code")
  self.assertEqual(data["service_ExecMainStatus"],"1")
  self.assertTrue(data["timer_LastTriggerUSec"].startswith("Sun"))
  self.assertEqual(proc.call_count,2)
  for call in proc.call_args_list:
   self.assertEqual(call.args[0][:3],["systemctl","--user","show"])
   self.assertNotIn("start",call.args[0])
 def test_failed_or_unavailable_systemd_metadata_is_not_claimed_as_success(self):
  with mock.patch.object(m.subprocess,"run",side_effect=[
    mock.Mock(returncode=1,stdout=""),
    mock.Mock(returncode=0,stdout="Result=success\nExecMainStatus=0\nUnknown=unsafe\n")]):
   data=m.timer_service_readback()
  self.assertNotIn("timer_ActiveState",data)
  self.assertEqual(data["service_Result"],"success")
  self.assertNotIn("service_Unknown",data)
 def test_worker_state_distinguishes_old_revision_from_pinned_release(self):
  source=P.read_text()
  for name in ("worker_ref_matches_pin","worker_state_source_ref",
               "pinned_stage_manifest_present","last_event_source_ref"):
   self.assertIn(name,source)

 def test_installer_blockers_do_not_change_camera(self):
  phone={"ok":True,"mode":"watching","native_4k_enabled":True,
   "continuous_4k_ready":True,"continuous_4k_error":"",
   "continuous_4k_dropped_output_frames":0,"garden_person_gate_backend":"gpu",
   "temperature_c":38.5,"sd_free_bytes":50*1024**3,
   "last_frame_age_ms":50,"person_last_accepted_motion_age_ms":90000,
   "face_backfill_queued":False,"historical_import_queued":False}
  clean=m.restart_guard_observations(phone)
  self.assertTrue(clean["observed_restart_idle"])
  self.assertTrue(clean["diagnostic_only"])
  hot=dict(phone,temperature_c=41.2)
  busy=dict(phone,historical_import_queued=True,face_backfill_queued=True)
  moving=dict(phone,person_last_accepted_motion_age_ms=34000)
  self.assertIn("battery_above_restart_guard_or_unavailable",
                m.restart_guard_observations(hot)["observed_blockers"])
  self.assertEqual(m.restart_guard_observations(busy)["observed_blockers"],
      ["face_review_active","historical_import_active"])
  self.assertIn("person_motion_recent",
                m.restart_guard_observations(moving)["observed_blockers"])
  self.assertFalse(m.restart_guard_observations({})["observed_restart_idle"])
 def test_no_camera_restarts_or_media_access(self):
  src=P.read_text()
  for banned in ("force-stop","install -r","rm -rf","/new/api/saved",
                 "FaceSnapshots","CameraActivity","write_bytes(","unlink("):
   self.assertNotIn(banned,src)

if __name__=="__main__":main(verbosity=2)
