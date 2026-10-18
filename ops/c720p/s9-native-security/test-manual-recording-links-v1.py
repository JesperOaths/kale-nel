#!/usr/bin/env python3
"""Synthetic verified-source manual folder-link tests, no media access."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SRC=Path(__file__).resolve().parent.parent/"s9-person-ml-v1/s9_manual_recording_links.py"
spec=importlib.util.spec_from_file_location("s9_manual_links",SRC)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
SD="motion_1792200000000.mp4"
DRIVE="drive_2026-05-12_08-30-00.mp4"
class ManualLinkCases(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.patches=[]
  for name,file in (("STORE","links.json"),("AUDIT","audit.jsonl"),
                    ("LOCK","links.lock"),("DRIVE","drive.json")):
   p=patch.object(m,name,Path(self.tmp.name)/file)
   p.start();self.addCleanup(p.stop)
  m.DRIVE.write_text(json.dumps({"items":[{"remote_name":DRIVE,
   "size":4500000,"state":"verified"}]}))
 def body(self,source="sd",name=SD,folder="G123",revision=0,action="assign"):
  return {"action":action,"source":source,"name":name,"folder":folder,
          "revision":revision,"human_confirmed":True}
 def mutate(self,**kw):return m.mutate(self.body(**kw),{SD:{"sd_verified":True}})
 def test_sd_and_drive_require_real_verified_sources(self):
  self.assertEqual(self.mutate()[0],200)
  self.assertEqual(self.mutate(source="drive",name=DRIVE,revision=1)[0],200)
  self.assertEqual(m.report()["items"]["drive:"+DRIVE]["folder"],"G123")
  self.assertEqual(m.STORE.stat().st_mode&0o777,0o600)
  self.assertEqual(len(m.AUDIT.read_text().splitlines()),2)
 def test_return_to_queue_retains_audit_history(self):
  self.assertEqual(self.mutate()[0],200)
  code,response=self.mutate(folder=None,revision=1,action="return_to_queue")
  self.assertEqual(code,200)
  self.assertIsNone(m.report()["items"]["sd:"+SD]["folder"])
  self.assertEqual(len(m.AUDIT.read_text().splitlines()),2)
  self.assertEqual(self.mutate(revision=2)[0],200)
 def test_reject_forged_unverified_videos_and_invalid_folders(self):
  for kw in ({"name":"../../evil.mp4"},{"source":"sd","name":DRIVE},
             {"source":"drive","name":"not-a-drive-file.mp4"},
             {"source":"drive","name":"../../fake.mp4"},
             {"folder":"../G123"},{"folder":""},
             {"folder":"G123","revision":"0"}):
   self.assertNotEqual(self.mutate(**kw)[0],200)
  self.assertFalse(m.STORE.exists())
 def test_reject_false_human_confirmation_and_stale_revision(self):
  body=self.body();body["human_confirmed"]=False
  self.assertEqual(m.mutate(body,{SD:1})[0],400)
  self.assertEqual(self.mutate()[0],200)
  self.assertEqual(self.mutate(revision=0)[0],409)
 def test_deleted_drive_files_cannot_be_added(self):
  m.DRIVE.write_text(json.dumps({"items":[{"remote_name":DRIVE,
   "size":4500000,"state":"deleted"}]}))
  self.assertEqual(self.mutate(source="drive",name=DRIVE)[0],404)
 def test_audit_symlink_fails_closed(self):
  (Path(self.tmp.name)/"trap").write_text("protected")
  m.AUDIT.symlink_to(Path(self.tmp.name)/"trap")
  self.assertEqual(self.mutate()[0],503)
  self.assertFalse(m.STORE.exists())
 def test_route_does_not_recognize_or_modify_people(self):
  src=SRC.read_text()
  for forbidden in ("cv2.imread","face_embedding","rclone delete",
                    "adb shell","shutil.rmtree","source_sha256 ="):
   self.assertNotIn(forbidden,src)
if __name__=="__main__":unittest.main(verbosity=2)
