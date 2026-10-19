#!/usr/bin/env python3
"""Synthetic checks of bounded private auxiliary probe aggregation."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import json

src=Path(__file__).with_name("s9_auxiliary_media_probe_v1.py")
spec=importlib.util.spec_from_file_location("aux_media",src)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
N="motion_1792000010000.mp4.preroll.mp4"
def raw(rows,total=1,offset=0):
 return m.MARKER+json.dumps({
  "schema_version":m.SCHEMA,"offset":offset,"batch_size":12,
  "total_unpaired_auxiliary_files":total,"rows":rows,
  "files_modified":False,"manual_reviews_modified":False,
  "video_decoded":False,"no_recording_bytes_transferred_to_hub":True})
def row(name=N,role="preroll"):
 return {"name":name,"role":role,"bytes":123450,
         "read_only":True,"status":"compressed_video_samples_read"}

class Contracts(unittest.TestCase):
 def test_good_row_and_status(self):
  count,rows=m.parse(raw([row()]),0)
  self.assertEqual(count,1)
  self.assertEqual(rows[0]["status"],"compressed_video_samples_read")
 def test_source_shift_fails_closed(self):
  with self.assertRaisesRegex(ValueError,"source_changed"):
   m.parse(raw([row()],total=1),0,total=2)
 def test_filename_path_traversal_fails(self):
  with self.assertRaises(ValueError):
   m.parse(raw([row("../"+N)]),0)
 def test_role_mismatch_fails(self):
  with self.assertRaises(ValueError):
   m.parse(raw([row(role="complete")]),0)
 def test_missing_empty_rows_not_success(self):
  with self.assertRaises(ValueError):
   m.parse(raw([]),0)
 def test_untrusted_return_flags_fail(self):
  item=json.loads(raw([row()]).split(m.MARKER,1)[1])
  item["video_decoded"]=True
  with self.assertRaises(ValueError):
   m.parse(m.MARKER+json.dumps(item),0)
 def test_private_atomic_report_writes_mode_600(self):
  with tempfile.TemporaryDirectory() as td:
   prior_state,prior_output=m.STATE,m.OUTPUT
   try:
    m.STATE=Path(td);m.OUTPUT=Path(td)/"report.json"
    m.write_atomic({"rows":[row()],"originals_modified":False})
    self.assertEqual(m.OUTPUT.stat().st_mode&0o777,0o600)
    self.assertFalse(json.loads(m.OUTPUT.read_text())["originals_modified"])
   finally:m.STATE,m.OUTPUT=prior_state,prior_output
 def test_runner_has_no_capture_or_deletion_side_effects(self):
  s=src.read_text()
  for dangerous in ("--apply","MediaRecorder","adb pull","shutil.rmtree","chmod 777"):
   self.assertNotIn(dangerous,s)
  self.assertIn('time.sleep(0.5)',s)
  self.assertIn('camera()',s)
if __name__=="__main__":unittest.main(verbosity=2)
