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
  self.assertTrue(new["matches_full_archive_v5_candidate"])
  self.assertFalse(old["matches_full_archive_v5_candidate"])
  self.assertTrue(old["matches_previous_v2_diagnostic_candidate"])
  self.assertTrue(new["read_only"])
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
 def test_worker_state_distinguishes_old_revision_from_pinned_release(self):
  source=P.read_text()
  for name in ("worker_ref_matches_pin","worker_state_source_ref",
               "pinned_stage_manifest_present","last_event_source_ref"):
   self.assertIn(name,source)

 def test_no_camera_restarts_or_media_access(self):
  src=P.read_text()
  for banned in ("force-stop","install -r","rm -rf","/new/api/saved",
                 "FaceSnapshots","CameraActivity","write_bytes(","unlink("):
   self.assertNotIn(banned,src)

if __name__=="__main__":main(verbosity=2)
