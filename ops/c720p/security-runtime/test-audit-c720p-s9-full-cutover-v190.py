#!/usr/bin/env python3
"""Offline no-person-data tests for the never-delete S9 dual-media cutover gate."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

SOURCE=Path(__file__).with_name("audit-c720p-s9-full-cutover-v190.py")
spec=importlib.util.spec_from_file_location("cutover_v190",SOURCE)
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)

def fixtures(root,count=2):
 root=Path(root);snaps=root/"snaps";snaps.mkdir()
 events=[];jpg_records={};mp4={}
 for i in range(count):
  base=f"motion_{1792000010000+i*1000}"
  clip=base+".mp4";jpg=base+".jpg"
  data=b"\xff\xd8\xff"+bytes([65+i])*1100+b"\xff\xd9"
  (snaps/jpg).write_bytes(data)
  sha="a"*64 if i%2==0 else "b"*64
  mp4[clip]={"bytes":12000,"indexed":True,"sha256":sha}
  jpg_records[jpg]={"clip":clip,"clip_sha256":sha,
     "sha256":hashlib.sha256(data).hexdigest(),
     "sd_path":m.JPG_ROOT+"/"+jpg,"bytes":len(data)}
  events.append({"clip":"clips/"+clip,"snapshot":"snaps/"+jpg,"saved":False})
 report=root/"proof.json"
 report.write_text(json.dumps({"schema_version":m.SCHEMA,"records":jpg_records}))
 report.chmod(0o600)
 ev=root/"events.json";ev.write_text(json.dumps(events))
 return mp4,report,ev,snaps,jpg_records,events

class Tests(unittest.TestCase):
 def test_full_sha_qualified_video_snapshot_provenance(self):
  with tempfile.TemporaryDirectory() as tmp:
   mp4,report,ev,snaps,records,_=fixtures(tmp)
   out=m.snapshot_coverage(mp4,report=report,events=ev,folder=snaps)
   self.assertEqual(out["manifest_snapshots"],2)
   self.assertEqual(out["local_snapshot_sha_matches"],2)
   self.assertTrue(out["video_snapshot_bijection_verified"])
   self.assertFalse(out["live_phone_rehash_performed"])
   self.assertNotIn("motion_",str(out))

 def test_checksum_and_clip_provenance_fail_closed(self):
  with tempfile.TemporaryDirectory() as tmp:
   mp4,report,ev,snaps,records,_=fixtures(tmp)
   records[next(iter(records))]["clip_sha256"]="d"*64
   report.write_text(json.dumps({"schema_version":m.SCHEMA,"records":records}))
   with self.assertRaisesRegex(m.Refusal,"snapshot_proof_integrity_metadata_invalid"):
    m.snapshot_coverage(mp4,report=report,events=ev,folder=snaps)
   records[next(iter(records))]["clip_sha256"]="a"*64
   records[next(iter(records))]["sha256"]="e"*64
   report.write_text(json.dumps({"schema_version":m.SCHEMA,"records":records}))
   with self.assertRaisesRegex(m.Refusal,"local_snapshot_checksum_drift"):
    m.snapshot_coverage(mp4,report=report,events=ev,folder=snaps)

 def test_missing_references_duplicate_and_world_readable_proof(self):
  with tempfile.TemporaryDirectory() as tmp:
   mp4,report,ev,snaps,records,events=fixtures(tmp)
   report.chmod(0o644)
   with self.assertRaisesRegex(m.Refusal,"private_proof_untrusted"):
    m.snapshot_coverage(mp4,report=report,events=ev,folder=snaps)
   report.chmod(0o600)
   ev.write_text(json.dumps([events[0],events[0]]))
   with self.assertRaisesRegex(m.Refusal,"duplicate_legacy_clip_snapshot_reference"):
    m.snapshot_coverage(mp4,report=report,events=ev,folder=snaps)
   ev.write_text(json.dumps(events[:-1]))
   with self.assertRaisesRegex(m.Refusal,"snapshot_to_video_coverage_incomplete"):
    m.snapshot_coverage(mp4,report=report,events=ev,folder=snaps)
   ev.write_text(json.dumps(events))
   ref=next(iter(records))
   (snaps/ref).unlink()
   (snaps/ref).symlink_to(Path(tmp)/"proof.json")
   with self.assertRaisesRegex(m.Refusal,"local_snapshot_not_regular"):
    m.snapshot_coverage(mp4,report=report,events=ev,folder=snaps)

 def test_unverified_error_is_private_and_never_allows_deletion(self):
  out=io.StringIO()
  with patch.object(m,"audit",side_effect=RuntimeError(
       "private identity or thumbnail path /home/photo.jpg")), \
       patch("sys.stdout",out):
   with self.assertRaises(SystemExit) as ex:m.main()
  self.assertEqual(ex.exception.code,1)
  value=json.loads(out.getvalue().split(m.MARK)[1])
  self.assertEqual(value["state"],"unverified")
  self.assertFalse(value["eligible_for_local_removal"])
  self.assertTrue(value["retain_all_local_originals"])
  self.assertNotIn("private identity",out.getvalue())

 def test_source_has_no_possible_cleanup_operation(self):
  body=SOURCE.read_text()
  for forbidden in ("os.unlink(", "shutil.rmtree(", "os.remove(",
       "adb push","adb shell rm", "pm install", "subprocess.run(",
       "write_bytes(", "send_response(", "auto_assign_person("):
   self.assertNotIn(forbidden,body)
  self.assertIn('"eligible_for_local_removal":False',body)
  self.assertIn('"retain_all_local_originals":True',body)
  self.assertIn('"live_phone_rehash_performed":False',body)
  self.assertIn("max_bytes=MAX_DOC",body)
if __name__=="__main__":unittest.main(verbosity=2)
