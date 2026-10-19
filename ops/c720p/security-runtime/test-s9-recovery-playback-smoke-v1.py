#!/usr/bin/env python3
"""Offline, no-network tests for strictly bounded S9 recovery playback proof."""
import importlib.util
from pathlib import Path
import tempfile
import json
import unittest
from unittest.mock import patch

PATH=Path(__file__).with_name("s9_recovery_playback_smoke_v1.py")
spec=importlib.util.spec_from_file_location("s9_smoke",PATH)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
PRE="motion_1792000010000.mp4.preroll.mp4"
COMP="motion_1792000013000.mp4.complete.mp4"
def report():
 return {"ok":True,"schema_version":"s9_auxiliary_recovery_metadata_v1",
  "not_verified_original_recordings":True,"not_counted_in_archive_or_person_analytics":True,
  "no_human_identity_approval":True,"full_frame_decode_verified":False,
  "structural_candidates":2,"files":[{"role":"preroll","name":PRE,"bytes":1400000},
   {"role":"complete","name":COMP,"bytes":6200000}]}
class Reply:
 def __init__(self,headers,body,status=206):
  self.headers=headers;self.status=status;self.body=body
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def read(self,length):return self.body[:length]
class Tests(unittest.TestCase):
 def test_selection_keeps_recovery_separate(self):
  d=m.selected(report())
  self.assertEqual((d["preroll"]["name"],d["complete"]["name"]),(PRE,COMP))
 def test_bad_source_contract_denied(self):
  d=report();d["not_verified_original_recordings"]=False
  with self.assertRaises(ValueError):m.selected(d)
 def test_path_escape_denied(self):
  d=report();d["files"][1]["name"]="../motion_1792000013000.mp4.complete.mp4"
  with self.assertRaises(ValueError):m.selected(d)
 def test_read_1kb_mp4_range(self):
  headers={"Content-Range":"bytes 0-1023/1400000","Content-Length":"1024",
           "Content-Type":"video/mp4","Cache-Control":"private,no-store",
           "X-S9-Media-Source":"adb-legacy"}
  data=b"\x00\x00\x00\x18ftyp"+b"x"*1016
  with patch.object(m.urllib.request,"urlopen",return_value=Reply(headers,data)):
   result=m.read_exact_range("preroll",{"name":PRE,"bytes":1400000})
  self.assertEqual(result["range_length"],1024)
  self.assertEqual(result["source"],"adb-legacy")
  self.assertTrue(result["mp4_ftyp_detected"])
  self.assertNotIn("name",result)
 def test_range_mismatch_denied(self):
  headers={"Content-Range":"bytes 0-1023/1400001","Content-Length":"1024",
           "Content-Type":"video/mp4","Cache-Control":"private,no-store",
           "X-S9-Media-Source":"adb-legacy"}
  with patch.object(m.urllib.request,"urlopen",return_value=Reply(headers,b"x"*1024)):
   with self.assertRaises(ValueError):m.read_exact_range("preroll",{"name":PRE,"bytes":1400000})
 def test_private_success_report_mode_and_idempotency(self):
  with tempfile.TemporaryDirectory() as td:
   previous=(m.STATE,m.OUTPUT,m.LOCK)
   try:
    m.STATE=Path(td);m.OUTPUT=Path(td)/"ok.json";m.LOCK=Path(td)/"lock"
    m.write_success({"schema_version":"s9_aux_recovery_playback_smoke_v1","preroll_and_complete_verified":True,"video_files_modified":False})
    self.assertEqual(m.OUTPUT.stat().st_mode&0o777,0o600)
    self.assertEqual(m.run(execute=True),"verified")
   finally:m.STATE,m.OUTPUT,m.LOCK=previous
 def test_thermal_gates_and_timed_check(self):
  self.assertEqual(m.MAX_TEMP_C,38.0)
  text=PATH.read_text()
  for requirement in ("continuous_4k_ready","continuous_4k_dropped_output_frames",
       "check_camera() is None or busy_services()","read(SAMPLE_LENGTH+1)","SAMPLE_LENGTH=1024",
       "MIN_ROOT_BYTES=650*1024*1024"):
   self.assertIn(requirement,text)
  for forbidden in ("adb pull","shutil.rmtree","CameraManager","FileOutputStream","--apply"):
   self.assertNotIn(forbidden,text)
  # Atomic private-report cleanup is permitted; source media deletion is not.
  self.assertEqual(text.count("os.unlink("),1)
  self.assertIn("os.unlink(temp)",text)
 def test_sparse_timer(self):
  root=PATH.parent
  timer=(root/"c720p-s9-recovery-playback-smoke-v1.timer").read_text()
  service=(root/"c720p-s9-recovery-playback-smoke-v1.service").read_text()
  self.assertIn("OnUnitInactiveSec=6h",timer)
  self.assertIn("RandomizedDelaySec=45min",timer)
  self.assertIn("Persistent=false",timer)
  self.assertIn("IOSchedulingClass=idle",service)
  self.assertIn("s9_recovery_playback_smoke_v1.py --execute",service)

if __name__=="__main__":unittest.main(verbosity=2)
