#!/usr/bin/env python3
"""Offline tests for independently checkpointed 1KB S9+ video proof."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import s9_recovery_playback_smoke_v1 as v1
spec=importlib.util.spec_from_file_location("incremental",HERE/"s9_recovery_playback_smoke_v2.py")
v2=importlib.util.module_from_spec(spec);spec.loader.exec_module(v2)

NAMES={"preroll":"motion_1792000010000.mp4.preroll.mp4",
       "complete":"motion_1792000012000.mp4.complete.mp4"}
def catalog():
    return {"ok":True,"schema_version":"s9_auxiliary_recovery_metadata_v1",
       "not_verified_original_recordings":True,
       "not_counted_in_archive_or_person_analytics":True,
       "no_human_identity_approval":True,"full_frame_decode_verified":False,
       "structural_candidates":2,
       "files":[{"name":n,"role":role,"bytes":1400000 if role=="preroll" else 5400000}
                for role,n in NAMES.items()]}
def observed(role,row):
    return {"role":role,"source":"adb-legacy","range_status":206,
         "range_length":1024,"content_range_matches":True,
         "mp4_ftyp_detected":True,
         "filename_sha256":v2.hashlib.sha256(row["name"].encode()).hexdigest(),
         "original_size_bytes":row["bytes"]}
def healthy():
    return {"mode":"watching","temperature_c":35.1,
            "continuous_4k_ready":True,"continuous_4k_dropped_output_frames":0}
class Tests(unittest.TestCase):
 def setUp(self):
    self.directory=tempfile.TemporaryDirectory()
    self.addCleanup(self.directory.cleanup)
    temp=Path(self.directory.name)
    self.old=(v1.OUTPUT,v1.STATE,v2.STATE,v2.LOCK,v2.PARTIAL)
    v1.OUTPUT=temp/"done.json";v1.STATE=temp;v2.STATE=temp;v2.LOCK=temp/"lock";v2.PARTIAL=temp/"partial.json"
    self.addCleanup(self.restore)
 def restore(self):
    v1.OUTPUT,v1.STATE,v2.STATE,v2.LOCK,v2.PARTIAL=self.old
 def test_two_safe_windows_make_final_proof(self):
    with patch.object(v1,"json_url",return_value=catalog()),\
         patch.object(v1,"check_camera",return_value=healthy()),\
         patch.object(v1,"busy_services",return_value=False),\
         patch.object(v1,"read_exact_range",side_effect=observed) as reader:
      self.assertEqual(v2.run(True),"partial")
      self.assertEqual(reader.call_count,1)
      self.assertFalse(v1.OUTPUT.is_file())
      self.assertEqual(v2.PARTIAL.stat().st_mode&0o777,0o600)
      self.assertEqual(list(json.loads(v2.PARTIAL.read_text())["results"]),["preroll"])
      self.assertEqual(v2.run(True),"verified")
      self.assertEqual(reader.call_count,2)
      outcome=json.loads(v1.OUTPUT.read_text())
      self.assertEqual(v1.OUTPUT.stat().st_mode&0o777,0o600)
      self.assertTrue(outcome["preroll_and_complete_verified"])
      self.assertEqual(outcome["video_response_bytes_read"],2048)
      self.assertFalse(outcome["full_video_decoded"])
      self.assertFalse(outcome["video_files_modified"])
      self.assertEqual(v2.run(True),"verified")
      self.assertEqual(reader.call_count,2)
 def test_hot_phone_defers_without_reading(self):
    with patch.object(v1,"check_camera",return_value=None),\
         patch.object(v1,"read_exact_range") as reader:
      self.assertEqual(v2.run(True),"deferred")
      reader.assert_not_called()
      self.assertFalse(v2.PARTIAL.exists())
 def test_changed_role_metadata_invalidates_prior(self):
    a=v1.selected(catalog());old=observed("preroll",a["preroll"])
    v2.write_partial({"preroll":old})
    changed=catalog();changed["files"][0]["name"]="motion_1792000040000.mp4.preroll.mp4"
    new=v1.selected(changed)
    self.assertEqual(v2.read_partial(new),{})
    self.assertTrue(v2.validate_observation(old,"preroll",a["preroll"]))
    self.assertFalse(v2.validate_observation(old,"preroll",new["preroll"]))
 def test_stale_or_world_readable_proof_does_not_count(self):
    selected=v1.selected(catalog())
    v2.write_partial({"preroll":observed("preroll",selected["preroll"])})
    d=json.loads(v2.PARTIAL.read_text())
    d["verified_at_utc"]="2025-01-01T00:00:00+00:00"
    v2.PARTIAL.write_text(json.dumps(d))
    self.assertEqual(v2.read_partial(selected),{})
    v2.PARTIAL.chmod(0o644)
    with self.assertRaises(ValueError):v2.read_partial(selected)
 def test_proof_has_no_paths_or_reclassification(self):
    src=(HERE/"s9_recovery_playback_smoke_v2.py").read_text()
    for required in ("MAX_AGE_SECONDS=48*3600","v1.check_camera()",
       "v1.busy_services()","v1.read_exact_range(","os.fchmod(writer.fileno(),0o600)",
       "v1.write_success(","full_video_decoded"):
      self.assertIn(required,src)
    for forbidden in ("adb pull","adb push","ffmpeg","shutil.rmtree",
       "os.remove(","manual_reviews.update(","sudo ","reboot","force-stop"):
      self.assertNotIn(forbidden,src)
 def test_sparse_timer(self):
    unit=(HERE/"c720p-s9-recovery-playback-smoke-v2.service").read_text()
    timer=(HERE/"c720p-s9-recovery-playback-smoke-v2.timer").read_text()
    self.assertIn("s9_recovery_playback_smoke_v2.py --execute",unit)
    self.assertIn("IOSchedulingClass=idle",unit)
    self.assertIn("NoNewPrivileges=yes",unit)
    self.assertIn("OnUnitInactiveSec=3h",timer)
    self.assertIn("RandomizedDelaySec=20min",timer)
    self.assertIn("Persistent=false",timer)
if __name__=="__main__":unittest.main(verbosity=2)
