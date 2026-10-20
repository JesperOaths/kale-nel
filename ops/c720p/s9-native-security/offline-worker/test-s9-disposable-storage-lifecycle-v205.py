#!/usr/bin/env python3
"""Synthetic one-shot cross-app probe lifecycle tests; no phone or live APK."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
FILE=HERE/"probe-s9-disposable-storage-access-v204.py"
spec=importlib.util.spec_from_file_location("s9_disposable_v205",FILE)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class FakePhone:
 def __init__(self,preexisting=False,broadcast_fails=False,install_partial=False):
  self.installed=preexisting
  self.initially=preexisting
  self.broadcast_fails=broadcast_fails
  self.install_partial=install_partial
  self.uninstalls=0
  self.installs=0
  self.camera_checks=0
  self.logreads=0
 def current_camera(self):
  self.camera_checks+=1
  return {"mode":"watching","continuous_4k_dropped_output_frames":0}
 def adb(self,*args,seconds=0):
  if args[0]=="shell" and args[1].startswith("pm list packages "):
   return SimpleNamespace(returncode=0,stdout=
       "package:"+mod.PACKAGE+"\n" if self.installed else "",stderr="")
  if args[0]=="install":
   self.installs+=1
   self.installed=True
   return SimpleNamespace(returncode=1 if self.install_partial else 0,
       stdout="Failed" if self.install_partial else "Success",stderr="")
  if args[0]=="uninstall":
   self.uninstalls+=1
   self.installed=False
   return SimpleNamespace(returncode=0,stdout="Success",stderr="")
  if args[0]=="shell" and args[1].startswith("am broadcast"):
   return SimpleNamespace(returncode=1 if self.broadcast_fails else 0,
       stdout="" if self.broadcast_fails else "Broadcast completed",stderr="")
  if args[0]=="shell" and args[1].startswith("logcat "):
   self.logreads+=1
   return SimpleNamespace(returncode=0,stdout=(
    "I/"+mod.TAG+": RESULT directory_exists=true enumeration_allowed=false "
    "found_mp4=false opened_readonly=false bytes_read=0 media_modified=false\n"),
    stderr="")
  raise AssertionError("unexpected simulated adb action: "+repr(args))

class Tests(unittest.TestCase):
 def test_success_reports_permission_denial_without_misclaiming_access(self):
  phone=FakePhone()
  output=mod.invoke(phone,Path("/nonexistent/synthetic-test-only.apk"))
  self.assertEqual(output,{"directory_exists":True,"enumeration_allowed":False,
    "found_mp4":False,"opened_readonly":False})
  self.assertFalse(phone.installed)
  self.assertEqual(phone.installs,1)
  self.assertEqual(phone.uninstalls,1)
  self.assertEqual(phone.camera_checks,2)
  self.assertEqual(phone.logreads,1)
 def test_refuse_preexisting_app_and_do_not_uninstall_it(self):
  phone=FakePhone(preexisting=True)
  with self.assertRaisesRegex(mod.Halt,"probe_package_preexisting_not_touched"):
   mod.invoke(phone,Path("/nonexistent/synthetic-test-only.apk"))
  self.assertTrue(phone.installed)
  self.assertEqual(phone.installs,0)
  self.assertEqual(phone.uninstalls,0)
 def test_broadcast_failure_still_uninstalls(self):
  phone=FakePhone(broadcast_fails=True)
  with self.assertRaisesRegex(mod.Halt,"disposable_broadcast_failed"):
   mod.invoke(phone,Path("/nonexistent/synthetic-test-only.apk"))
  self.assertFalse(phone.installed)
  self.assertEqual(phone.uninstalls,1)
 def test_partial_install_failure_still_uninstalls(self):
  phone=FakePhone(install_partial=True)
  with self.assertRaisesRegex(mod.Halt,"disposable_install_failed"):
   mod.invoke(phone,Path("/nonexistent/synthetic-test-only.apk"))
  self.assertFalse(phone.installed)
  self.assertEqual(phone.uninstalls,1)
 def test_no_cross_app_permission_escalation_or_camera_restart(self):
  src=FILE.read_text()
  manifest=(HERE/"s9-storage-probe-v204/AndroidManifest.xml").read_text()
  java=(HERE/"s9-storage-probe-v204/StorageProbe.java").read_text()
  for forbidden in ("pm grant nl.kalenel.s9security",
     "pm grant nl.kalenel.s9edge","adb root","pm clear",
     "am force-stop","stop-camera"):
   self.assertNotIn(forbidden,src+manifest+java)
  self.assertNotIn("CameraManager",manifest+java)
  for forbidden in ("android.permission.WRITE_EXTERNAL_STORAGE",
     "android.permission.MANAGE_EXTERNAL_STORAGE"):
   self.assertNotIn(forbidden,manifest+java)
  for expected in ("disposable_app_uninstalled","camera_pid_unchanged",
     "camera_apk_modified","media_bytes_read","person_reviews_modified"):
   self.assertIn(expected,src)
if __name__=="__main__":
 unittest.main(verbosity=2)
