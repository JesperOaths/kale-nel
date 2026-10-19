#!/usr/bin/env python3
"""No-write synthetic checks for C720P disk attribution V162."""
import importlib.util
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SOURCE=Path(__file__).with_name("audit-c720p-root-space-v162.py")
spec=importlib.util.spec_from_file_location("root_space_v162",SOURCE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Test(unittest.TestCase):
 def test_one_exact_directory_only_and_private_output(self):
  with tempfile.TemporaryDirectory() as directory:
   p=Path(directory)/"target";p.mkdir()
   fake=SimpleNamespace(returncode=0,stdout=f"104857600\t{p}\n")
   with patch.object(m.subprocess,"run",return_value=fake) as command:
    value=m.size(str(p))
   self.assertEqual(value,{"status":"measured","mib":100.0})
   command.assert_called_once()
   args=command.call_args.args[0]
   self.assertEqual(args,["du","-sx","-B1","--",str(p)])
   self.assertNotIn(str(p),str(value))

 def test_symlink_refusal_before_scan(self):
  with tempfile.TemporaryDirectory() as directory:
   p=Path(directory)/"source";p.mkdir()
   link=Path(directory)/"link";link.symlink_to(p,target_is_directory=True)
   with patch.object(m.subprocess,"run") as command:
    self.assertEqual(m.size(str(link))["status"],"unsafe_root_refused")
    command.assert_not_called()

 def test_timeout_and_partial_exit_do_not_fake_size(self):
  with tempfile.TemporaryDirectory() as directory:
   p=Path(directory)/"directory";p.mkdir()
   with patch.object(m.subprocess,"run",side_effect=m.subprocess.TimeoutExpired(["du"],10)):
    self.assertEqual(m.size(str(p))["status"],"scan_timeout")
   with patch.object(m.subprocess,"run",return_value=SimpleNamespace(returncode=1,stdout="2048\t/private\n")):
    self.assertEqual(m.size(str(p))["status"],"scanner_incomplete")
   with patch.object(m.subprocess,"run",return_value=SimpleNamespace(returncode=0,stdout="not-a-size\n")):
    self.assertEqual(m.size(str(p))["status"],"scanner_format_untrusted")

 def test_busy_hub_never_scans(self):
  healthy={"continuous_4k_dropped_output_frames":0,"temperature_c":32.0}
  usage=SimpleNamespace(total=12*1024**3,used=11*1024**3,free=1*1024**3)
  with patch.object(m,"capture",return_value=healthy) as camera, \
       patch.object(m.shutil,"disk_usage",return_value=usage), \
       patch.object(m.os,"getloadavg",return_value=(6.0,1,1)), \
       patch.object(m,"size") as scanner:
   report=m.audit()
  self.assertEqual(report["status"],"deferred_hub_load")
  self.assertFalse(report["recordings_modified"])
  scanner.assert_not_called()
  camera.assert_called_once()

 def test_measured_directory_categories_are_not_added(self):
  healthy={"continuous_4k_dropped_output_frames":0,"temperature_c":32.0}
  usage=SimpleNamespace(total=12*1024**3,used=11*1024**3,free=1*1024**3)
  with patch.object(m,"capture",return_value=healthy), \
       patch.object(m.shutil,"disk_usage",return_value=usage), \
       patch.object(m.os,"getloadavg",return_value=(0.2,0.1,0.1)), \
       patch.object(m,"TARGETS",{"cache":"/tmp","docker":"/var/lib/docker"}), \
       patch.object(m,"size",return_value={"status":"measured","mib":123.4}) as scanner:
   report=m.audit()
  self.assertEqual(scanner.call_count,2)
  self.assertTrue(report["non_additive_categories"])
  self.assertEqual(report["status"],"complete")
  self.assertEqual(report["capture_dropped_frames_after"],0)
  self.assertFalse(report["files_deleted"])

 def test_source_has_no_delete_or_privilege_primitives(self):
  s=SOURCE.read_text()
  for banned in ("rmtree(", ".unlink(", "os.remove(", "sudo", "apt-get", "systemctl", "pm install", "adb push", "shutil.move("):
   self.assertNotIn(banned,s)
  self.assertIn("timeout=MAX_SCAN_S",s)
  self.assertIn('["du","-sx","-B1","--",str(target)]',s)
 def test_docker_summary_no_image_or_volume_names(self):
  import json
  lines=[
   {"Type":"Images","TotalCount":10,"Active":4,"Size":"1.1GB","Reclaimable":"200MB (18%)","PrivateImageName":"secret"},
   {"Type":"Containers","TotalCount":2,"Active":2,"Size":"12MB","Reclaimable":"0B"},
   {"Type":"Build Cache","TotalCount":14,"Active":0,"Size":"600MB","Reclaimable":"580MB"},
  ]
  output="\n".join(json.dumps(line) for line in lines)+"\n"
  with patch.object(m.subprocess,"run",return_value=SimpleNamespace(returncode=0,stdout=output)) as run:
   data=m.docker_summary()
  self.assertEqual(data["status"],"measured")
  self.assertTrue(data["reported_reclaimable_is_not_deletion_approval"])
  self.assertEqual(data["categories"]["build_cache"]["size_display"],"600MB")
  self.assertEqual(data["categories"]["images"]["active_count"],4)
  self.assertNotIn("secret",str(data))
  self.assertEqual(run.call_args.args[0],["docker","system","df","--format","{{json .}}"])

 def test_docker_unavailable_fail_closed(self):
  for value in (SimpleNamespace(returncode=1,stdout="unauthorized"),
                SimpleNamespace(returncode=0,stdout="malformed json\n")):
   with patch.object(m.subprocess,"run",return_value=value):
    self.assertIn(m.docker_summary()["status"],("unavailable","unrecognized_output"))
  with patch.object(m.subprocess,"run",side_effect=m.subprocess.TimeoutExpired(["docker"],12)):
   self.assertEqual(m.docker_summary()["status"],"timeout")

 def test_privileged_root_reservation_is_not_reclaimable_cache(self):
  healthy={"continuous_4k_dropped_output_frames":0,"temperature_c":32.0}
  usage=SimpleNamespace(total=10000*4096,used=8500*4096,free=700*4096)
  blocks=SimpleNamespace(f_bfree=1500,f_bavail=700,f_frsize=4096)
  with patch.object(m,"capture",return_value=healthy), \
       patch.object(m.shutil,"disk_usage",return_value=usage), \
       patch.object(m.os,"statvfs",return_value=blocks), \
       patch.object(m.os,"getloadavg",return_value=(0.1,0.1,0.1)), \
       patch.object(m,"TARGETS",{}),patch.object(m,"docker_summary",return_value={"status":"unavailable"}):
   report=m.audit()
  self.assertAlmostEqual(report["root_not_available_to_unprivileged_mib"],3.1,places=1)
  self.assertFalse(report["files_deleted"])
if __name__=="__main__":unittest.main(verbosity=2)
