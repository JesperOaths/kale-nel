#!/usr/bin/env python3
"""Synthetic metadata-only SD+Drive provenance discovery, no media or login."""
from pathlib import Path
import importlib.util
import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SRC=Path(__file__).with_name("audit-task21-original-revision-v247.py")
spec=importlib.util.spec_from_file_location("task21_revision_v247",SRC)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
SD="motion_1792300000000.mp4"
DRIVE="archive_001.mp4"
def fake_data():
 return {
  "manual":{"version":1,"revision":39,"items":{"sd:"+SD:{"review_status":"assigned"},
     "drive:"+DRIVE:{"review_status":"assigned"}}},
  "sd":{"snapshot_id":"a"*64,"records":{SD:{
     "bytes":50000,"manifest":{"sha256":"b"*64}}}},
  "drive":{"items":[{"remote_name":DRIVE,"state":"verified","camera":"new",
      "size":60000}]},
  "cfg":{"remote":"gdrive","rclone":"/usr/bin/rclone",
     "rclone_config":"/tmp/test-config-not-real","folders":{"new":{"id":"abc123"}}}
 }
class Tests(unittest.TestCase):
 def test_one_per_source_metadata_without_byte_read(self):
  docs=fake_data()
  def read(path,*args):
   return docs["manual"] if path==m.MANUAL else docs["sd"] if path==m.SD else (
     docs["drive"] if path==m.DRIVE else docs["cfg"])
  def command(args,**kwargs):
   if args[0]=="adb":
    return SimpleNamespace(returncode=0,stdout="50000:1792300000\n",stderr="")
   assert args[2]=="lsjson"
   return SimpleNamespace(returncode=0,stdout=json.dumps({
     "ID":"abcdefghijklmnop","ModTime":"2026-10-20T10:10:00Z",
     "Hashes":{"MD5":"a"*32},"Size":60000,
     "Metadata":{"version":"12"}}),stderr="")
  with patch.object(m,"read_json",side_effect=read),patch.object(
     m.subprocess,"run",side_effect=command) as spy:
   summary=m.collect()
  self.assertEqual(spy.call_count,2)
  self.assertTrue(summary["manual_revision_stable"])
  self.assertTrue(summary["sd"]["phone_file_length_matches"])
  self.assertTrue(summary["drive"]["size_matches_archive"])
  self.assertTrue(summary["drive"]["version_token_available"])
  self.assertEqual(summary["media_bytes_read"],0)
 def test_source_not_in_both_catalogs_fails_closed(self):
  docs=fake_data()
  docs["manual"]["items"]={"sd:"+SD:{"review_status":"assigned"}}
  with patch.object(m,"read_json",side_effect=lambda p,*args:
       docs["manual"] if p==m.MANUAL else docs["sd"] if p==m.SD else
       docs["drive"] if p==m.DRIVE else docs["cfg"]):
   with self.assertRaisesRegex(RuntimeError,"source_qualified_review_sample_missing"):
    m.collect()
 def test_never_streams_or_writes_video(self):
  s=SRC.read_text()
  for forbidden in ("rclone cat","exec-out cat","Files.delete",
    "write_bytes(","write_text(","os.replace(","subprocess.Popen(",
    "getUserMedia(","Camera2", "unlink(","pm install"):
   self.assertNotIn(forbidden,s)
  self.assertIn("media_bytes_read",s)
  self.assertIn("no_media_filenames_or_ids_disclosed",s)
if __name__=="__main__":unittest.main(verbosity=2)
